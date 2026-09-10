import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { ApiError } from '../api/client';
import Reveal from '../components/Reveal';
import {
  formatDate,
  onboardingStatusLabel,
  onboardingStatusTone,
} from '../lib/format';

interface Department {
  id: string;
  name: string;
}

interface OverviewRow {
  id: string;
  user_id: string;
  status: string;
  start_date: string;
  employee_name: string;
  joinee_id: string | null;
  personal_email: string | null;
  department_name: string;
  template_name: string;
  required_task_count: number;
  required_task_completed_count: number;
}

/** The list endpoint caps `limit` at 100 server-side, and its allow-list 400s on
 *  an unknown `search` key — so search and the stat tiles are computed over the
 *  first 100 onboardings, client-side. Stated in the UI rather than implied. */
const PAGE_LIMIT = 100;

/**
 * "Onboarding Overview" — the HR dashboard as a scannable roster: four headline
 * numbers, one search box, two filters, and a table where every row leads to
 * that joinee's profile.
 *
 * Deliberately a SEPARATE route from /hr rather than a restyle of it. /hr is
 * where HR lands on login and it stays exactly as it was; this is the new
 * "Dashboard" nav entry.
 */
export default function HrOverview() {
  const authedFetch = useAuthedFetch();
  const navigate = useNavigate();
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, depts] = await Promise.all([
        authedFetch<{ data: OverviewRow[]; total: number }>(`/onboardings?limit=${PAGE_LIMIT}`),
        authedFetch<Department[]>('/departments'),
      ]);
      setRows(list.data);
      setTotal(list.total);
      setDepartments(depts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the overview');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const completed = rows.filter((r) => r.status === 'completed').length;
    const closed = rows.filter((r) => r.status === 'cancelled').length;
    const inProgress = rows.length - completed - closed
      - rows.filter((r) => r.status === 'pre_onboarding').length;
    const pending = rows.filter((r) => r.status === 'pre_onboarding').length;
    // Average of each joinee's own required-task completion, not a pooled
    // ratio — otherwise one joinee with 20 tasks outweighs five with 4.
    const avg = rows.length
      ? Math.round(
          rows.reduce(
            (sum, r) =>
              sum + (r.required_task_count ? r.required_task_completed_count / r.required_task_count : 0),
            0,
          ) / rows.length * 100,
        )
      : 0;
    return { total: rows.length, pending, inProgress, completed, avg };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (department && r.department_name !== department) return false;
      if (statusFilter && onboardingStatusTone(r.status) !== statusFilter) return false;
      if (!q) return true;
      return (
        r.employee_name?.toLowerCase().includes(q) ||
        (r.joinee_id ?? '').toLowerCase().includes(q) ||
        (r.personal_email ?? '').toLowerCase().includes(q) ||
        (r.department_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, department, statusFilter]);

  return (
    <div className="overview">
      <Reveal>
        <header className="overview-head">
          <div className="overview-head-text">
            <span className="overview-eyebrow">
              <span className="overview-eyebrow-dot" />
              Admin dashboard
            </span>
            <h1 className="overview-title">
              Onboarding <em>Overview</em>
            </h1>
            <p className="overview-lede">
              Track and manage all joinees’ onboarding progress from one place.
            </p>
          </div>
          <button type="button" className="btn-solid btn-lg" onClick={() => navigate('/hr')}>
            <PlusIcon />
            Create New Joinee
          </button>
        </header>
      </Reveal>

      {error && <p className="error-text">{error}</p>}

      <Reveal delay={0.06}>
        <div className="stat-row">
          <StatCard value={String(stats.total)} label="Total Joinees" sub={`of ${total} tracked`} tone="neutral" />
          <StatCard value={String(stats.inProgress)} label="In Progress" sub="Active" tone="progress" />
          <StatCard value={String(stats.completed)} label="Completed" sub="Fully onboarded" tone="done" />
          <StatCard value={`${stats.avg}%`} label="Avg. Completion" sub="Across all" tone="accent" />
        </div>
      </Reveal>

      <Reveal delay={0.12}>
        <div className="overview-controls">
          <label className="search-field">
            <SearchIcon />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, ID, or department…"
              aria-label="Search joinees"
            />
            {search && (
              <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="Clear search">
                ×
              </button>
            )}
          </label>

          <div className="overview-filters">
            <select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="progress">In progress</option>
              <option value="done">Completed</option>
            </select>
            <button type="button" className="btn-solid btn-sm" onClick={() => navigate('/hr')}>
              <PlusIcon />
              New Joinee
            </button>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.18}>
        <div className="roster">
          <div className="roster-head" role="row">
            <span>Joinee</span>
            <span>ID</span>
            <span>Department</span>
            <span>Joining date</span>
            <span>Progress</span>
            <span>Status</span>
            <span />
          </div>

          {loading ? (
            [0, 1, 2, 3].map((i) => (
              <div className="roster-row is-skeleton" key={i} style={{ ['--row' as string]: i }}>
                <span className="skeleton-line" />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className="roster-empty">
              <p>
                {rows.length === 0
                  ? 'No onboardings yet. Create your first joinee to get started.'
                  : 'No joinees match those filters.'}
              </p>
            </div>
          ) : (
            filtered.map((r, i) => (
              <RosterRow key={r.id} row={r} index={i} onOpen={() => navigate(`/hr?profile=${r.user_id}`)} />
            ))
          )}
        </div>

        {total > rows.length && (
          <p className="roster-foot muted">
            Showing the first {rows.length} of {total} onboardings. Search and the figures above
            cover these {rows.length}.
          </p>
        )}
      </Reveal>
    </div>
  );
}

function RosterRow({
  row,
  index,
  onOpen,
}: {
  row: OverviewRow;
  index: number;
  onOpen: () => void;
}) {
  const pct = row.required_task_count
    ? Math.round((row.required_task_completed_count / row.required_task_count) * 100)
    : 0;
  const tone = onboardingStatusTone(row.status);
  const initial = row.employee_name?.trim()?.[0]?.toUpperCase() ?? '?';

  return (
    <div className="roster-row" style={{ ['--row' as string]: index }}>
      <span className="roster-joinee">
        <span className="roster-avatar" aria-hidden="true">
          {initial}
        </span>
        <span className="roster-joinee-text">
          <strong>{row.employee_name}</strong>
          <small>{row.personal_email ?? row.template_name}</small>
        </span>
      </span>

      <span>
        {row.joinee_id ? (
          <code className="id-pill">{row.joinee_id}</code>
        ) : (
          <span className="muted">—</span>
        )}
      </span>

      <span>
        <span className="dept-pill">{row.department_name}</span>
      </span>

      <span className="roster-date">{formatDate(row.start_date)}</span>

      <span className="roster-progress">
        <span className="roster-progress-track">
          <span
            className={`roster-progress-fill is-${tone}`}
            style={{ width: `${pct}%` }}
          />
        </span>
        <small>
          {row.required_task_completed_count}/{row.required_task_count}
        </small>
      </span>

      <span>
        <span className={`state-pill state-pill--${tone}`}>{onboardingStatusLabel(row.status)}</span>
      </span>

      <span className="roster-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onOpen}>
          View
        </button>
      </span>
    </div>
  );
}

function StatCard({
  value,
  label,
  sub,
  tone,
}: {
  value: string;
  label: string;
  sub: string;
  tone: 'neutral' | 'progress' | 'done' | 'accent';
}) {
  return (
    <div className={`stat-card stat-card--${tone}`}>
      <span className="stat-card-value">{value}</span>
      <span className="stat-card-text">
        <strong>{label}</strong>
        <small>{sub}</small>
      </span>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}
