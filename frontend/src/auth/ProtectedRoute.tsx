import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, type CurrentUser } from './AuthContext';

export function ProtectedRoute({ allow }: { allow?: Array<CurrentUser['role']> }) {
  const { user, bootstrapping } = useAuth();

  // Wait for the /auth/me boot call to settle. Without this a hard
  // reload of any protected page flashes the login screen for one
  // frame before the me-call comes back saying the browser IS signed
  // in — the cookie is on the request, we just don't know it yet.
  if (bootstrapping) return null;

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (allow && !allow.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
