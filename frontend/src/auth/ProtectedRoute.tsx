import { Navigate, Outlet } from 'react-router-dom';
import { useAuth, type CurrentUser } from './AuthContext';

export function ProtectedRoute({ allow }: { allow?: Array<CurrentUser['role']> }) {
  const { accessToken, user } = useAuth();

  if (!accessToken || !user) {
    return <Navigate to="/login" replace />;
  }
  if (allow && !allow.includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
