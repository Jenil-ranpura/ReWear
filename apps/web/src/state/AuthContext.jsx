/**
 * Auth context (§12 state management: React Context for auth/session).
 * On mount it silently restores the session (refresh cookie → me); exposes
 * { user, status, login, register, logout } where status is
 * 'loading' | 'authenticated' | 'unauthenticated'.
 *
 * Fixed session window (§11, user request): the API stamps an ABSOLUTE
 * deadline at login/register (rotation never extends it). The context mirrors
 * that deadline and signs the user out locally the moment it passes —
 * ProtectedRoute then bounces them to /login. A reactive listener for the
 * client's SESSION_EXPIRED_EVENT covers the case where the deadline passes
 * inside a plain API call (e.g. the tab slept past it) instead of on the
 * timer; both paths converge on the same local sign-out.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import * as authApi from '../lib/api/auth.js';
import { getSessionExpiresAt, SESSION_EXPIRED_EVENT } from '../lib/api/client.js';

// Fire the timer a beat AFTER the server-side deadline so the two agree.
const EXPIRY_GRACE_MS = 250;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');
  const [sessionExpiresAt, setSessionExpiresAt] = useState(null);

  /** Local sign-out for a session that is already dead server-side — no
   * /auth/logout call (it would just 401); the failed refresh has already
   * cleared the cookie. */
  const forceSignOut = useCallback(() => {
    setUser(null);
    setStatus('unauthenticated');
    setSessionExpiresAt(null);
  }, []);

  // Automatic logout at the end of the fixed session window.
  useEffect(() => {
    if (status !== 'authenticated' || !sessionExpiresAt) return undefined;
    const ms = new Date(sessionExpiresAt).getTime() - Date.now() + EXPIRY_GRACE_MS;
    if (ms <= 0) {
      forceSignOut();
      return undefined;
    }
    const timer = setTimeout(forceSignOut, ms);
    return () => clearTimeout(timer);
  }, [status, sessionExpiresAt, forceSignOut]);

  // Reactive safety net: a dead-session 401 from /auth/refresh also signs out.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, forceSignOut);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, forceSignOut);
  }, [forceSignOut]);

  // Silent restore: the httpOnly refresh cookie survives reloads even though
  // the access token lives only in memory. Failures = simply not logged in.
  useEffect(() => {
    let cancelled = false;
    authApi
      .restoreSession()
      .then((me) => {
        if (!cancelled) {
          setUser(me);
          setStatus('authenticated');
          setSessionExpiresAt(getSessionExpiresAt());
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const me = await authApi.login(credentials);
    setUser(me);
    setStatus('authenticated');
    setSessionExpiresAt(getSessionExpiresAt());
    return me;
  }, []);

  const register = useCallback(async (payload) => {
    const me = await authApi.register(payload);
    setUser(me);
    setStatus('authenticated');
    setSessionExpiresAt(getSessionExpiresAt());
    return me;
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setUser(null);
    setStatus('unauthenticated');
    setSessionExpiresAt(null);
  }, []);

  /**
   * Profile self-service: merge the API's safe user over the current one so
   * the navbar name / points chip / dashboard reflect the edit immediately
   * (no refetch round-trip). Session state is untouched — a profile edit
   * neither extends nor revokes the session window.
   */
  const updateUser = useCallback((safeUser) => {
    setUser((prev) => (prev ? { ...prev, ...safeUser } : prev));
  }, []);

  const value = useMemo(
    () => ({ user, status, login, register, logout, updateUser }),
    [user, status, login, register, logout, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
