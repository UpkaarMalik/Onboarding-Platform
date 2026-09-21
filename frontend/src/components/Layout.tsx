import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { avatarClass } from '../lib/deptColor';

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
  search: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  profile: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  signout: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
  chevron: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>,
};

// PARKED-FEATURE: diary, community, gallery — the tabs are commented out
// of all three role menus below. The IC.gallery / IC.diary / IC.community
// icons are left defined above so restoring a tab is a one-line change.
const NAV_EMPLOYEE: NavItem[] = [
  { to: '/start-here', label: 'Home', icon: IC.home },
  { to: '/tasks', label: 'My Tasks', icon: IC.tasks },
  // { to: '/events', label: 'Gallery', icon: IC.gallery },
  { to: '/documents', label: 'Policies', icon: IC.policies },
  // { to: '/work-log', label: 'Diary', icon: IC.diary },
  { to: '/benefits', label: 'Benefits', icon: IC.benefits },
  // { to: '/community', label: 'Community', icon: IC.community },
];

const NAV_TASK_OWNER: NavItem[] = [
  { to: '/my-tasks', label: 'My Tasks', icon: IC.tasks },
  // { to: '/community', label: 'Community', icon: IC.community },
  { to: '/documents', label: 'Policies', icon: IC.policies },
];

const NAV_SUPERADMIN: NavItem[] = [
  // The roster that used to live at /hr/overview is now a section of the
  // HR home, so it no longer earns its own tab.
  { to: '/hr', label: 'Home', icon: IC.home, end: true },
  // { to: '/events', label: 'Gallery', icon: IC.gallery },
  { to: '/documents', label: 'Policies', icon: IC.policies },
  // { to: '/work-log', label: 'Diary', icon: IC.diary },
  { to: '/benefits', label: 'Benefits', icon: IC.benefits },
  // { to: '/community', label: 'Community', icon: IC.community },
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
  const { pathname } = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pill, setPill] = useState({ left: 0, width: 0 });

  const capsuleRef = useRef<HTMLElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const items = navForRole(user?.role);

  /* The pill is measured off whichever link react-router marked active, so
     the URL drives it rather than a click handler — a redirect, a deep link
     or the back button all move it. Width 0 means "not measured yet", which
     the style below turns into opacity 0 so it never flashes at x=0. */
  const measurePill = useCallback(() => {
    const el = itemsRef.current?.querySelector<HTMLElement>('.topnav-link--active');
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : { left: 0, width: 0 });
  }, []);

  useLayoutEffect(measurePill, [measurePill, pathname, items, searchOpen]);

  useEffect(() => {
    window.addEventListener('resize', measurePill);
    // Label widths shift when the webfont swaps in, which would leave the
    // pill measured against the fallback face.
    document.fonts?.ready.then(() => measurePill());
    return () => window.removeEventListener('resize', measurePill);
  }, [measurePill]);

  useLayoutEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // Close the user menu on an outside click, on Escape, and on navigation.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => setMenuOpen(false), [pathname]);

  async function handleLogout() {
    // Server-side logout revokes the session row and clears the three
    // auth cookies. Awaiting the round trip means the browser's cookie
    // jar is empty before we send them back to the login page — a
    // click-then-refresh race can't leave the tab in a half-signed-in
    // state where the cookies still exist but React state is gone.
    await logout();
    navigate('/login');
  }

  function closeSearch() {
    setSearchOpen(false);
    setQuery('');
  }

  function trackGlare(e: React.MouseEvent<HTMLElement>) {
    const box = capsuleRef.current?.getBoundingClientRect();
    if (!box || !glareRef.current) return;
    // Feeding CSS variables rather than rebuilding the gradient string.
    glareRef.current.style.setProperty('--x', `${e.clientX - box.left}px`);
    glareRef.current.style.setProperty('--y', `${e.clientY - box.top}px`);
  }

  const initial = user?.full_name
    ?.trim()
    ?.split(/\s+/)
    .map((w: string) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() ?? '?';
  const roleLabel = ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? '';

  return (
    <div className="app-shell">
      <header className="topnav">
        <NavLink to="/" className="topnav-brand">
          <span className="topnav-logo">A</span>
          <span className="topnav-brand-text"><b>AND</b> Onboard</span>
        </NavLink>

        <nav ref={capsuleRef} className="topnav-glass" onMouseMove={trackGlare}>
          <span className="topnav-sheen" aria-hidden="true" />
          <span className="topnav-glare-clip" aria-hidden="true">
            <span ref={glareRef} className="topnav-glare" />
          </span>

          <button
            type="button"
            className="topnav-search-btn"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            aria-label="Search"
            aria-expanded={searchOpen}
          >
            {IC.search}
          </button>
          <span className="topnav-divider" aria-hidden="true" />

          {searchOpen ? (
            <div className="topnav-search">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                placeholder="Search people, documents, tasks…"
              />
              <button type="button" className="topnav-search-esc" onClick={closeSearch}>
                Esc
              </button>
            </div>
          ) : (
            <div className="topnav-items" ref={itemsRef}>
              <span
                className="topnav-pill"
                aria-hidden="true"
                style={{
                  width: pill.width,
                  transform: `translateX(${pill.left}px)`,
                  opacity: pill.width ? 1 : 0,
                }}
              />
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `topnav-link${isActive ? ' topnav-link--active' : ''}`}
                >
                  <span className="topnav-link-inner">
                    {item.icon}
                    {item.label}
                  </span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        <div className="topnav-user" ref={menuRef}>
          <button
            type="button"
            className="topnav-user-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className={`topnav-avatar ${avatarClass(user?.department_id)}`}>{initial}</span>
            <span className="topnav-user-text">
              <span className="topnav-user-name">{user?.full_name}</span>
              <span className="topnav-user-id">{user?.joinee_id}</span>
            </span>
            <span className={`topnav-chev${menuOpen ? ' is-open' : ''}`} aria-hidden="true">
              {IC.chevron}
            </span>
          </button>

          {menuOpen && (
            <div className="topnav-menu" role="menu">
              <div className="topnav-menu-head">
                <span className="topnav-menu-name">{user?.full_name}</span>
                <span className="topnav-menu-role">{roleLabel} · {user?.joinee_id}</span>
              </div>
              {/* There is no /profile route yet, so this is inert rather than
                  a click that quietly goes nowhere. */}
              <button
                type="button"
                className="topnav-menu-item"
                role="menuitem"
                aria-disabled="true"
                title="Profile page not built yet"
              >
                {IC.profile}
                Profile
              </button>
              <button
                type="button"
                className="topnav-menu-item topnav-menu-item--danger"
                role="menuitem"
                onClick={handleLogout}
              >
                {IC.signout}
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
