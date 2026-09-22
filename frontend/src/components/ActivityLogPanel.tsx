import { useEffect, useState } from 'react';
import { CustomSelect } from '../pages/HrOverview';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { ApiError } from '../api/client';
import { formatDateTime } from '../lib/format';
import {
  actionLabel,
  activityTone,
  detailLine,
  humanize,
  type ActivityPage,
  type ActivityRow,
} from '../lib/activity';

const PAGE_SIZE = 25;

/**
 * The full, filterable, paged audit trail. Rendered in two places — the
 * drawer that "View all activity" opens on HR's home, and the /audit-log
 * route that the same link deep-links to — so the two can't drift apart.
 */
export default function ActivityLogPanel() {
  const authedFetch = useAuthedFetch();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [entityType, setEntityType] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The filter lists only types the log actually contains. Asked for
  // once — it changes when a new KIND of thing gets logged, which is a
  // code change, not something that happens while the panel is open.
  useEffect(() => {
    let live = true;
    authedFetch<string[]>('/activity-logs/entity-types')
      .then((types) => live && setEntityTypes(types))
      .catch(() => live && setEntityTypes([]));
    return () => {
      live = false;
    };
  }, [authedFetch]);

  // Debounced, so typing "Nitin" is one request rather than five. 300ms
  // is below the threshold where the list feels like it lags the keyboard.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (entityType !== 'all') params.set('entityType', entityType);
    if (query.trim()) params.set('search', query.trim());
    let live = true;
    setLoading(true);
    setError(null);
    authedFetch<ActivityPage>(`/activity-logs?${params}`)
      .then((res) => {
        if (!live) return;
        setRows(res.data);
        setTotal(res.total);
      })
      .catch((err) => live && setError(err instanceof ApiError ? err.message : 'Something went wrong'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [authedFetch, entityType, query, offset]);

  const lastPage = offset + PAGE_SIZE >= total;

  return (
    <div className="activity-log">
      <div className="activity-log-bar">
        <div className="activity-log-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={search}
            placeholder="Search people, actions, documents…"
            aria-label="Search the activity log"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* The app's own select, not a native one. A native <select> on
            macOS opens its popup OVER the control, positioned so the
            currently-selected option lands under the pointer — so picking
            something near the bottom of the list made the next open appear
            shifted up the page, which reads as the panel jumping. This one
            always opens downward unless there is genuinely no room. */}
        <CustomSelect
          value={entityType}
          onChange={(v) => {
            setEntityType(v);
            // A filter that kept the old offset lands on an empty page
            // whenever the narrower result set is shorter than the offset.
            setOffset(0);
          }}
          options={[
            { value: 'all', label: 'All types' },
            ...entityTypes.map((t) => ({ value: t, label: humanize(t) })),
          ]}
        />
        <span className="activity-log-count">
          {total} {total === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {error && <p className="error-text">{error}</p>}
      {loading && !error && <p className="muted">Loading…</p>}
            {!loading && !error && rows.length === 0 && (
        <p className="muted">
          {query.trim() ? `Nothing matches “${query.trim()}”.` : 'Nothing recorded yet.'}
        </p>
      )}

      {rows.length > 0 && (
        <table className="activity-log-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What happened</th>
              <th>To whom</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const detail = detailLine(row.metadata);
              return (
                <tr key={row.id}>
                  <td data-label="When" className="activity-log-when">
                    {formatDateTime(row.created_at)}
                  </td>
                  <td data-label="Who">
                    {/* actor_id is NULL for anything the server did on its own. */}
                    {row.actor_name ?? <span className="activity-log-muted">System</span>}
                  </td>
                  <td data-label="What">
                    <span className="activity-log-what">
                      <span className={`activity-log-chip is-${activityTone(row.action)}`}>
                        {humanize(row.entity_type)}
                      </span>
                      <span>{actionLabel(row)}</span>
                    </span>
                    {detail && <div className="activity-log-detail">{detail}</div>}
                  </td>
                  <td data-label="To whom">
                    {row.target_name ?? <span className="activity-log-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="activity-log-foot">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </button>
        <span className="activity-log-page">
          {total === 0 ? '0' : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}
        </span>
        <button type="button" disabled={lastPage} onClick={() => setOffset(offset + PAGE_SIZE)}>
          Next
        </button>
      </div>
    </div>
  );
}
