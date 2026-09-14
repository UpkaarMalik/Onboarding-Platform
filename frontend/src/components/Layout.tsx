import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

const IC = {
  home: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 9l6-6 6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 7.5V15h3v-4h2v4h3V7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  dashboard: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="10" y="2" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="2" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><rect x="10" y="10" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>,
  gallery: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M2 7h14M7 7v9" stroke="currentColor" strokeWidth="1.3"/></svg>,
  policies: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="2" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 6h6M6 9h6M6 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  diary: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="2" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 6h6M6 9h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  benefits: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  community: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="9" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M1 15c0-2 2-3 4-3h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10 15c0-2 1.5-3 3.5-3s3.5 1 3.5 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  auditLog: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M3 3h12v12H3zM3 9h12M9 3v12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  tasks: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="2" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 6l1.5 1.5L10 5M6 10l1.5 1.5L10 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
};

const NAV_EMPLOYEE: NavItem[] = [
  { to: '/start-here', label: 'Home', icon: IC.home },
  { to: '/tasks', label: 'My Tasks', icon: IC.tasks },
  { to: '/events', label: 'Gallery', icon: IC.gallery },
  { to: '/documents', label: 'Policies', icon: IC.policies },
  { to: '/work-log', label: 'Diary', icon: IC.diary },
  { to: '/benefits', label: 'Benefits', icon: IC.benefits },
  { to: '/community', label: 'Community', icon: IC.community },
];

const NAV_TASK_OWNER: NavItem[] = [
  { to: '/my-tasks', label: 'My Tasks', icon: IC.tasks },
  { to: '/community', label: 'Community', icon: IC.community },
  { to: '/documents', label: 'Policies', icon: IC.policies },
];

const NAV_SUPERADMIN: NavItem[] = [
  { to: '/hr', label: 'Home', icon: IC.home, end: true },
  { to: '/hr/overview', label: 'Dashboard', icon: IC.dashboard },
  { to: '/events', label: 'Gallery', icon: IC.gallery },
  { to: '/documents', label: 'Policies', icon: IC.policies },
  { to: '/work-log', label: 'Diary', icon: IC.diary },
  { to: '/benefits', label: 'Benefits', icon: IC.benefits },
  { to: '/community', label: 'Community', icon: IC.community },
];

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  task_owner: 'Task Owner',
  superadmin_hr: 'HR Admin',
};

function navForRole(role: string | undefined): NavItem[] {
  if (role === 'employee') return NAV_EMPLOYEE;
  if (role === 'task_owner') return NAV_TASK_OWNER;
  if (role === 'superadmin_hr') return NAV_SUPERADMIN;
  return [];
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [navHover, setNavHover] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const initial = user?.full_name
    ?.trim()
    ?.split(/\s+/)
    .map((w: string) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() ?? '?';
  const items = navForRole(user?.role);
  const roleLabel = ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? '';

  return (
    <div className={navHover ? 'nav-hovered' : ''} style={{ display: 'flex', minHeight: '100vh' }}>
      <aside className="sb" onMouseEnter={() => setNavHover(true)} onMouseLeave={() => setNavHover(false)}>
        <div className="sb-brand">
          <div className="sb-logo">A</div>
          <div>
            <div className="sb-title">AND Onboard</div>
            <div className="sb-sub">New Hire Portal</div>
          </div>
        </div>

        <nav className="sb-nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `sb-link${isActive ? ' sb-link--active' : ''}`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sb-footer">
          <div className="sb-user">
            <div className="sb-avatar">{initial}</div>
            <div>
              <div className="sb-uname">{user?.full_name}</div>
              <div className="sb-urole">{roleLabel}</div>
            </div>
          </div>
          <button className="sb-signout" onClick={handleLogout}>Sign out</button>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
