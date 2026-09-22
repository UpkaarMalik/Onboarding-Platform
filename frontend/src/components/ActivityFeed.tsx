import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import ActivityLogPanel from './ActivityLogPanel';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { API_BASE_URL, ApiError, DATA_CHANGED_EVENT } from '../api/client';
import {
  activitySentence,
  activityTone,
  relativeTime,
  type ActivityPage,
  type ActivityRow,
} from '../lib/activity';

/**
 * The fallback cadence, not the main one.
 *
 * Updates arrive over SSE in milliseconds; this poll exists for when that
 * stream is not available — an expired access cookie (EventSource cannot
 * retry through a token refresh the way apiFetch does), a proxy that
 * buffers text/event-stream, a network that dropped it. Keeping it means
 * the feed degrades to "current within fifteen seconds" instead of
 * "frozen", and a poll that finds nothing new costs the UI nothing.
 */
const POLL_MS = 15_000;

/** Identity of a page of events, for deciding whether a poll changed
 *  anything. Ids are enough: the log is append-only, so a row can never be
 *  edited under us — only added, which changes this string. */
const signature = (rows: ActivityRow[]) => rows.map((r) => r.id).join(',');

/**
 * The last few real events, beside the roster on HR's home. Deliberately
 * short — it is a glance. "View all activity" opens the full, filterable
 * trail in a drawer rather than navigating: HR is usually mid-scan of the
 * roster when they want it, and losing that position to come back is the
 * thing that stops people looking.
 *
 * Updates arrive three ways, cheapest and most certain first:
 *
 *  - A local event, fired by apiFetch after any successful write from THIS
 *    tab. When HR creates a joinee, the server has already written the log
 *    row by the time the response lands, so this re-reads with no network
 *    push involved at all and nothing that can fail to arrive. This is the
 *    path that makes your own action feel immediate.
 *  - A server-sent event stream, for what OTHER people do.
 *  - The poll above, for when the stream is not there.
 *
 * The ping carries no data, so both paths end in the same `load()` against
 * the same endpoint — the stream changes WHEN we read, never WHAT we read
 * or who is allowed to. And because an unchanged read returns the same
 * array reference, a ping for an event this feed does not show repaints
 * nothing.
 */
export default function ActivityFeed({ limit = 7 }: { limit?: number }) {
  const authedFetch = useAuthedFetch();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  /* Kept in a ref rather than state: a refresh that lands while one is
     already in flight should be skipped, and putting that flag in state
     would re-render the list for something invisible. */
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const load = useCallback(
    async ({ initial }: { initial: boolean }) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const res = await authedFetch<ActivityPage>(`/activity-logs?limit=${limit}`);
        if (!mounted.current) return;
        /* Returning the SAME array reference tells React nothing changed and
           it skips the re-render entirely — so a poll that finds no new
           events costs the UI nothing at all: no repaint, no reflow, no
           flicker. The list only ever moves when there is something new on
           it. */
        setRows((prev) => (signature(prev) === signature(res.data) ? prev : res.data));
        setError((prev) => (prev === null ? prev : null));
      } catch (err) {
        // A failed poll keeps whatever is on screen. Replacing a good list
        // with an error because one refresh in the background timed out is
        // worse than being briefly stale.
        if (mounted.current && initial) {
          setError(err instanceof ApiError ? err.message : 'Could not load activity');
        }
      } finally {
        inFlight.current = false;
        if (mounted.current && initial) setLoading(false);
      }
    },
    [authedFetch, limit],
  );

  useEffect(() => {
    mounted.current = true;
    void load({ initial: true });

    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => void load({ initial: false }), POLL_MS);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };

    /* A hidden tab is a tab nobody is reading, and browsers throttle its
       timers anyway. Stopping is also what keeps a forgotten background tab
       from polling all night. Coming back refreshes at once rather than
       showing stale rows for up to another POLL_MS. */
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load({ initial: false });
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    /* Our own writes, already committed server-side by the time the
       response resolved. No round trip, no push, nothing to drop. */
    const onLocalChange = () => void load({ initial: false });
    window.addEventListener(DATA_CHANGED_EVENT, onLocalChange);

    /* withCredentials so the access cookie rides along — EventSource is
       same-origin by default and the API is on another port in dev.
       No manual reconnect logic: the browser retries a dropped stream on
       its own, and the poll above covers the gap while it is down. */
    let stream: EventSource | undefined;
    try {
      stream = new EventSource(`${API_BASE_URL}/activity-logs/stream`, {
        withCredentials: true,
      });
      stream.onmessage = () => void load({ initial: false });
    } catch {
      // No EventSource, or the URL was rejected. The poll is the whole
      // feature without it, so there is nothing to report.
    }

    return () => {
      mounted.current = false;
      stop();
      stream?.close();
      window.removeEventListener(DATA_CHANGED_EVENT, onLocalChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  return (
    <div className="home-panel activity-feed">
      <div className="home-section-head">
        <h2>Recent activity</h2>
      </div>

      {error && <p className="error-text">{error}</p>}
      {loading && !error && <p className="muted activity-feed-empty">Loading…</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="muted activity-feed-empty">Nothing has happened yet.</p>
      )}

      <ul className="activity-feed-list">
        {rows.map((row) => (
          <li key={row.id} className="activity-feed-item">
            <span className={`activity-feed-dot is-${activityTone(row.action)}`} aria-hidden="true" />
            <span className="activity-feed-body">
              <span className="activity-feed-text">{activitySentence(row)}</span>
              <span className="activity-feed-when">{relativeTime(row.created_at)}</span>
            </span>
          </li>
        ))}
      </ul>

      <button type="button" className="activity-feed-all" onClick={() => setShowAll(true)}>
        View all activity
      </button>

      {showAll && (
        <Modal
          title="Activity log"
          subtitle="Every change anyone has made, newest first."
          size="drawer"
          onClose={() => setShowAll(false)}
        >
          <ActivityLogPanel />
        </Modal>
      )}
    </div>
  );
}
