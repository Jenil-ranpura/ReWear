/**
 * Protected route wrapper (§11/§12): redirects unauthenticated users to
 * /login (remembering where they came from), shows the 403 page for
 * authenticated non-admins on admin routes, and a loading state while the
 * session is being restored (§5.9: never a blank screen).
 */

import { Navigate, useLocation } from 'react-router-dom';

import ForbiddenPage from '../pages/ForbiddenPage.jsx';
import { useAuth } from '../state/AuthContext.jsx';

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-stone-500" role="status">
        <span className="animate-pulse">Loading…</span>
      </div>
    );
  }

  if (status !== 'authenticated' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireAdmin && user.role !== 'ADMIN') {
    return <ForbiddenPage />;
  }

  return children;
}
