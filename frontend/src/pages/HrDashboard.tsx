import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError, openFileInline } from '../api/client';
import { formatDate } from '../lib/format';
import Modal from '../components/Modal';
import Reveal from '../components/Reveal';
import AnimatedProgressBar from '../components/AnimatedProgressBar';

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

/** One requirement plus its current (non-superseded) upload, as returned
 *  by /employee-profile/:id and /joinee-documents/users/:id. */
interface JoineeDocument {
  requirement_id: string;
  status: 'awaiting_upload' | 'submitted' | 'approved' | 'rejected';
  label: string;
  upload_id: string | null;
  original_filename: string | null;
  mime_type: string | null;
  uploaded_at: string | null;
  review_status: 'pending_review' | 'approved' | 'rejected' | null;
  review_note: string | null;
}

interface ProfileTask {
  id: string;
  title: string;
  status: string;
  due_date: string;
  priority: string;
  is_required: boolean;
  system_key: string | null;
  completed_at: string | null;
  subtask_count: number;
  subtask_completed_count: number;
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
  documents: JoineeDocument[];
  tasks: {
    pending: ProfileTask[];
    completed: ProfileTask[];
    requiredTotal: number;
    requiredCompleted: number;
  };
}

const LIMIT = 10;
const PIPELINE_STAGES = [
  { key: 'pre_onboarding', label: 'Pre-joining' },
  { key: 'email_provisioned', label: 'Email' },
  { key: 'checkpoint_pending', label: 'Checkpoint' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The HR/SuperAdmin dashboard: an overview (stat tiles, pipeline stage
 * counts, per-employee progress, a needs-attention feed pulled from
 * /onboardings/stuck) sitting above the detailed, filterable table
 * that already existed (Step 19/26/32/33 — allow-listed keys, {data,
 * total, limit, offset}). The overview reuses the same endpoints at a
 * larger page size rather than adding new summary endpoints — good
 * enough for the onboarding volumes this app deals with.
 */
export default function HrDashboard() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [view, setView] = useState<'all' | 'stuck'>('all');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selectedOnboarding, setSelectedOnboarding] = useState<any | null>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(
    // The Dashboard roster links here as /hr?profile=<userId> so its View
    // button lands on the joinee instead of making HR search again.
    () => new URLSearchParams(window.location.search).get('profile'),
  );

  const [overviewRows, setOverviewRows] = useState<any[]>([]);
  const [stuckTotal, setStuckTotal] = useState(0);
  const [attention, setAttention] = useState<any[]>([]);
  const [ratingSummary, setRatingSummary] = useState<{ average: number | null; count: number }>({
    average: null,
    count: 0,
  });

  const [showAddJoiner, setShowAddJoiner] = useState(false);
  const [showAddTaskOwner, setShowAddTaskOwner] = useState(false);
  const [joinerCredentials, setJoinerCredentials] = useState<{
    loginId: string;
    temporaryPassword: string;
  } | null>(null);
  const [provisionedEmail, setProvisionedEmail] = useState<string | null>(null);

  useEffect(() => {
    authedFetch<Department[]>('/departments')
      .then(setDepartments)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Something went wrong'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadOverview() {
    try {
      const [all, stuck, rating] = await Promise.all([
        authedFetch<{ data: any[]; total: number }>('/onboardings?limit=100'),
        authedFetch<{ data: any[]; total: number }>('/onboardings/stuck?limit=5'),
        authedFetch<{ average: number | null; count: number }>('/onboardings/ratings/summary'),
      ]);
      setOverviewRows(all.data);
      setStuckTotal(stuck.total);
      setAttention(stuck.data);
      setRatingSummary(rating);
    } catch {
      // The detailed table below surfaces its own errors — the
      // overview degrades to "nothing to show" rather than blocking
      // the page on a second failure.
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  // Guards against out-of-order responses: switching the department
  // filter quickly can leave an OLD request (e.g. for Engineering)
  // still in flight when a NEW one (e.g. for Operations) is sent. If
  // the old one happens to resolve second — which network timing does
  // not guarantee against — it would silently overwrite the correct,
  // newer rows with stale ones. Only the response matching the latest
  // request id is ever applied to state.
  const latestRequestId = useRef(0);

  async function loadRows() {
    const requestId = ++latestRequestId.current;
    setError(null);
    try {
      const params = new URLSearchParams();
      if (departmentFilter) params.set('department', departmentFilter);
      if (view === 'all' && statusFilter) params.set('status', statusFilter);
      params.set('limit', String(LIMIT));
      params.set('offset', String(page * LIMIT));
      const path = view === 'stuck' ? '/onboardings/stuck' : '/onboardings';
      const res = await authedFetch<{ data: any[]; total: number }>(`${path}?${params.toString()}`);
      if (requestId !== latestRequestId.current) return; // a newer request has since started — ignore this stale response
      setRows(res.data);
      setTotal(res.total);
    } catch (err) {
      if (requestId !== latestRequestId.current) return;
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, departmentFilter, statusFilter, page]);

  function switchView(next: 'all' | 'stuck') {
    setView(next);
    setPage(0);
  }

  function refreshEverything() {
    void loadRows();
    void loadOverview();
  }

  const newHiresCount = overviewRows.filter((o) =>
    ['pre_onboarding', 'email_provisioned', 'checkpoint_pending'].includes(o.status),
  ).length;
  const activeCount = overviewRows.filter((o) => o.status === 'active').length;
  const stageCounts = PIPELINE_STAGES.map((stage) => ({
    ...stage,
    count: overviewRows.filter((o) => o.status === stage.key).length,
  }));
  const pipelineRows = overviewRows
    .filter((o) => o.status !== 'completed' && o.status !== 'cancelled')
    .slice(0, 6);

  return (
    <div className="hr-dashboard">
      <div className="greeting-banner">
        <span className="eyebrow">HR / SuperAdmin</span>
        <h1>
          {greeting()}, {user?.full_name?.split(' ')[0] ?? 'there'} 👋
        </h1>
        <p>Here's how onboarding is tracking across every department right now.</p>
        <div className="banner-actions">
          <button className="btn-primary" onClick={() => setShowAddJoiner(true)}>
            + Add joiner
          </button>
          <button onClick={() => setShowAddTaskOwner(true)}>+ Add task owner</button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <Reveal>
        <div className="stat-grid">
          <div className="card stat-tile">
            <span className="stat-icon info">👋</span>
            <div>
              <div className="stat-value">{newHiresCount}</div>
              <div className="stat-label">New hires</div>
              <div className="stat-sub">Not yet active</div>
            </div>
          </div>
          <div className="card stat-tile">
            <span className="stat-icon success">✅</span>
            <div>
              <div className="stat-value">{activeCount}</div>
              <div className="stat-label">Active</div>
              <div className="stat-sub">Past checkpoint</div>
            </div>
          </div>
          <div className="card stat-tile">
            <span className="stat-icon danger">⚠️</span>
            <div>
              <div className="stat-value">{stuckTotal}</div>
              <div className="stat-label">Delayed</div>
              <div className="stat-sub">Blocked or overdue tasks</div>
            </div>
          </div>
          <div className="card stat-tile">
            <span className="stat-icon accent">⭐</span>
            <div>
              <div className="stat-value">
                {ratingSummary.average !== null ? `${ratingSummary.average.toFixed(1)}/5` : '—'}
              </div>
              <div className="stat-label">First-week feedback</div>
              <div className="stat-sub">
                {ratingSummary.count} rating{ratingSummary.count === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <section>
          <h2>Onboarding pipeline</h2>
          <div className="pipeline-stages">
            {stageCounts.map((s) => (
              <div key={s.key} className="pipeline-stage">
                {s.label}
                <span className="stage-count">{s.count}</span>
              </div>
            ))}
          </div>
          {pipelineRows.map((o) => {
            const pct =
              o.required_task_count > 0
                ? Math.round((o.required_task_completed_count / o.required_task_count) * 100)
                : 0;
            return (
              <div className="pipeline-row" key={o.id} onClick={() => setProfileUserId(o.user_id)}>
                <span className="pipeline-name">{o.employee_name}</span>
                <AnimatedProgressBar percent={pct} thin style={{ margin: 0 }} />
                <span className="pipeline-pct">{pct}%</span>
              </div>
            );
          })}
          {pipelineRows.length === 0 && <p className="muted">Nothing in flight right now.</p>}
        </section>
      </Reveal>

      {attention.length > 0 && (
        <Reveal>
          <section>
            <h2>Needs attention</h2>
            <ul className="attention-list">
              {attention.map((t) => (
                <li key={t.task_id}>
                  <span className="attn-icon">⚠</span>
                  <span>
                    <strong>{t.employee_name}</strong> — {t.task_title} (
                    {t.is_blocked ? 'blocked' : 'overdue'})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}

      <Reveal>
      <div className="dashboard-header" style={{ marginTop: '0.5rem' }}>
        <h2 style={{ marginBottom: '0.75rem' }}>All onboardings</h2>
      </div>

      <div className="filters">
        <button className={view === 'all' ? 'active' : ''} onClick={() => switchView('all')}>
          Overview
        </button>
        <button className={view === 'stuck' ? 'active' : ''} onClick={() => switchView('stuck')}>
          What&apos;s stuck
        </button>

        <select
          value={departmentFilter}
          onChange={(e) => {
            setDepartmentFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>

        {view === 'all' && (
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            <option value="pre_onboarding">Pre-onboarding</option>
            <option value="email_provisioned">Email provisioned</option>
            <option value="checkpoint_pending">Checkpoint pending</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        )}
      </div>

      {view === 'all' ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Joinee ID</th>
              <th>Department</th>
              <th>Template</th>
              <th>Status</th>
              <th>Start date</th>
              <th>Progress</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              // Clicking the employee opens their PROFILE, not the task
              // scheduler. That was the bug behind "the joinee id and pwd are
              // not available when HR clicks on employee": the row used to open
              // a modal that lists tasks and has no credentials in it at all,
              // while the credentials sat behind an unlabelled last-column
              // button. The scheduler now has its own explicit button.
              <tr key={o.id} onClick={() => setProfileUserId(o.user_id)}>
                <td>{o.employee_name}</td>
                <td>
                  {o.joinee_id ? (
                    <code className="id-pill">{o.joinee_id}</code>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{o.department_name}</td>
                <td>{o.template_name}</td>
                <td>
                  <span className={`status-pill status-${o.status}`}>{o.status}</span>
                </td>
                <td>{formatDate(o.start_date)}</td>
                <td>
                  {o.required_task_completed_count}/{o.required_task_count}
                </td>
                <td className="row-actions">
                  {/* stopPropagation so this doesn't also fire the row's own
                      profile-open handler. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedOnboarding(o);
                    }}
                  >
                    Tasks
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Task</th>
              <th>Due</th>
              <th>Why stuck</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.task_id}>
                <td>{t.employee_name}</td>
                <td>{t.department_name}</td>
                <td>
                  {t.task_title}
                  {t.is_checkpoint && <span className="badge">Checkpoint</span>}
                </td>
                <td>{t.due_date}</td>
                <td>{t.is_blocked ? 'Blocked' : 'Overdue'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.length === 0 && <p className="muted">Nothing to show.</p>}

      <div className="pagination">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>
          Page {page + 1} of {Math.max(1, Math.ceil(total / LIMIT))} ({total} total)
        </span>
        <button disabled={(page + 1) * LIMIT >= total} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </div>
      </Reveal>

      {selectedOnboarding && (
        <OnboardingDetailModal
          onboarding={selectedOnboarding}
          onClose={() => setSelectedOnboarding(null)}
          onTaskScheduled={refreshEverything}
          onEmailProvisioned={(companyEmail) => {
            setProvisionedEmail(companyEmail);
            setSelectedOnboarding(null);
            refreshEverything();
          }}
        />
      )}

      {profileUserId && (
        <EmployeeProfileModal
          userId={profileUserId}
          onClose={() => setProfileUserId(null)}
          onChanged={refreshEverything}
        />
      )}

      {showAddJoiner && (
        <AddJoinerModal
          departments={departments}
          onClose={() => setShowAddJoiner(false)}
          onCreated={(creds) => {
            setJoinerCredentials(creds);
            setShowAddJoiner(false);
            refreshEverything();
          }}
        />
      )}

      {showAddTaskOwner && (
        <AddTaskOwnerModal
          departments={departments}
          onClose={() => setShowAddTaskOwner(false)}
          onCreated={(creds) => {
            setJoinerCredentials(creds);
            setShowAddTaskOwner(false);
          }}
        />
      )}

      {joinerCredentials && (
        <Modal title="Account created" onClose={() => setJoinerCredentials(null)}>
          <p>
            Shown once — deliver these to them directly. Use Copy rather than retyping them by hand:
            the temporary password mixes case and symbols on purpose, so a single mistyped character
            is easy to miss and will make it look like the credentials "don't work."
          </p>
          <p className="credential-row">
            <strong>Login:</strong> <code>{joinerCredentials.loginId}</code>
            <CopyButton text={joinerCredentials.loginId} />
          </p>
          <p className="credential-row">
            <strong>Password:</strong> <code>{joinerCredentials.temporaryPassword}</code>
            <CopyButton text={joinerCredentials.temporaryPassword} />
          </p>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setJoinerCredentials(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}

      {provisionedEmail && (
        <Modal title="Company email recorded" onClose={() => setProvisionedEmail(null)}>
          <p>
            This is a record only — it can't be used to log in. The employee still signs in with
            their Joinee ID + password or their registered mobile number + OTP.
          </p>
          <p className="credential-row">
            <strong>Company email:</strong> <code>{provisionedEmail}</code>
            <CopyButton text={provisionedEmail} />
          </p>
          <div className="modal-actions">
            <button className="btn-primary" onClick={() => setProvisionedEmail(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * The employee detail popup, extended into the task scheduler: it
 * loads the onboarding's full task list (every status, not just what
 * the employee's own dashboard shows) and lets HR schedule a new
 * one-off task straight onto it. Completion itself still only ever
 * happens through the employee/task_owner endpoints — this view is
 * read-only on existing tasks, checkbox-styled to show progress.
 */
function OnboardingDetailModal({
  onboarding,
  onClose,
  onTaskScheduled,
  onEmailProvisioned,
}: {
  onboarding: any;
  onClose: () => void;
  onTaskScheduled: () => void;
  onEmailProvisioned: (companyEmail: string) => void;
}) {
  const authedFetch = useAuthedFetch();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [showScheduler, setShowScheduler] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  async function provisionEmail() {
    setProvisioning(true);
    setProvisionError(null);
    try {
      const res = await authedFetch<{
        companyEmail: string;
      }>(`/onboardings/${onboarding.id}/provision-email`, { method: 'POST', body: {} });
      onEmailProvisioned(res.companyEmail);
    } catch (err) {
      setProvisionError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setProvisioning(false);
    }
  }

  async function loadTasks() {
    setLoadingTasks(true);
    try {
      const res = await authedFetch<any[]>(`/onboardings/${onboarding.id}/tasks`);
      setTasks(res);
    } catch {
      // Detail view degrades to "no task list" rather than blocking
      // the rest of the popup on a failed fetch.
    } finally {
      setLoadingTasks(false);
    }
  }

  useEffect(() => {
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboarding.id]);

  return (
    <Modal title={onboarding.employee_name} onClose={onClose}>
      <div className="detail-row">
        <span className="detail-label">Department</span>
        <span className="detail-value">{onboarding.department_name}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Template</span>
        <span className="detail-value">{onboarding.template_name ?? '—'}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Status</span>
        <span className="detail-value">{onboarding.status}</span>
      </div>
      <div className="detail-row">
        <span className="detail-label">Start date</span>
        <span className="detail-value">{onboarding.start_date}</span>
      </div>

      {onboarding.status === 'pre_onboarding' && (
        <>
          {provisionError && <p className="error-text">{provisionError}</p>}
          <button
            className="btn-primary"
            style={{ marginTop: '0.6rem' }}
            disabled={provisioning}
            onClick={provisionEmail}
          >
            {provisioning ? 'Assigning…' : '📧 Assign company email'}
          </button>
        </>
      )}

      {!loadingTasks && tasks.some((t) => t.is_required) && (
        <div className="detail-row">
          <span className="detail-label">Progress</span>
          <span className="detail-value">
            {tasks.filter((t) => t.is_required && t.status === 'completed').length}/
            {tasks.filter((t) => t.is_required).length} required tasks
          </span>
        </div>
      )}

      <h3 style={{ marginTop: '1.1rem', marginBottom: '0.5rem' }}>Tasks</h3>
      {loadingTasks && <p className="muted">Loading…</p>}
      {!loadingTasks && (
        <ul className="task-list" style={{ marginBottom: '0.75rem' }}>
          {tasks.map((t) => (
            <li key={t.id} style={{ cursor: 'default', display: 'flex', gap: '0.7rem' }}>
              <span className={`checkbox-mark ${t.status === 'completed' ? 'checked' : ''}`} />
              <div>
                <strong>{t.title}</strong>
                {t.is_checkpoint && <span className="badge">Checkpoint</span>}
                <span className="task-meta">
                  {t.owner_role} · {t.status} · due {t.due_date}
                </span>
              </div>
            </li>
          ))}
          {tasks.length === 0 && <p className="muted">No tasks yet.</p>}
        </ul>
      )}

      {showScheduler ? (
        <ScheduleTaskForm
          onboardingId={onboarding.id}
          onCancel={() => setShowScheduler(false)}
          onScheduled={() => {
            setShowScheduler(false);
            void loadTasks();
            onTaskScheduled();
          }}
        />
      ) : (
        <button className="btn-primary" onClick={() => setShowScheduler(true)}>
          + Schedule task
        </button>
      )}
    </Modal>
  );
}

/** The task scheduler form itself — a one-off task onto a specific
 *  onboarding, outside the template. Kept as its own component so
 *  OnboardingDetailModal doesn't carry form state it only needs while
 *  the scheduler is open. */
function ScheduleTaskForm({
  onboardingId,
  onCancel,
  onScheduled,
}: {
  onboardingId: string;
  onCancel: () => void;
  onScheduled: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [ownerRole, setOwnerRole] = useState<'employee' | 'task_owner'>('employee');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [isRequired, setIsRequired] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authedFetch(`/onboardings/${onboardingId}/tasks`, {
        method: 'POST',
        body: {
          title,
          dueDate,
          ownerRole,
          priority,
          isRequired,
          completionMode: ownerRole === 'employee' ? 'employee' : 'owner',
        },
      });
      onScheduled();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.85rem' }}>
      {error && <p className="error-text">{error}</p>}
      <label>
        Task title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Due date
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
      </label>
      <label>
        Assigned to
        <select value={ownerRole} onChange={(e) => setOwnerRole(e.target.value as 'employee' | 'task_owner')}>
          <option value="employee">Employee</option>
          <option value="task_owner">Task owner</option>
        </select>
      </label>
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'normal' | 'high')}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
        <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
        Required for completion
      </label>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          {busy ? 'Scheduling…' : 'Schedule task'}
        </button>
      </div>
    </form>
  );
}

/** Digits only, live-filtered as the user types (rather than
 *  validated after the fact) so a pasted or typed letter never makes
 *  it into the field at all. 7–15 digits covers real phone numbers
 *  without hard-coding a country-specific length. */
/** Fixed +91 prefix, same as the login page's mobile+OTP field — the
 *  two must agree on format, since login matches phone_number as
 *  stored (91 + 10 digits). `value`/`onChange` carry just the 10 local
 *  digits; the caller prepends '91' when sending to the API. */
function PhoneInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <>
      <div className="phone-input-group">
        <span className="phone-prefix">+91</span>
        <span className="phone-divider">|</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
          inputMode="numeric"
          pattern="[0-9]{10}"
          title="Phone number must be exactly 10 digits"
          placeholder="9876543210"
          maxLength={10}
          required
        />
      </div>
      {value.length > 0 && value.length < 10 && (
        <span className="field-error">Enter all 10 digits</span>
      )}
    </>
  );
}

function AddJoinerModal({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: (creds: { loginId: string; temporaryPassword: string }) => void;
}) {
  const authedFetch = useAuthedFetch();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [managerName, setManagerName] = useState('');
  const [buddyName, setBuddyName] = useState('');
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The pre-ticked set comes from document_types.is_default_required
  // rather than being hardcoded here, so changing the defaults is a data
  // change and not a frontend deploy.
  useEffect(() => {
    authedFetch<DocumentType[]>('/joinee-documents/types')
      .then((types) => {
        setDocTypes(types);
        setSelectedDocs(
          new Set(types.filter((t) => t.is_default_required).map((t) => t.id)),
        );
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const userRes = await authedFetch<{
        user: { id: string };
        credentials: { joineeId: string; temporaryPassword: string };
      }>('/auth/users', {
        method: 'POST',
        body: {
          fullName,
          phoneNumber: `91${phoneNumber}`,
          personalEmail,
          role: 'employee',
          departmentId,
        },
      });
      await authedFetch('/onboardings', {
        method: 'POST',
        body: {
          userId: userRes.user.id,
          startDate,
          // Both optional — HR often doesn't know the buddy on day one,
          // and can fill either in later from the joinee's profile.
          managerName: managerName || undefined,
          buddyName: buddyName || undefined,
          requiredDocumentTypeIds: selectedDocs.size ? [...selectedDocs] : undefined,
        },
      });
      onCreated({
        loginId: userRes.credentials.joineeId,
        temporaryPassword: userRes.credentials.temporaryPassword,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add joiner" onClose={onClose} wide>
      {error && <p className="error-text">{error}</p>}
      <form onSubmit={submit}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Mobile number
          <PhoneInput value={phoneNumber} onChange={setPhoneNumber} />
        </label>
        <label>
          Personal email
          <input
            type="email"
            value={personalEmail}
            onChange={(e) => setPersonalEmail(e.target.value)}
            placeholder="arjun@gmail.com"
            required
          />
        </label>
        <span className="field-hint">
          Recorded for the joinee's records. Credentials are handed over below, not emailed.
        </span>
        <label>
          Department
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} required>
            <option value="" disabled>
              Select…
            </option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date of joining
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label>
          Manager name <span className="muted">(optional)</span>
          <input
            value={managerName}
            onChange={(e) => setManagerName(e.target.value)}
            placeholder="Can be added later"
          />
        </label>
        <label>
          Buddy name <span className="muted">(optional)</span>
          <input
            value={buddyName}
            onChange={(e) => setBuddyName(e.target.value)}
            placeholder="Can be added later"
          />
        </label>

        <fieldset className="doc-picker">
          <legend>Documents the joinee must upload</legend>
          <div className="doc-picker__grid">
            {docTypes.map((type) => (
              <label
                key={type.id}
                className={`doc-picker__item${selectedDocs.has(type.id) ? ' is-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedDocs.has(type.id)}
                  onChange={() => toggleDoc(type.id)}
                />
                {type.label}
              </label>
            ))}
          </div>
          <span className="field-hint">
            {selectedDocs.size === 0
              ? 'None selected — no upload task will be created.'
              : `${selectedDocs.size} document${selectedDocs.size === 1 ? '' : 's'} selected. These become one "Upload your documents" task.`}
          </span>
        </fieldset>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create & show credentials'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Unlike a joiner, a task owner has no onboarding of their own — this
 *  is a single call to /auth/users with role 'task_owner' and nothing
 *  else. Department is optional (CreateUserDto): most task owners
 *  (IT, facilities) support every department, so leaving it unset
 *  scopes them to nothing in particular rather than one department. */
function AddTaskOwnerModal({
  departments,
  onClose,
  onCreated,
}: {
  departments: Department[];
  onClose: () => void;
  onCreated: (creds: { loginId: string; temporaryPassword: string }) => void;
}) {
  const authedFetch = useAuthedFetch();
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const userRes = await authedFetch<{
        user: { id: string };
        credentials: { joineeId: string; temporaryPassword: string };
      }>('/auth/users', {
        method: 'POST',
        body: {
          fullName,
          phoneNumber: `91${phoneNumber}`,
          role: 'task_owner',
          departmentId: departmentId || undefined,
        },
      });
      onCreated({
        loginId: userRes.credentials.joineeId,
        temporaryPassword: userRes.credentials.temporaryPassword,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add task owner" onClose={onClose}>
      {error && <p className="error-text">{error}</p>}
      <form onSubmit={submit}>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label>
          Phone number
          <PhoneInput value={phoneNumber} onChange={setPhoneNumber} />
        </label>
        <label>
          Department (optional)
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">No specific department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * HR's "click a joinee, see everything" view: the details captured at
 * creation, the documents they uploaded (previewable inline), and their
 * tasks split into outstanding and done.
 *
 * One request to /employee-profile/:id assembles all three server-side,
 * so this doesn't fan out into a request per section.
 */
function EmployeeProfileModal({
  userId,
  onClose,
  onChanged,
}: {
  userId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const { accessToken } = useAuth();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingAssignments, setEditingAssignments] = useState(false);
  const [managerName, setManagerName] = useState('');
  const [buddyName, setBuddyName] = useState('');
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [credentials, setCredentials] = useState<CredentialSummary | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<EmployeeProfile>(`/employee-profile/${userId}`)
      .then((p) => {
        setProfile(p);
        setManagerName(p.onboarding?.manager_name ?? '');
        setBuddyName(p.onboarding?.buddy_name ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load profile'));
    // Loaded with the profile rather than behind a "View credentials" click —
    // the Joinee ID is the first thing HR needs when they open a joinee, and
    // burying it was the whole complaint.
    authedFetch<CredentialSummary>(`/auth/users/${userId}/credentials`)
      .then(setCredentials)
      .catch(() => setCredentials(null));
  }, [authedFetch, userId]);

  useEffect(load, [load]);

  async function saveAssignments(e: FormEvent) {
    e.preventDefault();
    if (!profile?.onboarding) return;
    setSavingAssignments(true);
    setError(null);
    try {
      // Empty string is meaningful here — it clears the field, rather
      // than leaving it untouched the way omitting the key does.
      await authedFetch(`/onboardings/${profile.onboarding.id}/assignments`, {
        method: 'PATCH',
        body: { managerName, buddyName },
      });
      setEditingAssignments(false);
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSavingAssignments(false);
    }
  }

  async function review(uploadId: string, decision: 'approved' | 'rejected') {
    setReviewing(uploadId);
    setError(null);
    try {
      const note =
        decision === 'rejected'
          ? window.prompt('Why is this being rejected? The joinee will see this.')
          : undefined;
      // A rejection with no reason is refused by the API (and by a CHECK
      // constraint underneath it), so don't send one.
      if (decision === 'rejected' && !note) return;
      await authedFetch(`/joinee-documents/uploads/${uploadId}/review`, {
        method: 'POST',
        body: { decision, ...(note ? { note } : {}) },
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the review');
    } finally {
      setReviewing(null);
    }
  }

  async function regenerate() {
    setError(null);
    setRegenerating(true);
    try {
      const res = await authedFetch<{
        credentials: { loginId: string; temporaryPassword: string };
      }>(`/auth/users/${userId}/regenerate-credentials`, { method: 'POST' });
      setCredentials({
        joineeId: res.credentials.loginId,
        temporaryPassword: res.credentials.temporaryPassword,
        awaitingFirstReset: true,
        hasLoggedIn: false,
        canRegenerate: true,
        note: 'New temporary password — shown once. Share it with the joinee now.',
      });
      // Deliberately not reloading the profile here: load() re-fetches the
      // credentials summary, whose temporaryPassword is always null, which
      // would wipe the freshly-minted password off the screen before HR could
      // copy it.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not regenerate');
    } finally {
      setRegenerating(false);
    }
  }

  if (!profile) {
    return (
      <Modal title="Employee profile" onClose={onClose}>
        {error ? <p className="error-text">{error}</p> : <p className="muted">Loading…</p>}
      </Modal>
    );
  }

  const { user, onboarding, documents, tasks } = profile;

  return (
    <Modal title={user.full_name} onClose={onClose} wide>
      {error && <p className="error-text">{error}</p>}

      <section className="profile-section">
        <h3>Details</h3>
        <dl className="profile-grid">
          <div>
            <dt>Joinee ID</dt>
            <dd>
              <code>{user.joinee_id}</code>
            </dd>
          </div>
          <div>
            <dt>Mobile</dt>
            <dd>{user.phone_number}</dd>
          </div>
          <div>
            <dt>Personal email</dt>
            <dd>{user.personal_email ?? <span className="muted">Not recorded</span>}</dd>
          </div>
          <div>
            <dt>Department</dt>
            <dd>{user.department_name ?? <span className="muted">None</span>}</dd>
          </div>
          <div>
            <dt>Date of joining</dt>
            <dd>{formatDate(onboarding?.start_date) ?? <span className="muted">Not onboarded</span>}</dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd>
              <span className={`status-pill status-${user.status}`}>{user.status}</span>
            </dd>
          </div>
        </dl>
      </section>

      {onboarding && (
        <section className="profile-section">
          <h3>
            Manager &amp; buddy{' '}
            {!editingAssignments && (
              <button type="button" onClick={() => setEditingAssignments(true)}>
                Edit
              </button>
            )}
          </h3>
          {editingAssignments ? (
            <form onSubmit={saveAssignments}>
              <label>
                Manager name
                <input
                  value={managerName}
                  onChange={(e) => setManagerName(e.target.value)}
                  placeholder="Leave blank to clear"
                />
              </label>
              <label>
                Buddy name
                <input
                  value={buddyName}
                  onChange={(e) => setBuddyName(e.target.value)}
                  placeholder="Leave blank to clear"
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setEditingAssignments(false)}>
                  Cancel
                </button>
                <button type="submit" disabled={savingAssignments}>
                  {savingAssignments ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          ) : (
            <dl className="profile-grid">
              <div>
                <dt>Manager</dt>
                <dd>{onboarding.manager_name ?? <span className="muted">Not assigned yet</span>}</dd>
              </div>
              <div>
                <dt>Buddy</dt>
                <dd>{onboarding.buddy_name ?? <span className="muted">Not assigned yet</span>}</dd>
              </div>
            </dl>
          )}
        </section>
      )}

      <section className="profile-section">
        <h3>Documents ({documents.length})</h3>
        {documents.length === 0 ? (
          <p className="muted">No documents were requested for this joinee.</p>
        ) : (
          <ul className="doc-list">
            {documents.map((doc) => (
              <li key={doc.requirement_id} className="doc-list__item">
                <div className="doc-list__head">
                  <strong>{doc.label}</strong>
                  <span className={`status-pill status-${doc.status}`}>
                    {doc.status.replace(/_/g, ' ')}
                  </span>
                </div>
                {doc.upload_id ? (
                  <>
                    <span className="field-hint">
                      {doc.original_filename} · uploaded {formatDate(doc.uploaded_at)}
                    </span>
                    {doc.review_note && (
                      <span className="field-hint">Rejection note: {doc.review_note}</span>
                    )}
                    <div className="doc-list__actions">
                      {/* The file needs a Bearer token, which a plain
                          <a href> can't attach — openFileInline fetches
                          it and hands the blob to a new tab. */}
                      <button
                        type="button"
                        onClick={() =>
                          openFileInline(
                            `/joinee-documents/uploads/${doc.upload_id}/file`,
                            accessToken,
                          ).catch(() => setError('Could not open this document'))
                        }
                      >
                        Preview
                      </button>
                      {doc.review_status === 'pending_review' && (
                        <>
                          <button
                            type="button"
                            disabled={reviewing === doc.upload_id}
                            onClick={() => review(doc.upload_id!, 'approved')}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            disabled={reviewing === doc.upload_id}
                            onClick={() => review(doc.upload_id!, 'rejected')}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="field-hint">Not uploaded yet.</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="profile-section">
        <h3>
          Tasks — {tasks.requiredCompleted}/{tasks.requiredTotal} required done
        </h3>
        <h4 className="muted">Pending ({tasks.pending.length})</h4>
        <ul className="task-list">
          {tasks.pending.map((t) => (
            <li key={t.id}>
              {t.title}
              {t.subtask_count > 0 && (
                <span className="field-hint">
                  {' '}
                  · {t.subtask_completed_count}/{t.subtask_count} steps
                </span>
              )}
              <span className={`status-pill status-${t.status}`}>{t.status}</span>
            </li>
          ))}
          {tasks.pending.length === 0 && <li className="muted">Nothing outstanding.</li>}
        </ul>
        <h4 className="muted">Completed ({tasks.completed.length})</h4>
        <ul className="task-list">
          {tasks.completed.map((t) => (
            <li key={t.id}>
              {t.title}
              {t.subtask_count > 0 && (
                <span className="field-hint">
                  {' '}
                  · {t.subtask_completed_count}/{t.subtask_count} steps
                </span>
              )}
            </li>
          ))}
          {tasks.completed.length === 0 && <li className="muted">Nothing completed yet.</li>}
        </ul>
      </section>

      <section className="profile-section profile-section--creds">
        <h3>Login credentials</h3>
        {credentials ? (
          <>
            <div className="cred-row">
              <div className="cred-field">
                <span className="cred-label">Joinee ID</span>
                <span className="cred-value">
                  <code>{credentials.joineeId}</code>
                  <CopyButton text={credentials.joineeId} />
                </span>
              </div>
              <div className="cred-field">
                <span className="cred-label">Temporary password</span>
                <span className="cred-value">
                  {credentials.temporaryPassword ? (
                    <>
                      <code className="cred-secret">{credentials.temporaryPassword}</code>
                      <CopyButton text={credentials.temporaryPassword} />
                    </>
                  ) : (
                    <span className="cred-hidden">
                      <LockedIcon />
                      Not retrievable
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Not an error state — the temp password is bcrypt-hashed the moment
                it is issued, so there is nothing to show a second time. Says so
                plainly, with the one action that does work. */}
            <p className="cred-note">
              {credentials.temporaryPassword
                ? credentials.note
                : credentials.hasLoggedIn
                  ? 'This joinee has already signed in and chosen their own password, so no temporary password exists. Regenerating would lock them out of the one they set.'
                  : 'Temporary passwords are stored one-way (hashed) and cannot be shown twice. If it was lost before reaching the joinee, issue a fresh one below — the original was never used.'}
            </p>

            <div className="cred-actions">
              <button
                type="button"
                className={credentials.hasLoggedIn ? '' : 'btn-solid'}
                disabled={regenerating}
                onClick={regenerate}
              >
                {regenerating ? 'Issuing…' : 'Issue a new temporary password'}
              </button>
              {credentials.hasLoggedIn && (
                <span className="field-hint">Only do this if they’re locked out.</span>
              )}
            </div>
          </>
        ) : (
          <p className="muted">Loading credentials…</p>
        )}
      </section>
    </Modal>
  );
}

interface CredentialSummary {
  joineeId: string;
  temporaryPassword: string | null;
  awaitingFirstReset: boolean;
  hasLoggedIn: boolean;
  canRegenerate: boolean;
  note: string;
}

function LockedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. an insecure/non-HTTPS
      // context) — fail silently rather than block on it; the value
      // is still shown in plain text right next to this button.
    }
  }

  return (
    <button type="button" onClick={copy}>
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}
