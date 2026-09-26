import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { rosterQueryIsActive, withParam } from '../lib/rosterQuery';
import { formatPhone } from '../lib/format';
import NotificationBell from './NotificationBell';
import { BrandMark, BrandWord } from './BrandLogo';

interface SearchResult {
  id: string;
  full_name: string;
  joinee_id: string;
  phone_number: string;
  department: string | null;
  role: string;
}

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
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
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
  const authedFetch = useAuthedFetch();

  const [params, setParams] = useSearchParams();

  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [spotlightQuery, setSpotlightQuery] = useState('');

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

  function closeSearch() {
    setSearchOpen(false);
    setSpotlightQuery('');
    setSearchResults([]);
    setActiveIdx(-1);
  }

  function openResult(r: SearchResult) {
    closeSearch();
    navigate({ pathname: '/hr', search: `?profile=${r.id}` });
  }

  useEffect(() => {
    if (!searchOpen || !spotlightQuery.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      setActiveIdx(-1);
      return;
    }
    setSearchLoading(true);
    setActiveIdx(-1);
    const t = setTimeout(() => {
      authedFetch<{ results: SearchResult[] }>(
        `/employee-profile/search?q=${encodeURIComponent(spotlightQuery)}`,
      )
        .then((d) => setSearchResults(d.results))
        .catch(() => setSearchResults([]))
        .finally(() => setSearchLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [spotlightQuery, searchOpen]);

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

          {(
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

        {/* Spotlight search overlay — portalled so it covers the whole viewport */}
        {searchOpen && createPortal(
          <div
            className="search-spotlight-backdrop"
            onMouseDown={(e) => { if (e.target === e.currentTarget) closeSearch(); }}
          >
            <div className="search-spotlight" ref={searchBoxRef}>
              <div className="search-spotlight-bar">
                <svg className="search-spotlight-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  className="search-spotlight-input"
                  value={spotlightQuery}
                  onChange={(e) => setSpotlightQuery(e.target.value)}
                  placeholder="Search by name, ID, mobile, or department…"
                  aria-label="Search employees"
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveIdx((i) => Math.min(i + 1, searchResults.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveIdx((i) => Math.max(i - 1, -1));
                    } else if (e.key === 'Enter' && activeIdx >= 0 && searchResults[activeIdx]) {
                      openResult(searchResults[activeIdx]);
                    }
                  }}
                />
                <button
                  type="button"
                  className="search-spotlight-esc"
                  onClick={closeSearch}
                  aria-label="Close search"
                >
                  ESC
                </button>
              </div>

              {spotlightQuery && (
                searchLoading ? (
                  <div className="search-spotlight-loading">Searching…</div>
                ) : searchResults.length > 0 ? (
                  <ul className="search-spotlight-results" role="listbox" aria-label="Search results">
                    {searchResults.map((r, i) => (
                      <li
                        key={r.id}
                        className={`search-spotlight-result${i === activeIdx ? ' is-active' : ''}`}
                        role="option"
                        aria-selected={i === activeIdx}
                        onMouseEnter={() => setActiveIdx(i)}
                        onMouseDown={() => openResult(r)}
                      >
                        <span className="search-spotlight-avatar">
                          {r.full_name.trim().charAt(0).toUpperCase()}
                        </span>
                        <span className="search-spotlight-result-info">
                          <span className="search-spotlight-result-name">{highlight(r.full_name, spotlightQuery)}</span>
                          <span className="search-spotlight-result-meta">
                            <span className="search-spotlight-result-id">{highlight(r.joinee_id, spotlightQuery)}</span>
                            {r.phone_number && (
                              <span className="search-spotlight-result-phone">
                                {highlight(formatPhone(r.phone_number) ?? r.phone_number, spotlightQuery)}
                              </span>
                            )}
                          </span>
                        </span>
                        {r.department && (
                          <span className="search-spotlight-result-dept">{highlight(r.department, spotlightQuery)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="search-spotlight-empty">
                    No employees match "<strong>{spotlightQuery}</strong>"
                  </div>
                )
              )}
            </div>
          </div>,
          document.body,
        )}

        <div className="topnav-end">
          {canSearchRoster && (
            <button
              ref={searchBtnRef}
              type="button"
              className="topnav-search-btn"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              aria-label="Search joinees"
              aria-expanded={searchOpen}
            >
              {IC.search}
            </button>
          )}

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
              <button
                type="button"
                className="topnav-menu-item"
                role="menuitem"
                onClick={() => navigate('/profile')}
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
        </div>
      </header>

      <main className="app-main">
        {/* One measure for every page. The shell stays full width so its dot
            field and washes still reach the edges; only the CONTENT is
            capped and centred, which is why this is a wrapper rather than a
            max-width on .app-main itself. */}
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function highlight(text: string, needle: string) {
  const n = needle.trim();
  if (!n) return text;
  const idx = text.toLowerCase().indexOf(n.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + n.length)}</mark>
      {text.slice(idx + n.length)}
    </>
  );
}
