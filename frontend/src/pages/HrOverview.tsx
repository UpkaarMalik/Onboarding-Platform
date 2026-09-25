import type React from 'react';
import { CustomSelect } from '../components/CustomSelect';
import PersonSelect, { useEligiblePeople } from '../components/PersonSelect';
import DatePickerField from '../components/ui/DatePickerField';
import EmployeeProfileModal from '../components/EmployeeProfileModal';
import CopyButton from '../components/CopyButton';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError, describeError, openFileInline } from '../api/client';
import Modal from '../components/Modal';
import Reveal from '../components/Reveal';
import { avatarClass, deptLightClass, deptSlots, type DeptSlots } from '../lib/deptColor';
import {
  compareRows,
  ROSTER_PARAMS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  withParam,
  type RosterSort,
} from '../lib/rosterQuery';
import { addYears, format, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import {
  formatDate,
  onboardingStatusLabel,
  onboardingStatusTone,
} from '../lib/format';

interface Department {
  id: string;
  name: string;
}

interface DocumentType {
  id: string;
  code: string;
  label: string;
  is_default_required: boolean;
  is_sensitive: boolean;
}

interface OverviewRow {
  id: string;
  user_id: string;
  status: string;
  start_date: string;
  employee_name: string;
  joinee_id: string | null;
  personal_email: string | null;
  company_email: string | null;
  /** The USER's account state ('invited' | 'active' | 'disabled'), which is
   *  what gates sign-in — not the onboarding's own `status` above. */
  user_status: string;
  department_name: string;
  department_id: string;
  template_name: string;
  required_task_count: number;
  required_task_completed_count: number;
}

interface EmployeeProfile {
  user: {
    id: string;
    full_name: string;
    joinee_id: string;
    phone_number: string;
    personal_email: string | null;
    company_email: string | null;
    status: string;
    must_reset_password: boolean;
    department_name: string | null;
  };
  onboarding: {
    id: string;
    status: string;
    start_date: string;
    manager_name: string | null;
    buddy_name: string | null;
    template_name: string;
  } | null;
  documents: {
    requirement_id: string;
    status: string;
    label: string;
    upload_id: string | null;
    original_filename: string | null;
    mime_type: string | null;
    uploaded_at: string | null;
    review_status: string | null;
    review_note: string | null;
  }[];
  tasks: {
    pending: any[];
    completed: any[];
    requiredTotal: number;
    requiredCompleted: number;
  };
}

interface CredentialSummary {
  joineeId: string;
  temporaryPassword: string | null;
  awaitingFirstReset: boolean;
  hasLoggedIn: boolean;
  canRegenerate: boolean;
  note: string;
}

const PAGE_LIMIT = 100;
/** Rows per page in the roster. */
const ROSTER_PAGE_SIZE = 8;

const REQUIRED_DOC_CODES = ['aadhaar_card', 'pan_card', 'passport_photo'];

/**
 * The joinee roster. It used to be a page of its own at /hr/overview; it is
 * now rendered inside the HR home below the summary panels, so `embedded`
 * drops the parts the home already provides (its own hero and its own stat
 * row) and leaves the search, filters and table. `reloadKey` is how the home
 * tells it to refetch after it creates a joinee from its own button.
 */
/** What the HR home's summary cards narrow the roster to. `ids` is the set
 *  of onboarding ids to keep; `label` names the filter on its chip. */
export interface RosterFilter {
  key: string;
  label: string;
  ids: Set<string>;
}

export default function HrOverview({
  embedded = false,
  reloadKey = 0,
  cardFilter = null,
  onClearCardFilter,
}: {
  embedded?: boolean;
  reloadKey?: number;
  cardFilter?: RosterFilter | null;
  onClearCardFilter?: () => void;
} = {}) {
  const authedFetch = useAuthedFetch();
  /* Search, department, status and sort are driven by the nav's search
     control through the query string — see lib/rosterQuery.ts. The roster
     owns the rows; the nav owns the controls. */
  const [params, setParams] = useSearchParams();
  const department = params.get('dept') ?? '';
  const statusFilter = params.get('status') ?? '';
  const sort = (params.get('sort') ?? '') as RosterSort;
  /* The same three filters also sit in the nav. Both write the query string
     through withParam, so changing one moves the other — they are two views
     of one piece of state, not two copies of it. */
  const setParam = (key: string, value: string) =>
    setParams(withParam(params, key, value), { replace: true });

  const hasFilters = !!(department || statusFilter || sort || cardFilter);

  function clearAllFilters() {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        ROSTER_PARAMS.forEach((k) => next.delete(k));
        return next;
      },
      { replace: true },
    );
    onClearCardFilter?.();
  }
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  // One slot map for the page, so every row's avatar and badge agree.
  const slotMap = useMemo(() => deptSlots(departments), [departments]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateJoinee, setShowCreateJoinee] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [joinerCredentials, setJoinerCredentials] = useState<{
    loginId: string;
    temporaryPassword: string;
  } | null>(null);
  const [activeStatFilter, setActiveStatFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  /* The header clock. Its JSX arrived with the Gallery Update merge but the
     state behind it did not, so `clockTime` was an undeclared identifier and
     the project failed to typecheck. It renders only in the standalone header
     (`!embedded`), which nothing mounts today, so it was never going to throw
     at runtime — but it would have broken any typed build. */
  const [clockTime, setClockTime] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setClockTime(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  /* Restoring access is harmless and stays one click. Removing it locks a
     person out of the tool, so that direction gets a sentence explaining the
     consequence first. */
  const [confirmDisable, setConfirmDisable] = useState<OverviewRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, depts] = await Promise.all([
        // `-createdAt` = newest onboarding first (leading `-` is the DESC
        // marker parseSort recognises on the backend). Without this the
        // list defaulted to startDate ASC, which pushed a joinee HR just
        // created to whichever page their start date falls on — often
        // not page 1 — and forced a search to find them again.
        authedFetch<{ data: OverviewRow[]; total: number }>(
          `/onboardings?limit=${PAGE_LIMIT}&sort=-createdAt`,
        ),
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
    // reloadKey is the home page's "I just created someone" signal.
  }, [load, reloadKey]);

  const stats = useMemo(() => {
    const completed = rows.filter((r) => r.status === 'completed').length;
    const closed = rows.filter((r) => r.status === 'cancelled').length;
    const inProgress = rows.length - completed - closed
      - rows.filter((r) => r.status === 'pre_onboarding').length;
    const avg = rows.length
      ? Math.round(
          rows.reduce(
            (sum, r) =>
              sum + (r.required_task_count ? r.required_task_completed_count / r.required_task_count : 0),
            0,
          ) / rows.length * 100,
        )
      : 0;
    return { total: rows.length, inProgress, completed, avg };
  }, [rows]);

  const filtered = useMemo(() => {
    let result = rows;

    /* The home's cards narrow this list rather than opening a panel of their
       own, so the numbers at the top and the names below always agree. */
    if (cardFilter) result = result.filter((r) => cardFilter.ids.has(r.id));

    if (activeStatFilter) {
      if (activeStatFilter === 'total') result = rows;
      else if (activeStatFilter === 'progress')
        result = rows.filter((r) => !['completed', 'cancelled', 'pre_onboarding'].includes(r.status));
      else if (activeStatFilter === 'completed')
        result = rows.filter((r) => r.status === 'completed');
    }

    const depts = department ? department.split(',').filter(Boolean) : [];
    const statuses = statusFilter ? statusFilter.split(',').filter(Boolean) : [];
    const matched = result.filter((r) => {
      if (depts.length && !depts.includes(r.department_name ?? '')) return false;
      if (statuses.length && !statuses.includes(onboardingStatusTone(r.status))) return false;
      return true;
    });

    // Sorting a copy: `matched` is either `rows` itself or a fresh array, and
    // sorting in place would scramble the source list on the no-filter path.
    return sort ? [...matched].sort((a, b) => compareRows(sort, a, b)) : matched;
  }, [rows, department, statusFilter, sort, activeStatFilter, cardFilter]);

  /** Flip one joinee's sign-in access. The row is updated in place on success
   *  rather than refetching the whole list, so the page doesn't jump. */
  async function toggleEnabled(row: OverviewRow) {
    const enable = row.user_status === 'disabled';
    setTogglingId(row.user_id);
    setError(null);
    try {
      const res = await authedFetch<{ id: string; status: string }>(
        `/employee-profile/${row.user_id}/status`,
        { method: 'PATCH', body: { enabled: enable } },
      );
      setRows((prev) =>
        prev.map((r) => (r.user_id === row.user_id ? { ...r, user_status: res.status } : r)),
      );
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Could not ${enable ? 'enable' : 'disable'} ${row.employee_name}`,
      );
    } finally {
      setTogglingId(null);
    }
  }

  function toggleStat(key: string) {
    setActiveStatFilter((prev) => (prev === key ? null : key));
  }

  /* Paging is over the already-filtered list, so narrowing the search always
     starts you on page 1 of the new result rather than on an empty page N. */
  const pageCount = Math.max(1, Math.ceil(filtered.length / ROSTER_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice(
    (safePage - 1) * ROSTER_PAGE_SIZE,
    safePage * ROSTER_PAGE_SIZE,
  );
  useEffect(() => {
    setPage(1);
  }, [department, statusFilter, sort, activeStatFilter, cardFilter]);

  return (
    <div className={embedded ? 'overview overview--embedded' : 'overview'}>
      {!embedded && (
      <Reveal>
        <header className="overview-head">
          <div className="overview-head-text">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <span className="overview-eyebrow">
                  <span className="overview-eyebrow-dot" />
                  Admin dashboard
                </span>
                <h1 className="overview-title" style={{ margin: 0 }}>
                  Onboarding <em>Overview</em>
                </h1>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 12, padding: '8px 16px', fontSize: 13, fontWeight: 600,
                  color: 'var(--color-text)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--color-muted)" strokeWidth="1.3">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{format(clockTime, 'EEE, d MMM yyyy')}</span>
                  <span style={{ color: 'var(--color-muted)' }}>•</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{format(clockTime, 'hh:mm:ss a')}</span>
                </div>
                <button type="button" className="btn-solid" style={{ fontSize: 14, padding: '10px 24px', whiteSpace: 'nowrap', borderRadius: 12 }} onClick={() => setShowCreateJoinee(true)}>
                  + Create New Joinee
                </button>
              </div>
            </div>
            <p className="overview-lede">
              Track and manage all joinees' onboarding progress from one place.
            </p>
          </div>
        </header>
      </Reveal>
      )}

      {error && <p className="error-text">{error}</p>}

      {!embedded && (
      <Reveal delay={0.06}>
        <div className="stat-row">
          <div className={`stat-card stat-card--neutral${activeStatFilter === 'total' ? ' is-active' : ''}`} onClick={() => toggleStat('total')}>
            <span className="stat-card-value">{stats.total}</span>
            <span className="stat-card-text"><strong>Total Joinees</strong><small>This quarter</small></span>
          </div>
          <div className={`stat-card stat-card--progress${activeStatFilter === 'progress' ? ' is-active' : ''}`} onClick={() => toggleStat('progress')}>
            <span className="stat-card-value">{stats.inProgress}</span>
            <span className="stat-card-text"><strong>In Progress</strong><small>Active</small></span>
          </div>
          <div className={`stat-card stat-card--done${activeStatFilter === 'completed' ? ' is-active' : ''}`} onClick={() => toggleStat('completed')}>
            <span className="stat-card-value">{stats.completed}</span>
            <span className="stat-card-text"><strong>Completed</strong><small>Fully onboarded</small></span>
          </div>
          <div className="stat-card stat-card--accent" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <span className="stat-card-value">{stats.avg}%</span>
              <span className="stat-card-text"><strong>Avg. Completion</strong><small>Across all</small></span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowCreateJoinee(true); }}
              style={{
                alignSelf: 'flex-end',
                background: 'linear-gradient(135deg, #f59e0b, #d97706 50%, #b45309)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '6px 14px', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 8px -2px rgba(245,158,11,0.4)',
                transition: 'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.transform = 'translateY(-1px)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.transform = 'none'; }}
            >
              + Create Employee
            </button>
          </div>
        </div>
      </Reveal>
      )}

      <Reveal delay={0.12}>
        {/* One surface. Search, filters, table and pager used to be three
            separate bordered cards stacked on each other doing one job. */}
        <div className="roster-shell">
          <div className="roster-toolbar">
            <div className="roster-heading">
              {embedded && <h2>All joinees</h2>}
            </div>

            {/* The search box lives in the nav; these filters are here as well
                as there, reading and writing the same query params. */}
            <div className="roster-toolbar-row">
              <CustomSelect
                value={department}
                onChange={(v) => setParam('dept', v)}
                placeholder="All Departments"
                multi
                options={departments.map((d) => ({ value: d.name, label: d.name }))}
              />
              <CustomSelect
                value={statusFilter}
                onChange={(v) => setParam('status', v)}
                placeholder="All Statuses"
                multi
                options={STATUS_OPTIONS.filter((o) => o.value !== '')}
              />
              <CustomSelect
                value={sort}
                onChange={(v) => setParam('sort', v)}
                placeholder="Default order"
                options={SORT_OPTIONS}
              />

              {cardFilter && (
                <button
                  type="button"
                  className="roster-filter-chip"
                  onClick={onClearCardFilter}
                  aria-label={`Clear the ${cardFilter.label} filter`}
                >
                  <span className="roster-filter-chip-dot" aria-hidden="true" />
                  {cardFilter.label}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </div>

            <div className="roster-toolbar-actions">
              {hasFilters && (
                <button type="button" className="roster-clear-all" onClick={clearAllFilters} title="Clear all filters">
                  <svg className="roster-clear-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="2" y1="2" x2="12" y2="12"/>
                    <line x1="12" y1="2" x2="2" y2="12"/>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* The card holds its height whatever the filters leave behind, so
              searching down to one match does not collapse the panel and
              shove everything below it up the page. Reserved space is a full
              page of rows, or fewer when the roster itself is smaller than a
              page — a company with three joinees should not stare at five
              rows of nothing. `rows` here is the UNFILTERED list on purpose:
              that is what makes the height stop moving while you type. */}
          <div
            className="roster"
            style={
              {
                '--roster-reserved-rows': Math.min(ROSTER_PAGE_SIZE, Math.max(rows.length, 1)),
              } as React.CSSProperties
            }
          >
            {/* Each label is nudged to sit over the INK of its column, not the
                edge of its grid cell: the name starts past the avatar, and the
                pills carry their own padding. Aligning the boxes is not the
                same as aligning what you can see. */}
            <div className="roster-head" role="row">
              <span className="rh-joinee">Joinee</span>
              <span className="rh-pill">ID</span>
              <span className="rh-pill">Department</span>
              <span>Joining date</span>
              <span>Tasks done</span>
              <span className="rh-pill">Status</span>
              <span className="rh-actions">Actions</span>
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
              pageRows.map((r, i) => (
                <RosterRow
                  key={r.id}
                  row={r}
                  index={i}
                  busy={togglingId === r.user_id}
                  slots={slotMap}
                  onView={() => setProfileUserId(r.user_id)}
                  onToggleEnabled={() =>
                    r.user_status === 'disabled'
                      ? void toggleEnabled(r)
                      : setConfirmDisable(r)
                  }
                />
              ))
            )}
          </div>

          {filtered.length > 0 && (
            <div className="roster-pager">
              <span className="roster-pager-info">
                Showing {(safePage - 1) * ROSTER_PAGE_SIZE + 1}–
                {Math.min(safePage * ROSTER_PAGE_SIZE, filtered.length)} of {filtered.length}
                {total > rows.length && ` (first ${rows.length} of ${total} loaded)`}
              </span>
              <div className="roster-pager-controls">
                <button
                  type="button"
                  className="pager-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  aria-label="Previous page"
                >
                  ‹
                </button>
                {pageNumbers(safePage, pageCount).map((n, idx) =>
                  n === null ? (
                    <span className="pager-gap" key={`gap-${idx}`}>…</span>
                  ) : (
                    <button
                      type="button"
                      key={n}
                      className={`pager-btn${n === safePage ? ' is-current' : ''}`}
                      onClick={() => setPage(n)}
                      aria-current={n === safePage ? 'page' : undefined}
                    >
                      {n}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  className="pager-btn"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage === pageCount}
                  aria-label="Next page"
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </div>
      </Reveal>

      {profileUserId && (
        <EmployeeProfileModal
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
          onChanged={load}
        />
      )}

      {confirmDisable && (
        <Modal title="Block sign-in?" onClose={() => setConfirmDisable(null)}>
          <p>
            <strong>{confirmDisable.employee_name}</strong> will no longer be able to sign in with
            their Joinee ID and password. Any active session stops working on its next request.
          </p>
          <p className="muted">
            Their onboarding, tasks and documents are untouched. You can restore access at any time
            from this list.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setConfirmDisable(null)}>Cancel</button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                const target = confirmDisable;
                setConfirmDisable(null);
                void toggleEnabled(target);
              }}
            >
              Block sign-in
            </button>
          </div>
        </Modal>
      )}

      {showCreateJoinee && (
        <CreateJoineeWizard
          departments={departments}
          onClose={() => setShowCreateJoinee(false)}
          onCreated={(creds) => {
            setJoinerCredentials(creds);
            setShowCreateJoinee(false);
            void load();
          }}
        />
      )}

      {joinerCredentials && (
        <Modal title="Account created" onClose={() => setJoinerCredentials(null)}>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
            Shown once — share these directly with the joinee.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Login ID', value: joinerCredentials.loginId },
              { label: 'Password', value: joinerCredentials.temporaryPassword },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'var(--color-surface-alt)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>{label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '1rem', fontWeight: 600, color: 'var(--color-text)', background: 'none', border: 'none', padding: 0 }}>{value}</code>
                  <CopyButton text={value} />
                </div>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setJoinerCredentials(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** 1 … 4 5 6 … 12 — always the ends, always a window round the current page.
 *  `null` marks a gap. */
function pageNumbers(current: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(count - 1, current + 1);
  if (from > 2) out.push(null);
  for (let n = from; n <= to; n += 1) out.push(n);
  if (to < count - 1) out.push(null);
  out.push(count);
  return out;
}

function RosterRow({
  row,
  index,
  busy,
  slots,
  onView,
  onToggleEnabled,
}: {
  row: OverviewRow;
  index: number;
  busy: boolean;
  slots: DeptSlots;
  onView: () => void;
  onToggleEnabled: () => void;
}) {
  const pct = row.required_task_count
    ? Math.round((row.required_task_completed_count / row.required_task_count) * 100)
    : 0;
  const tone = onboardingStatusTone(row.status);
  const disabled = row.user_status === 'disabled';
  const name = row.employee_name?.trim() ?? '';
  const parts = name.split(/\s+/);
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name[0] ?? '?').toUpperCase();


  return (
    /* The row is the control: it carries role/tabIndex/aria-label, and the
       chevron is the visual hint. A column of eight identical View buttons
       was the same affordance repeated once per row. */
    <div
      className={`roster-row${disabled ? ' is-disabled' : ''}`}
      style={{ ['--row' as string]: index }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${row.employee_name}'s profile`}
      onClick={onView}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onView();
        }
      }}
    >
      <span className="roster-joinee">
        <span className={`roster-avatar ${avatarClass(slots, row.department_id)}`} aria-hidden="true">
          {initials}
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
        <span className={`dept-pill dept-pill--dept ${deptLightClass(slots, row.department_id)}`}>
          {row.department_name}
        </span>
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
          <span className="sr-only"> required tasks done</span>
        </small>
      </span>

      <span>
        <span className={`state-pill state-pill--${tone}`}>{onboardingStatusLabel(row.status)}</span>
      </span>

      <span className="roster-actions">
        {/* Just the switch. The profile icon duplicated the row itself —
            the whole row is already the button that opens the profile — and
            the Enabled/Disabled caption repeated what the switch position
            shows. What clicking will do lives in the tooltip. */}
        <button
          type="button"
          role="switch"
          aria-checked={!disabled}
          className={`row-switch${disabled ? ' is-off' : ''}${busy ? ' is-busy' : ''}`}
          disabled={busy}
          title={
            disabled
              ? `${row.employee_name} cannot sign in. Click to allow sign-in.`
              : `${row.employee_name} can sign in. Click to block sign-in.`
          }
          aria-label={`Sign-in access for ${row.employee_name}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleEnabled();
          }}
        >
          <span className="row-switch-track" aria-hidden="true">
            <span className="row-switch-knob" />
          </span>
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

/* ============================================================
   Create New Joinee — 3-step wizard
   ============================================================ */

export function CreateJoineeWizard({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: (creds: { loginId: string; temporaryPassword: string }) => void;
}) {
  const authedFetch = useAuthedFetch();
  const [step, setStep] = useState(1);

  // Step 1 fields
  const [fullName, setFullName] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startDate, setStartDate] = useState('');
  // User ids, picked from people who have completed their own onboarding.
  const [managerId, setManagerId] = useState('');
  const [buddyId, setBuddyId] = useState('');
  const people = useEligiblePeople();
  const personName = (id: string) => people?.find((p) => p.id === id)?.full_name;
  const [phoneNumber, setPhoneNumber] = useState('');
  /** Fields the user has left once. An error shown while someone is
   *  still typing their email is noise; the same error on blur is help. */
  const [touched, setTouched] = useState<Set<Step1Field>>(new Set());
  /** Flipped by Continue, so a click reveals everything still missing
   *  rather than leaving a disabled button with no explanation. */
  const [submitted, setSubmitted] = useState(false);
  const touch = (f: Step1Field) => setTouched((t) => (t.has(f) ? t : new Set(t).add(f)));

  // Step 2 fields
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  // Step 3
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<DocumentType[]>('/joinee-documents/types')
      .then((types) => {
        setDocTypes(types);
        const defaults = new Set(
          types.filter((t) =>
            t.is_default_required ||
            REQUIRED_DOC_CODES.includes(t.code)
          ).map((t) => t.id),
        );
        setSelectedDocs(defaults);
      })
      .catch(() => setDocTypes([]));
  }, [authedFetch]);

  function toggleDoc(id: string) {
    setSelectedDocs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Every rule for step 1 in one place, recomputed from the fields
   * rather than stored, so a message can never survive the thing it was
   * about. `null` means the field is fine.
   *
   * Deliberately not the same list as the server's: this is the fast,
   * local half. CreateJoineeDto still validates everything again, and
   * step 3 surfaces whatever it says — a joining date this accepts can
   * still be refused there if the department has no active template.
   */
  const step1Errors: Record<Step1Field, string | null> = {
    fullName:
      fullName.trim().length === 0
        ? 'Enter their full name'
        : fullName.trim().length < 2
          ? 'That looks too short to be a name'
          : // A pasted run of bare combining marks passes the filter
            // and the length check without being a word.
            !/\p{L}/u.test(fullName)
            ? 'A name needs at least one letter'
            : null,
    personalEmail:
      personalEmail.trim().length === 0
        ? 'Enter a personal email address'
        : !EMAIL_PATTERN.test(personalEmail.trim())
          ? 'That is not a valid email address'
          : null,
    phoneNumber:
      phoneNumber.length === 0
        ? 'Enter their mobile number'
        : phoneNumber.length < 10
          ? `${10 - phoneNumber.length} digit${10 - phoneNumber.length === 1 ? '' : 's'} still to go`
          : !/^[6-9]/.test(phoneNumber)
            ? 'Indian mobile numbers start with 6, 7, 8 or 9'
            : null,
    departmentId: departmentId ? null : 'Pick a department',
    startDate: !startDate
      ? 'Pick their joining date'
      : Number.isNaN(parseISO(startDate).getTime())
        ? 'That is not a valid date'
        : // parseISO, not Date.parse: the latter reads a bare
          // 'yyyy-MM-dd' as UTC MIDNIGHT, while startOfDay(new Date())
          // is LOCAL midnight. West of Greenwich local midnight falls
          // after UTC midnight, so today's own date lands on the wrong
          // side of the comparison and a perfectly valid joining date is
          // refused. parseISO keeps both sides local, which is the only
          // way the two are comparable.
          isBefore(parseISO(startDate), startOfDay(new Date()))
          ? 'Joining date cannot be in the past'
          : isAfter(parseISO(startDate), addYears(new Date(), 1))
            ? 'That is more than a year away — check the date'
            : null,
  };

  /** Show a field's error once the user has left it, or once they have
   *  tried to continue. */
  const errorFor = (f: Step1Field) =>
    submitted || touched.has(f) ? step1Errors[f] : null;

  /**
   * Continue is never disabled. A greyed-out button that will not say
   * what is wrong was the original complaint about this form, so the
   * click is what surfaces the errors and moves focus to the first one.
   */
  function goToStep2() {
    const firstBad = STEP1_ORDER.find((f) => step1Errors[f]);
    if (firstBad) {
      setSubmitted(true);
      // Covers both a plain <input> and CustomSelect's trigger button.
      const cell = document.getElementById(`joinee-field-${firstBad}`);
      (cell?.querySelector('input, button') as HTMLElement | null)?.focus();
      return;
    }
    setStep(2);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      /* One request, one transaction. This used to be POST /auth/users
         followed by POST /onboardings: when the second failed — a
         department with no active template answers 404 — the account
         already existed and its one-time password had already been
         generated and thrown away, leaving a person nobody could sign in
         as and a row someone had to delete by hand. */
      const res = await authedFetch<{
        credentials: { joineeId: string; temporaryPassword: string };
      }>('/onboardings/joinee', {
        method: 'POST',
        body: {
          fullName,
          phoneNumber: `91${phoneNumber}`,
          personalEmail,
          departmentId,
          startDate,
          // Both optional — HR often doesn't know the buddy on day one,
          // and can fill either in later from the joinee's profile.
          managerUserId: managerId || undefined,
          buddyUserId: buddyId || undefined,
          requiredDocumentTypeIds: selectedDocs.size ? [...selectedDocs] : undefined,
        },
      });
      onCreated({
        loginId: res.credentials.joineeId,
        temporaryPassword: res.credentials.temporaryPassword,
      });
    } catch (err) {
      /* The server's own words, not a house error. "No active template for
         this department" tells HR what to go and fix; "Something went
         wrong" sends them to whoever wrote this. */
      setError(describeError(err));
      // Back to Confirm, where the message is, if a later step ever moves.
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  const deptName = departments.find((d) => d.id === departmentId)?.name ?? '—';


  /* Portalled into <body>, exactly like the shared Modal component and
     for exactly the reason its docstring gives. .hr-dashboard carries
     `isolation: isolate`, which makes it a stacking context, so a
     backdrop rendered inside it had its z-index:50 scored against its
     siblings rather than against the page — and .topnav (z-index 40, in
     the root context) painted straight over the top of the dialog,
     hiding the eyebrow and the title behind the nav capsule. A portal
     puts the dialog out of reach of that rule permanently.

     The inline max-height is gone with it: .modal already caps itself at
     min(86vh, 100vh - 3rem), and the override was fighting that. */
  return createPortal(
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal modal--xl">
        {/* Header */}
        <div className="modal-head" style={{ borderBottom: '2px solid var(--color-amber-line)', padding: '1rem 1.5rem 0.7rem' }}>
          <div className="modal-head-text">
            {/* "Admin · Onboarding" said nothing: HR only ever opens
                admin onboarding screens, so it categorised the dialog
                against a set of one. The slot now carries where you are
                in the wizard, which is the one thing that changes. */}
            <span className="overview-eyebrow" style={{ marginTop: 0, marginBottom: 6 }}>
              <span className="overview-eyebrow-dot" />
              {STEP_COPY[step - 1].eyebrow}
            </span>
            <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>
              Create New <span style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontWeight: 600, color: 'var(--color-accent)' }}>Joinee</span>
            </h2>
            <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--color-muted)' }}>
              {STEP_COPY[step - 1].sub}
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" /></svg>
          </button>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, padding: '14px 24px 12px', flexShrink: 0, borderBottom: '1px solid var(--color-border)' }}>
          <StepDot num={1} label="Details" active={step === 1} done={step > 1} />
          <div style={{ width: 60, height: 2, background: step > 1 ? 'var(--color-success)' : 'var(--color-border)' }} />
          <StepDot num={2} label="Documents" active={step === 2} done={step > 2} />
          <div style={{ width: 60, height: 2, background: step > 2 ? 'var(--color-success)' : 'var(--color-border)' }} />
          <StepDot num={3} label="Confirm" active={step === 3} done={false} />
        </div>

        {/* Body */}
        <div className="modal-body" style={{ padding: '1rem 1.5rem' }}>
          {error && <p className="error-text">{error}</p>}

          {step === 1 && (
            /* Two sections rather than one seven-cell grid. Seven fields
               in two columns leaves a hole, and the hole used to sit
               under Buddy with nothing to balance it. Four identity
               fields pair off exactly; the three placement dropdowns fill
               a three-column row and read as a set, which they are. */
            <div className="joinee-form">
              <section className="joinee-form__section">
                <p className="joinee-form__legend">Personal Details</p>
                <div className="joinee-grid">
                  <Field
                    name="fullName"
                    label="Full Name"
                    required
                    /* Says what the field will accept, so a character
                       vanishing as it is typed reads as a rule rather
                       than as the box being broken. */
                    hint="Letters and spaces only"
                    error={errorFor('fullName')}
                  >
                    <input
                      className="joinee-input"
                      value={fullName}
                      onChange={(e) => setFullName(cleanFullName(e.target.value))}
                      onBlur={() => touch('fullName')}
                      placeholder="e.g. Arjun Kapoor"
                      maxLength={80}
                      autoComplete="off"
                    />
                  </Field>

                  <Field
                    name="personalEmail"
                    label="Personal Email"
                    required
                    hint="Their own address, for reaching them before day one"
                    error={errorFor('personalEmail')}
                  >
                    <input
                      className="joinee-input"
                      type="email"
                      value={personalEmail}
                      onChange={(e) => setPersonalEmail(e.target.value)}
                      onBlur={() => touch('personalEmail')}
                      placeholder="e.g. arjun@gmail.com"
                      autoComplete="off"
                    />
                  </Field>

                  <Field
                    name="phoneNumber"
                    label="Mobile Number"
                    required
                    error={errorFor('phoneNumber')}
                  >
                    <div className="phone-input-group">
                      <span className="phone-prefix">+91</span>
                      <span className="phone-divider" aria-hidden="true">|</span>
                      <input
                        value={phoneNumber.length > 5 ? phoneNumber.slice(0, 5) + ' ' + phoneNumber.slice(5) : phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        onBlur={() => touch('phoneNumber')}
                        inputMode="numeric"
                        placeholder="98765 43210"
                        maxLength={11}
                        aria-label="Mobile number, without the +91"
                      />
                    </div>
                  </Field>

                  {/* plain, like the dropdowns: the control is a button,
                      and a <label> around it forwards a click on the
                      caption into opening the calendar. */}
                  <Field
                    plain
                    name="startDate"
                    label="Date of Joining"
                    required
                    hint="Today or later"
                    error={errorFor('startDate')}
                  >
                    <DatePickerField
                      value={startDate}
                      onChange={setStartDate}
                      /* Past days are greyed out rather than absent, and
                         step1Errors re-checks the same bound — the picker
                         is the convenience, not the guarantee. */
                      min={startOfDay(new Date())}
                      placeholder="Select a date"
                      invalid={Boolean(errorFor('startDate'))}
                      onClose={() => touch('startDate')}
                    />
                  </Field>
                </div>
              </section>

              <section className="joinee-form__section">
                <p className="joinee-form__legend">Job Details</p>
                <div className="joinee-grid joinee-grid--three">
                  <Field plain
                    name="departmentId"
                    label="Department"
                    required
                    error={errorFor('departmentId')}
                  >
                    <CustomSelect
                      value={departmentId}
                      onChange={(v) => { setDepartmentId(v); touch('departmentId'); }}
                      placeholder="Select a department"
                      options={departments.map((d) => ({ value: d.id, label: d.name }))}
                    />
                  </Field>

                  <Field plain name="managerId" label="Manager" optional>
                    <PersonSelect value={managerId} onChange={setManagerId} people={people} exclude={buddyId} placeholder="Select manager" />
                  </Field>

                  <Field plain name="buddyId" label="Buddy" optional>
                    <PersonSelect value={buddyId} onChange={setBuddyId} people={people} exclude={managerId} placeholder="Select buddy" />
                  </Field>
                </div>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="joinee-form">
              <section className="joinee-form__section">
                <div className="joinee-form__head">
                  <p className="joinee-form__legend">
                    Required Documents · {selectedDocs.size} selected
                  </p>
                  <div>
                    {/* Twelve checkboxes is enough that clearing them one
                        at a time to start again is a chore. */}
                    <button
                      type="button"
                      className="joinee-form__action"
                      onClick={() => setSelectedDocs(new Set(docTypes.map((t) => t.id)))}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      className="joinee-form__action"
                      onClick={() => setSelectedDocs(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="doc-picker__grid">
                  {docTypes.map((type) => (
                    <label key={type.id} className={`doc-picker__item${selectedDocs.has(type.id) ? ' is-selected' : ''}`}>
                      <input type="checkbox" checked={selectedDocs.has(type.id)} onChange={() => toggleDoc(type.id)} />
                      {type.label}
                    </label>
                  ))}
                </div>
                {/* Selecting nothing is allowed — it creates no document
                    task at all — but it is unusual enough to say out loud
                    rather than let it pass as an empty screen. */}
                <span className={`joinee-field__note ${selectedDocs.size === 0 ? 'field-error' : 'field-hint'}`}>
                  {selectedDocs.size === 0
                    ? 'No documents selected — the joinee will not be asked to upload anything.'
                    : 'The joinee uploads these from their Documents page; HR reviews each one.'}
                </span>
              </section>
            </div>
          )}

          {step === 3 && (
            /* Same three panels, same headings, same two/three column
               rhythm as the steps they summarise — the confirm screen is
               the form with the boxes locked, not a different layout.
               Each panel edits back to the step it came from, so a wrong
               value costs one click instead of two Backs. */
            <div className="joinee-form">
              <section className="joinee-form__section">
                <div className="joinee-form__head">
                  <p className="joinee-form__legend">Personal Details</p>
                  <button type="button" className="joinee-form__action" onClick={() => setStep(1)}>Edit</button>
                </div>
                <div className="joinee-confirm">
                  <ConfirmField label="Full Name" value={fullName} />
                  <ConfirmField label="Personal Email" value={personalEmail} />
                  {/* Shown with the same +91 the request sends, so what HR
                      confirms is what gets stored. */}
                  <ConfirmField label="Mobile Number" value={phoneNumber ? `+91 ${phoneNumber}` : ''} />
                  {/* formatDate, not the raw yyyy-mm-dd the date input holds —
                      every other date in the app reads "28 Sep 2026". */}
                  <ConfirmField label="Joining Date" value={formatDate(startDate) ?? startDate} />
                </div>
              </section>

              <section className="joinee-form__section">
                <div className="joinee-form__head">
                  <p className="joinee-form__legend">Job Details</p>
                  <button type="button" className="joinee-form__action" onClick={() => setStep(1)}>Edit</button>
                </div>
                <div className="joinee-confirm joinee-confirm--three">
                  <ConfirmField label="Department" value={deptName} />
                  <ConfirmField label="Manager" value={personName(managerId) ?? ''} empty="Not assigned" />
                  <ConfirmField label="Buddy" value={personName(buddyId) ?? ''} empty="Not assigned" />
                </div>
              </section>

              <section className="joinee-form__section">
                <div className="joinee-form__head">
                  <p className="joinee-form__legend">
                    Required Documents · {selectedDocs.size} selected
                  </p>
                  <button type="button" className="joinee-form__action" onClick={() => setStep(2)}>Edit</button>
                </div>
                <div className="joinee-docs__pills">
                  {docTypes.filter((t) => selectedDocs.has(t.id)).map((t) => (
                    <span key={t.id} className="dept-pill">{t.label}</span>
                  ))}
                  {selectedDocs.size === 0 && <span className="muted">None selected</span>}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="modal-actions" style={{ display: 'flex', justifyContent: step === 1 ? 'flex-end' : 'space-between', padding: '0.7rem 1.5rem 0.9rem' }}>
          {step > 1 && (
            <button type="button" onClick={() => setStep((s) => s - 1)}>
              ← Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              className="btn-solid"
              onClick={() => (step === 1 ? goToStep2() : setStep((s) => s + 1))}
            >
              Continue →
            </button>
          ) : (
            <button
              type="button"
              className="btn-solid"
              disabled={busy}
              onClick={submit}
            >
              {busy ? 'Creating…' : 'Create joinee'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * What a person's name may contain: letters and spaces, nothing else.
 *
 * Applied as it is typed, because users.full_name is what the joinee's
 * own screens, the roster, the activity log and their company email all
 * read from, and there is no screen in the app that can correct it
 * afterwards.
 *
 * Hyphens, apostrophes and full stops were allowed here until it was
 * decided they should not be — Anne-Marie, D'Souza and M.S. Dhoni will
 * have to be entered without their punctuation. That is a deliberate
 * choice, not an oversight, so please do not quietly widen this back.
 *
 * \p{L} rather than A–Z, and \p{M} alongside it, so "letters" means
 * letters in any alphabet: an ASCII-only rule would delete the matras
 * out of a name written in Devanagari and leave a mangled word behind.
 *
 * Runs of spaces collapse and a leading space is dropped, so a pasted
 * value cannot arrive pre-broken. A single trailing space survives —
 * removing it would make typing the space between two names impossible.
 */
export function cleanFullName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{M}\s]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s+/, '');
}

/**
 * Header copy, one entry per step.
 *
 * It used to be fixed: an "Admin · Onboarding" tag and "Fill in the
 * details below" — both still true on step 3, where there is nothing
 * left to fill in. A header that does not change is a header nobody
 * reads twice, so each step now says what it wants and step 3 says what
 * pressing the button will actually do.
 *
 * The credentials line is deliberately precise. Nothing in this flow
 * sends an email — the temporary password is rendered once, on the
 * screen after this one, and is never retrievable again. HR has to know
 * that before they create the account, not after they have closed the
 * dialog.
 */
const STEP_COPY = [
  {
    eyebrow: 'Step 1 of 3 · Details',
    sub: "Who they are and where they'll sit. Fields marked * are needed to create the account.",
  },
  {
    eyebrow: 'Step 2 of 3 · Documents',
    sub: 'Choose what they need to upload. These appear on their Documents page on day one.',
  },
  {
    eyebrow: 'Step 3 of 3 · Confirm',
    sub: "Check it over. Creating them returns a Joinee ID and a one-time password — shown once, for you to pass on. No email is sent.",
  },
];

/** The step-1 fields that can be wrong. Manager and buddy are absent on
 *  purpose — both are optional, so neither has a failure state. */
type Step1Field = 'fullName' | 'personalEmail' | 'phoneNumber' | 'startDate' | 'departmentId';

/** Reading order, so "focus the first problem" lands on the first
 *  problem the eye would reach and not on whichever key the object
 *  literal happened to list first. */
const STEP1_ORDER: Step1Field[] = [
  'fullName',
  'personalEmail',
  'phoneNumber',
  'startDate',
  'departmentId',
];

/** Something@something.tld. Deliberately loose — the only address that
 *  truly validates is one that receives mail, and a stricter pattern
 *  here would reject real addresses for no gain. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * One cell of the step-1 grid: caption, control, and a line underneath
 * for a hint or an error.
 *
 * The note is always rendered, even empty (see .joinee-field__note).
 * Before, only Personal Email carried a hint, and the extra line made
 * its cell taller than Full Name beside it — which pushed the entire
 * right-hand column half a row down and was most of why the form looked
 * unaligned.
 *
 * `plain` renders a <div> instead of a <label>: a <label> wrapped around
 * CustomSelect forwards a click on the caption to the trigger button and
 * opens the menu when nobody asked. For the real inputs the <label>
 * stays, which is also what associates the error text with the control
 * for a screen reader — the note lives inside the label.
 */
function Field({
  name,
  label,
  required,
  optional,
  hint,
  error,
  plain,
  children,
}: {
  name: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string | null;
  plain?: boolean;
  children: React.ReactNode;
}) {
  const Tag = plain ? 'div' : 'label';
  return (
    <Tag className={`joinee-field${error ? ' has-error' : ''}`} id={`joinee-field-${name}`}>
      <span className="joinee-field__label">
        {label}
        {required && ' *'}
        {optional && <span className="joinee-field__optional">(Optional)</span>}
      </span>
      {children}
      <span className={`joinee-field__note ${error ? 'field-error' : 'field-hint'}`}>
        {error ?? hint ?? ''}
      </span>
    </Tag>
  );
}

function StepDot({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700,
        background: done ? 'var(--color-success)' : active ? 'var(--color-accent)' : 'var(--color-border)',
        color: done || active ? '#fff' : 'var(--color-muted)',
        transition: 'all 0.2s ease',
      }}>
        {done ? '✓' : num}
      </div>
      <span style={{ fontSize: 11, fontWeight: active ? 700 : 500, color: active ? 'var(--color-text)' : 'var(--color-muted)' }}>
        {label}
      </span>
    </div>
  );
}

/** One locked field on the confirm step. `empty` is the wording for a
 *  blank optional value — "Not assigned" says something, an em dash on
 *  its own leaves the reader guessing whether it failed to load. */
function ConfirmField({ label, value, empty = '—' }: { label: string; value: string; empty?: string }) {
  const blank = !value;
  return (
    <div className="joinee-confirm__cell">
      <div className="joinee-confirm__label">{label}</div>
      <div className={`joinee-confirm__value${blank ? ' is-empty' : ''}`}>{blank ? empty : value}</div>
    </div>
  );
}

/* ============================================================
   Employee Profile Modal (inline, not redirecting)
   ============================================================ */



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

// Moved to components/; re-exported so existing imports keep working.
export { CustomSelect };
