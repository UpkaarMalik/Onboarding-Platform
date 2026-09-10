import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const initial = user?.full_name?.trim()?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="brand">Onboarding Platform</div>
        <nav>
          {user?.role === 'employee' && (
            <>
              <NavLink to="/start-here" className={({ isActive }) => (isActive ? 'active' : '')}>
                Home
              </NavLink>
              <NavLink to="/tasks" className={({ isActive }) => (isActive ? 'active' : '')}>
                My Tasks
              </NavLink>
            </>
          )}
          {user?.role === 'task_owner' && (
            <NavLink to="/my-tasks" className={({ isActive }) => (isActive ? 'active' : '')}>
              My Tasks
            </NavLink>
          )}
          {user?.role === 'superadmin_hr' && (
            <>
              <NavLink to="/hr" end className={({ isActive }) => (isActive ? 'active' : '')}>
                Home
              </NavLink>
              <NavLink to="/hr/overview" className={({ isActive }) => (isActive ? 'active' : '')}>
                Dashboard
              </NavLink>
              <NavLink to="/notes-admin" className={({ isActive }) => (isActive ? 'active' : '')}>
                Notes
              </NavLink>
            </>
          )}
          <NavLink to="/community" className={({ isActive }) => (isActive ? 'active' : '')}>
            Community
          </NavLink>
          <NavLink to="/documents" className={({ isActive }) => (isActive ? 'active' : '')}>
            Documents
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-chip">
            <span className="avatar">{initial}</span>
            <span>{user?.full_name}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>Log out</button>
        </div>
      </aside>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
