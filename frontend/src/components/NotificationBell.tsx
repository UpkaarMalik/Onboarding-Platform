import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../api/client';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { relativeTime } from '../lib/activity';
import Modal from './Modal';

/** The dropdown shows all unread notifications plus any read ones from the
 *  last hour. Anything older and already read is one click away under
 *  "View all". */
/**
 * Fired when the SERVER has told this browser something changed — a new
 * notification arrived, over the stream or on the poll that backs it up.
 *
 * The bell is the only thing in the app holding a server-push connection,
 * so it is also the only thing that knows when someone ELSE changed this
 * person's data. Without this, a joinee whose task HR has just blocked
 * saw the bell light up while the trail behind it went on showing the old
 * state until they reloaded the page — the change was announced and then
 * not shown, which reads as a broken page rather than as news.
 *
 * Distinct from api/client's DATA_CHANGED_EVENT on purpose: that one fires
 * after THIS tab's own writes, and pages already reload themselves after
 * their own actions. Reusing it here would double every one of those.
 */
export const SERVER_PUSH_EVENT = 'app:server-push';

const DROPDOWN_LIMIT = 5;
const RECENT_MS = 60 * 60 * 1000;

/**
 * Where clicking takes you. Every notification goes somewhere — there is
 * no such thing here as one you can only mark read.
 *
 * This used to hold a NEWS_ONLY_KINDS set that sorted the kinds into
 * "leads somewhere" and "news, nothing to do", and suppressed both the
 * navigation and the arrow for the second group. The split did not
 * survive contact: "your document was approved" and "a step of yours is
 * blocked" are both about a specific task on the trail, and being told
 * about one without being taken to it is worse than useless — you are
 * told something changed and then left to find it. The same argument
 * applies to every kind, which is why the set is gone rather than
 * shorter.
 *
 * It also returned null when the link matched the current URL, so a
 * notification clicked from the page it points at did nothing. That is
 * no longer a case worth special-casing: every task link now carries
 * ?task=<id>, so arriving there opens that task's popup, which is the
 * whole point even when the path is unchanged.
 */
function destination(n: { link: string }): string {
  return n.link;
}
const DRAWER_PAGE = 30;

interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string;
  read_at: string | null;
  created_at: string;
}

/* A filled bell in the theme's amber gradient (--gradient-accent's stops),
   with a deeper amber wash down the right side for depth. Built from plain
   shapes; the colours are the ones .topnav-avatar and the CTAs already use. */
const BELL = (
  <svg className="topnav-bell-icon" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
    <defs>
      <linearGradient id="bell-fill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fbbf24" />
        <stop offset="0.55" stopColor="#f59e0b" />
        <stop offset="1" stopColor="#d97706" />
      </linearGradient>
      <clipPath id="bell-body">
        <path d="M12 4.6c-3.6 0-5.8 2.7-5.8 6.3v4.3h11.6v-4.3c0-3.6-2.2-6.3-5.8-6.3z" />
        <rect x="3.6" y="14.6" width="16.8" height="3.4" rx="1.7" />
      </clipPath>
    </defs>
    <circle cx="12" cy="3.3" r="1.35" fill="none" stroke="#f59e0b" strokeWidth="1.1" />
    <path d="M10 18a2 2 0 0 0 4 0z" fill="#d97706" />
    <g clipPath="url(#bell-body)">
      <rect width="24" height="24" fill="url(#bell-fill)" />
      <path d="M14.5 4 24 13.5V24h-6L12.5 18.5 17.8 12z" fill="#b45309" opacity="0.18" />
    </g>
  </svg>
);

/** The top bar's bell. The server pings a stream the moment a notification
 *  for this user commits, and the bell re-reads; the 30s poll while visible
 *  covers a dropped stream. The count comes from the server, not from the 20
 *  rows it happens to have. */
export default function NotificationBell() {
  const authedFetch = useAuthedFetch();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Bumped on every successful load, so an open drawer re-reads too. */
  const [tick, setTick] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /** id of the newest row this browser has seen, so a load can tell a
   *  genuinely new notification from a re-read that returned the same
   *  list. A ref, not state: nothing renders from it. */
  const newestSeen = useRef<string | null>(null);

  const load = useCallback(() => {
    if (document.hidden) return;
    authedFetch<{ data: Notification[]; unreadCount: number }>(`/notifications?limit=${DROPDOWN_LIMIT}`)
      .then((res) => {
        setItems(res.data);
        setUnread(res.unreadCount);
        setTick((t) => t + 1);

        // Announced from here rather than from the stream's onmessage so
        // the 30s poll raises it too — otherwise a browser whose stream
        // has dropped is exactly the one still showing stale data.
        const newest = res.data[0]?.id ?? null;
        const first = newestSeen.current === null;
        if (newest && newest !== newestSeen.current) {
          newestSeen.current = newest;
          // Not on the very first load: arriving on a page with unread
          // notifications is not news, and firing here would make every
          // listener re-fetch data it has only just fetched.
          if (!first) window.dispatchEvent(new CustomEvent(SERVER_PUSH_EVENT));
        }
      })
      // A failed poll keeps the last good list; the next tick retries.
      .catch(() => {});
  }, [authedFetch]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30_000);
    document.addEventListener('visibilitychange', load);
    // Same wiring as ActivityFeed: the browser reconnects a dropped stream
    // on its own, and the poll above covers the gap.
    let stream: EventSource | undefined;
    try {
      stream = new EventSource(`${API_BASE_URL}/notifications/stream`, { withCredentials: true });
      stream.onmessage = load;
    } catch {
      // No EventSource: the poll is the whole feature without it.
    }
    return () => {
      stream?.close();
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', load);
    };
  }, [load]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  // Outside click closes; Escape closes and hands focus back to the bell.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  function toggle() {
    if (!open) load();
    setOpen((o) => !o);
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0);
    rows[next]?.focus();
  }

  /** Shared by the dropdown and the drawer: mark read, re-read the count,
   *  go where the notification points. */
  async function openItem(n: Notification) {
    if (!n.read_at) {
      await authedFetch(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
      load();
    }
    close(false);
    setDrawerOpen(false);
    navigate(destination(n));
  }

  async function markAll() {
    await authedFetch('/notifications/read-all', { method: 'POST' }).catch(() => {});
    load();
  }

  function viewAll() {
    close(false);
    setDrawerOpen(true);
  }

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  // Unread notifications always show regardless of age — hiding them would
  // leave the badge count with nothing behind it. Read ones drop out after
  // an hour so the dropdown stays focused on recent activity.
  const recent = items.filter((n) => !n.read_at || Date.now() - Date.parse(n.created_at) < RECENT_MS);

  return (
    <div className="topnav-bell" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="topnav-bell-btn"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {BELL}
        {unread > 0 && (
          <span className="topnav-bell-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="topnav-menu topnav-bell-panel" role="menu" aria-label="Notifications" ref={listRef} onKeyDown={onListKey}>
          <div className="topnav-bell-head">
            <span>Notifications</span>
            {unread > 0 && (
              <button type="button" className="topnav-bell-markall" onClick={markAll}>
                Mark all as read
              </button>
            )}
          </div>
          {recent.length === 0 ? (
            <p className="topnav-bell-empty">
              No new notifications in the last hour.{' '}
              {"We'll let you know when something changes."}
            </p>
          ) : (
            recent.map((n, i) => (
              // First row takes focus on open, so Enter-then-arrows works.
              <NotificationRow key={n.id} n={n} onOpen={openItem} menu autoFocus={i === 0} />
            ))
          )}
          {/* Always offered, so older notifications stay reachable when the
              last hour is empty. Focused first when there are no rows. */}
          <button
            type="button"
            role="menuitem"
            className="topnav-bell-foot"
            onClick={viewAll}
            autoFocus={recent.length === 0}
          >
            View all
          </button>
        </div>
      )}

      {drawerOpen && (
        <NotificationsDrawer
          tick={tick}
          unread={unread}
          onOpen={openItem}
          onMarkAll={markAll}
          onClose={() => {
            setDrawerOpen(false);
            btnRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function NotificationRow({
  n,
  onOpen,
  menu = false,
  autoFocus = false,
}: {
  n: Notification;
  onOpen: (n: Notification) => void;
  menu?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="button"
      role={menu ? 'menuitem' : undefined}
      className={`topnav-menu-item topnav-bell-row${n.read_at ? '' : ' is-unread'}`}
      onClick={() => onOpen(n)}
      autoFocus={autoFocus}
    >
      <span className="topnav-bell-dot" aria-hidden="true" />
      <span className="topnav-bell-text">
        <span className="topnav-bell-title">{n.title}</span>
        {n.body && <span className="topnav-bell-body">{n.body}</span>}
        <span className="topnav-bell-time">{relativeTime(n.created_at)}</span>
      </span>
      {/* On every row, because every row leads somewhere.

          A CLOSED square with the arrow inside it, tip meeting the
          top-right corner — not the open-sided box with a detached arrow
          that was here before. That one is the "external link, opens
          outside this site" convention, and it was saying the wrong
          thing: these all lead to another page of this same app. */}
      <svg className="topnav-bell-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
        <path d="M9.2 14.8L15 9" />
        <path d="M10.8 9H15v4.2" />
      </svg>
      <span className="sr-only">Opens the related page</span>
    </button>
  );
}

/** Every notification, newest first, in a quarter-width drawer. */
function NotificationsDrawer({
  tick,
  unread,
  onOpen,
  onMarkAll,
  onClose,
}: {
  tick: number;
  unread: number;
  onOpen: (n: Notification) => void;
  onMarkAll: () => void;
  onClose: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [more, setMore] = useState(false);

  const fetchPage = useCallback(
    (offset: number) =>
      authedFetch<{ data: Notification[] }>(`/notifications?limit=${DRAWER_PAGE}&offset=${offset}`).then(
        (res) => {
          setRows((prev) => (offset === 0 ? res.data : [...(prev ?? []), ...res.data]));
          setMore(res.data.length === DRAWER_PAGE);
        },
      ),
    [authedFetch],
  );

  // First page on open, and again whenever the bell learns of something new
  // or a row is marked read. ponytail: refetches from the top, so pages
  // loaded with "Load more" collapse on a new notification.
  useEffect(() => {
    fetchPage(0).catch(() => setRows((prev) => prev ?? []));
  }, [fetchPage, tick]);

  return (
    <Modal title="Notifications" size="panel" onClose={onClose}>
      <div className="notif-drawer-bar">
        <span>{unread ? `${unread} unread` : 'All caught up'}</span>
        {unread > 0 && (
          <button type="button" className="topnav-bell-markall" onClick={onMarkAll}>
            Mark all as read
          </button>
        )}
      </div>
      {rows === null ? (
        <p className="topnav-bell-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="topnav-bell-empty">Nothing new. We'll let you know when something changes.</p>
      ) : (
        <div className="notif-drawer-list">
          {rows.map((n) => (
            <NotificationRow key={n.id} n={n} onOpen={onOpen} />
          ))}
          {more && (
            <button type="button" className="notif-drawer-more" onClick={() => fetchPage(rows.length)}>
              Load more
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
