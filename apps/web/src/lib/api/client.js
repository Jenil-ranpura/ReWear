/**
 * API client core (§12: components never call fetch directly).
 *
 * Access token lives in MEMORY only (§15: XSS safety — never localStorage);
 * session persistence uses the httpOnly refresh cookie via /auth/refresh
 * (credentials: 'include'). Errors are normalized to the §10 shape:
 * ApiError { status, code, message }.
 *
 * Session-restore correctness (the refresh bug):
 * - The refresh token is SINGLE-USE (server rotates it on every refresh).
 *   Two concurrent /auth/refresh calls = the second one consumes an
 *   already-rotated cookie and 401s. React 18 StrictMode intentionally
 *   double-invokes effects in dev, so restore must be deduped →
 *   refreshAccessToken() is single-flight (one in-flight promise shared).
 * - restoreSession() never auto-retries: if there is no valid session,
 *   one probe must fail with exactly one 401, not loop.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/**
 * Fixed session window (§11, user request): the API stamps an ABSOLUTE
 * deadline at login (ISO string); refresh rotates the token but never extends
 * it. The AuthContext arms its auto-logout timer from this mirror — the
 * server owns the deadline, the client only reproduces it. Null = no cap
 * (pre-cap sessions) / logged out.
 */
let sessionExpiresAt = null;

export function setSessionExpiresAt(iso) {
  sessionExpiresAt = iso ?? null;
}

export function getSessionExpiresAt() {
  return sessionExpiresAt;
}

/**
 * Fired on the window when the server rejects the refresh cookie (session
 * over — expired window, rotation, ban). The AuthContext listens and signs
 * the user out immediately, even if no timer was armed (e.g. the tab slept
 * past the deadline and the expiry fired inside a plain API call instead).
 */
export const SESSION_EXPIRED_EVENT = 'rewear:session-expired';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Query-string builder for GET clients (§12: one convention, components never
 * touch fetch or URL plumbing). Skips undefined/null/'' and empty arrays so
 * callers can pass whole state objects (e.g. the browse filter panel) and the
 * URL stays clean. Repeated values (arrays) become repeated params, matching
 * what the API's browseItemsSchema expects (`condition=NEW&condition=GOOD`).
 */
export function buildQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * The ONLY path that must never auto-retry is /auth/refresh itself — a retry
 * there would recurse (refresh → 401 → refresh → …) and could double-consume
 * the single-use cookie. Every other path may retry once, but only on a
 * genuine token-expiry 401 (code UNAUTHENTICATED/TOKEN_EXPIRED) — so
 * INVALID_CREDENTIALS on login or INVALID_REFRESH never trigger a refresh.
 * This also lets /auth/logout survive an expired access token.
 */
function shouldRetryAfterRefresh(path) {
  return !path.startsWith('/auth/refresh');
}

/** True when the failure is an expired/dead access token worth refreshing for. */
function isTokenExpiredError(err) {
  return (
    err instanceof ApiError &&
    err.status === 401 &&
    (err.code === 'UNAUTHENTICATED' || err.code === 'TOKEN_EXPIRED')
  );
}

/**
 * Single-flight refresh: concurrent callers share ONE in-flight promise, so
 * the single-use refresh cookie is consumed exactly once. In-flight failures
 * are NOT cached — a later caller may legitimately retry (e.g. after the user
 * logs in again).
 */
let refreshInFlight = null;

export function refreshAccessToken() {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const data = await rawFetch('/auth/refresh', { method: 'POST' });
      accessToken = data.accessToken;
      setSessionExpiresAt(data.sessionExpiresAt);
      return data.accessToken;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Dead session: broadcast so the app drops to logged-out instead of
        // surfacing the error on the user's next action.
        setSessionExpiresAt(null);
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
      throw err;
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/**
 * Raw fetch used ONLY by refreshAccessToken (bypasses the 401-retry logic to
 * avoid recursion). Shared transport/error normalization with apiFetch.
 */
async function rawFetch(path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { credentials: 'include', ...init, headers });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }
  if (res.status === 204) return null; // e.g. DELETE /items/:id
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'UNKNOWN',
      data?.error?.message ?? `Request failed with status ${res.status}.`
    );
  }
  return data;
}

/**
 * Single fetch wrapper. Sends the Bearer token when present and always
 * includes credentials so the httpOnly refresh cookie rides along. A 401
 * caused by an expired access token triggers ONE transparent refresh+retry.
 */
export async function apiFetch(path, { method = 'GET', body, signal, query } = {}) {
  const isForm = body instanceof FormData;
  const fullPath = `${path}${buildQuery(query)}`;
  const doFetch = () => {
    const headers = {};
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    // FormData: no Content-Type — the browser sets the multipart boundary.
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return rawFetch(fullPath, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  };

  try {
    return await doFetch();
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (!shouldRetryAfterRefresh(path) || !isTokenExpiredError(err)) throw err;
    await refreshAccessToken();
    return doFetch();
  }
}
