import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROSTER_PATH, rosterQueryIsActive, withParam } from '../lib/rosterQuery';
<<<<<<< HEAD
import NotificationBell from './NotificationBell';
=======
import { BrandMark, BrandWord } from './BrandLogo';
>>>>>>> 6f9214e (New to mac feature added)

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
  mac: <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="3" width="12" height="9" rx="1.3" stroke="currentColor" strokeWidth="1.3"/><path d="M1.5 15h15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  chevron: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>,
};

// PARKED-FEATURE: diary, community, gallery — the tabs are commented out
// of all three role menus below. The IC.gallery / IC.diary / IC.community
// icons are left defined above so restoring a tab is a one-line change.
const NAV_EMPLOYEE: NavItem[] = [
  // Home IS the trail now: the employee had a Home and a My Tasks tab
  // where Home was a landing page they passed through, so the two are one.
  { to: '/start-here', label: 'Home', icon: IC.home },
  // { to: '/events', label: 'Gallery', icon: IC.gallery },
  { to: '/documents', label: 'Policies', icon: IC.policies },
  // { to: '/work-log', label: 'Diary', icon: IC.diary },
  { to: '/benefits', label: 'Benefits', icon: IC.benefits },
  { to: '/mac-tools', label: 'Mac Tools', icon: IC.mac },
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

  const [params, setParams] = useSearchParams();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pill, setPill] = useState({ left: 0, width: 0 });

  const capsuleRef = useRef<HTMLElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBtnRef = useRef<HTMLButtonElement>(null);

  const items = navForRole(user?.role);

  /* Only HR has a roster for these controls to narrow, so the search is
     rendered for that role alone rather than as a dead icon for everyone. */
  const canSearchRoster = user?.role === 'superadmin_hr';

  const query = params.get('q') ?? '';

  /* One writer for all four params: it preserves everything else on the URL
     (notably `?profile=`), drops a key when it is cleared, and replaces the
     history entry so typing does not fill the back button. */
  const setParam = useCallback(
    (key: string, value: string) => setParams(withParam(params, key, value), { replace: true }),
    [params, setParams],
  );


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

  /* A filter set from another page would narrow a list that is not on
     screen, so searching takes you to the roster. */
  useEffect(() => {
    // Carrying the search string over so a pasted filter URL is not wiped.
    if (searchOpen && pathname !== ROSTER_PATH)
      navigate({ pathname: ROSTER_PATH, search: window.location.search });
  }, [searchOpen, pathname, navigate]);

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

  /* The field used to stay open until its own close button was clicked — a
     click anywhere else, including on another control, left it sitting over
     the nav links. The search button is excluded so it still toggles rather
     than closing and reopening on one click. */
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (searchBoxRef.current?.contains(t) || searchBtnRef.current?.contains(t)) return;
      closeSearch();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSearch();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });

  async function handleLogout() {
    // Server-side logout revokes the session row and clears the three
    // auth cookies. Awaiting the round trip means the browser's cookie
    // jar is empty before we send them back to the login page — a
    // click-then-refresh race can't leave the tab in a half-signed-in
    // state where the cookies still exist but React state is gone.
    await logout();
    navigate('/login');
  }

  /* Collapsing the field does NOT clear the filter it applied.
   *
   * It used to, and that was a bug with two faces. The listener below fires
   * on mousedown, so clicking a row action on the roster wiped `q` BEFORE
   * the click landed: the list re-rendered unfiltered, the button under the
   * pointer was replaced by a different row's, and the click reached
   * nothing. HR saw an action that did nothing AND their search thrown
   * away, from one press.
   *
   * Keeping the filter is also the right behaviour on its own terms —
   * closing a control should not undo what it did, any more than closing
   * the department dropdown should reset the department. The roster shows
   * an explicit chip for the active search, and that chip is how you clear
   * it deliberately.
   */
  function closeSearch() {
    setSearchOpen(false);
  }

  /** The search button's own X, which is a deliberate "clear this". */
  function clearSearch() {
    setParam('q', '');
    setSearchOpen(false);
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

  return (
    <div className="app-shell">
      <header className="topnav">
        <NavLink to="/" className="topnav-brand">
          <BrandMark className="topnav-logo" />
          <BrandWord
            className="topnav-brand-text"
            brandClassName="topnav-brand-text__brand"
          />
        </NavLink>

        <nav ref={capsuleRef} className="topnav-glass" onMouseMove={trackGlare}>
          <span className="topnav-sheen" aria-hidden="true" />
          <span className="topnav-glare-clip" aria-hidden="true">
            <span ref={glareRef} className="topnav-glare" />
          </span>

          {canSearchRoster && (
            <>
              <button
                ref={searchBtnRef}
                type="button"
                className={`topnav-search-btn${rosterQueryIsActive(params) ? ' is-on' : ''}`}
                onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                aria-label="Search joinees"
                aria-expanded={searchOpen}
              >
                {IC.search}
              </button>
              <span className="topnav-divider" aria-hidden="true" />
            </>
          )}

          {searchOpen ? (
            <div className="topnav-search" ref={searchBoxRef}>
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setParam('q', e.target.value)}
                placeholder="Search by name, ID, or department"
                aria-label="Search joinees"
              />
              {/* The same round cross every popup in the app closes with,
                  rather than this one control spelling out "Esc".
                  This one DOES clear the filter: pressing the X on the field
                  you typed into is the deliberate "forget this search".
                  Clicking elsewhere, or Escape, only collapses the field. */}
              <button
                type="button"
                className="modal-close"
                onClick={clearSearch}
                aria-label="Clear and close search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
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

        <NotificationBell />

        <div className="topnav-user" ref={menuRef}>
          <button
            type="button"
            className="topnav-user-btn"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {/* No department tint here: HR accounts carry no department, so
                this avatar keeps the amber gradient. */}
            <span className="topnav-avatar">{initial}</span>
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
