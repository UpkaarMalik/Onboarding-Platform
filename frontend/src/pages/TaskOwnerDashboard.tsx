import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError, describeError } from '../api/client';
import { greeting } from '../lib/format';
import Modal from '../components/Modal';
import BlockerLine from '../components/BlockerLine';
import LoadError from '../components/LoadError';
import ReasonDialog from '../components/tasks/ReasonDialog';
import Reveal from '../components/Reveal';
import AnimatedProgressBar from '../components/AnimatedProgressBar';

/**
 * The TaskOwner dashboard: tasks scoped to owner_user_id = self,
 * server-side — this page never asks for or sends anything that could
 * widen that. "Claimable tasks" is a separate list (GET
 * /onboarding-tasks/claimable, unclaimed owner/dual tasks matching
 * this actor's role) with its own claim button; claiming one moves it
 * out of that list and into "My tasks" below. Clicking any claimed
 * task opens it in a popup rather than acting on the row directly.
 *
 * Department employees section: task owners see all onboardings in
 * their department and can assign tasks directly.
 */
export default function TaskOwnerDashboard() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [claimable, setClaimable] = useState<any[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<any | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deptError, setDeptError] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  // Department employees
  const [deptOnboardings, setDeptOnboardings] = useState<any[]>([]);
  const [showAssignModal, setShowAssignModal] = useState<any | null>(null);

  const latestRequestId = useRef(0);

  async function load() {
    const requestId = ++latestRequestId.current;
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');
      const res = await authedFetch<{ data: any[]; total: number }>(
        `/onboarding-tasks/mine?${params.toString()}`,
      );
      if (requestId !== latestRequestId.current) return;
      setTasks(res.data);
      setTotal(res.total);
    } catch (err) {
      if (requestId !== latestRequestId.current) return;
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  async function loadClaimable() {
    try {
      const res = await authedFetch<any[]>('/onboarding-tasks/claimable');
      setClaimable(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  /* A task owner may block the task they own — the same rule the completion
     endpoint applies, and for the same reason: whoever can close it is
     whoever knows it is stuck. */
  async function blockTask(taskId: string, reason: string, expectedAt?: string) {
    setBlockBusy(true);
    setBlockError(null);
    try {
      await authedFetch(`/onboarding-tasks/${taskId}/block`, {
        method: 'POST',
        body: { reason, ...(expectedAt ? { expectedAt } : {}) },
      });
      setBlockOpen(false);
      setActiveTask(null);
      void load();
    } catch (err) {
      setBlockError(err instanceof ApiError ? err.message : 'Could not block this task');
    } finally {
      setBlockBusy(false);
    }
  }

  async function resolveBlocker(blockerId: string, note?: string) {
    setBlockBusy(true);
    setBlockError(null);
    try {
      await authedFetch(`/blockers/${blockerId}/resolve`, {
        method: 'POST',
        body: note ? { note } : {},
      });
      setResolveOpen(false);
      setActiveTask(null);
      void load();
    } catch (err) {
      setBlockError(err instanceof ApiError ? err.message : 'Could not resolve this blocker');
    } finally {
      setBlockBusy(false);
    }
  }

  async function loadDeptOnboardings() {
    try {
      const res = await authedFetch<any[]>('/onboarding-tasks/department-onboardings');
      setDeptOnboardings(res);
      setDeptError(null);
    } catch (err) {
      // The old comment said "task owner may not have a department", but
      // that case never reaches this catch: listDepartmentOnboardings
      // returns [] for a department-less actor rather than throwing. So
      // anything arriving here is a real failure, and it was hiding behind
      // an empty list that read as "your department has no joinees".
      setDeptError(describeError(err));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    void loadClaimable();
    void loadDeptOnboardings();
  }, []);

  async function completeTask(id: string) {
    setCompleting(true);
    try {
      await authedFetch(`/onboarding-tasks/${id}/complete-as-owner`, { method: 'POST' });
      setActiveTask(null);
      await load();
    } catch (err) {
      // Into the page's own error line, not a browser alert: an alert blocks
      // the whole tab, cannot be styled, loses the modal's context and is
      // suppressible — in which case the failure becomes silent.
      setError(describeError(err));
    } finally {
      setCompleting(false);
    }
  }

  async function claimTask(id: string) {
    setClaimingId(id);
    try {
      await authedFetch(`/onboarding-tasks/${id}/claim`, { method: 'POST' });
      await Promise.all([loadClaimable(), load()]);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setClaimingId(null);
    }
  }

  const overdueCount = tasks.filter((t) => t.is_overdue).length;

  return (
    <div className="task-owner-dashboard">
      <div className="greeting-banner">
        <span className="eyebrow">Task Owner</span>
        <h1>
          {greeting()}, {user?.full_name?.split(' ')[0] ?? 'there'} 👋
        </h1>
        <p>Claim what's open, keep the rest moving.</p>
      </div>

      {error && <p className="error-text">{error}</p>}

      <Reveal>
        <div className="stat-grid">
          <div className="card stat-tile">
            <span className="stat-icon accent">🗂️</span>
            <div>
              <div className="stat-value">{claimable.length}</div>
              <div className="stat-label">Claimable</div>
              <div className="stat-sub">Unclaimed right now</div>
            </div>
          </div>
          <div className="card stat-tile">
            <span className="stat-icon info">✅</span>
            <div>
              <div className="stat-value">{total}</div>
              <div className="stat-label">Claimed by you</div>
              <div className="stat-sub">Across every onboarding</div>
            </div>
          </div>
          <div className="card stat-tile">
            <span className="stat-icon danger">⚠️</span>
            <div>
              <div className="stat-value">{overdueCount}</div>
              <div className="stat-label">Overdue</div>
              <div className="stat-sub">Needs action</div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* Department employees section */}
      {/* Before this, a failed load left deptOnboardings empty and the whole
          section rendered nothing — the most invisible failure of the three,
          because there was not even a zero to notice. */}
      {deptError && (
        <LoadError message={deptError} onRetry={() => void loadDeptOnboardings()} />
      )}

      {deptOnboardings.length > 0 && (
        <Reveal>
          <section>
            <h2>Department employees</h2>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Status</th>
                  <th>Start date</th>
                  <th>Progress</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deptOnboardings.map((o) => {
                  const total = Number(o.required_task_count);
                  const done = Number(o.required_task_completed_count);
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                  return (
                    <tr key={o.id}>
                      <td>{o.employee_name}</td>
                      <td>
                        <span className={`status-pill status-${o.status}`}>{o.status}</span>
                      </td>
                      <td>{o.start_date}</td>
                      <td style={{ minWidth: 120 }}>
                        <AnimatedProgressBar percent={pct} thin style={{ margin: 0 }} />
                        <span className="muted" style={{ fontSize: '0.78rem' }}>{done}/{total}</span>
                      </td>
                      <td>
                        <button
                          className="btn-primary"
                          style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                          onClick={() => setShowAssignModal(o)}
                        >
                          Assign task
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </Reveal>
      )}

      <Reveal>
        <section>
          <h2>Claimable tasks</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Department</th>
                <th>Task</th>
                <th>Due</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {claimable.map((t) => (
                <tr key={t.id}>
                  <td>{t.employee_name}</td>
                  <td>{t.department_name}</td>
                  <td>
                    {t.title}
                    {t.is_checkpoint && <span className="badge">Checkpoint</span>}
                  </td>
                  <td>{t.due_date}</td>
                  <td>
                    <button
                      className="btn-primary"
                      onClick={() => claimTask(t.id)}
                      disabled={claimingId === t.id}
                    >
                      {claimingId === t.id ? 'Claiming…' : 'Claim'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {claimable.length === 0 && <p className="muted">Nothing unclaimed right now.</p>}
        </section>
      </Reveal>

      <Reveal>
      <div className="dashboard-header">
        <h2 style={{ marginBottom: 0 }}>My tasks</h2>
      </div>
      <div className="filters">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>
        <span className="muted">
          {total} claimed task{total === 1 ? '' : 's'}
        </span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Department</th>
            <th>Task</th>
            <th>Due</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={t.is_overdue ? 'row-overdue' : ''} onClick={() => setActiveTask(t)}>
              <td>{t.employee_name}</td>
              <td>{t.department_name}</td>
              <td>
                {t.title}
                {t.is_checkpoint && <span className="badge">Checkpoint</span>}
              </td>
              <td>{t.due_date}</td>
              <td>
                <span className={`status-pill status-${t.status}`}>{t.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {tasks.length === 0 && <p className="muted">Nothing claimed yet — claim one above.</p>}
      </Reveal>

      {activeTask && (
        <Modal
          title={activeTask.title}
          onClose={() => setActiveTask(null)}
          actions={
            <>
              <button type="button" onClick={() => setActiveTask(null)}>
                Close
              </button>
              {/* Quiet, and to the left of the primary action: saying a task
                  is stuck is not the thing this dialog is for, it is the
                  thing you do when the thing it is for cannot happen. */}
              {activeTask.status !== 'completed' &&
                (activeTask.blocker ? (
                  <button type="button" className="link-action" onClick={() => setResolveOpen(true)}>
                    Resolve blocker
                  </button>
                ) : (
                  <button type="button" className="link-action" onClick={() => setBlockOpen(true)}>
                    Mark as blocked
                  </button>
                ))}
              {activeTask.status !== 'completed' && (
                <button
                  className="btn-primary"
                  disabled={completing}
                  onClick={() => completeTask(activeTask.id)}
                >
                  {completing ? 'Marking done…' : 'Mark done'}
                </button>
              )}
            </>
          }
        >
          {activeTask.description && <p>{activeTask.description}</p>}
          <div className="detail-row">
            <span className="detail-label">Employee</span>
            <span className="detail-value">{activeTask.employee_name}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Department</span>
            <span className="detail-value">{activeTask.department_name}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Status</span>
            <span className="detail-value">{activeTask.status}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Due date</span>
            <span className="detail-value">{activeTask.due_date}</span>
          </div>
          {activeTask.blocker && (
            <div className="detail-row">
              <span className="detail-label">Blocked</span>
              <span className="detail-value">
                <BlockerLine blocker={activeTask.blocker} />
              </span>
            </div>
          )}
        </Modal>
      )}

      {activeTask && blockOpen && (
        <ReasonDialog
          title="Mark as blocked"
          subtitle={activeTask.title}
          label="What is it waiting on?"
          placeholder="Device allocation pending"
          withDate
          confirmLabel="Mark as blocked"
          busy={blockBusy}
          error={blockError}
          onClose={() => {
            setBlockOpen(false);
            setBlockError(null);
          }}
          onSubmit={({ reason, expectedAt }) => void blockTask(activeTask.id, reason, expectedAt)}
        />
      )}

      {activeTask?.blocker && resolveOpen && (
        <ReasonDialog
          title="Resolve blocker"
          subtitle={`${activeTask.title} — ${activeTask.blocker.reason}`}
          label="What changed?"
          placeholder="Laptop arrived and was handed over"
          required={false}
          confirmLabel="Resolve"
          busy={blockBusy}
          error={blockError}
          onClose={() => {
            setResolveOpen(false);
            setBlockError(null);
          }}
          onSubmit={({ reason }) =>
            void resolveBlocker(activeTask.blocker.id, reason || undefined)
          }
        />
      )}

      {showAssignModal && (
        <AssignTaskModal
          onboarding={showAssignModal}
          onClose={() => setShowAssignModal(null)}
          onAssigned={() => {
            setShowAssignModal(null);
            void loadDeptOnboardings();
            void load();
          }}
        />
      )}
    </div>
  );
}

function AssignTaskModal({
  onboarding,
  onClose,
  onAssigned,
}: {
  onboarding: any;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('normal');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !dueDate) return;
    setSubmitting(true);
    setError(null);
    try {
      await authedFetch('/onboarding-tasks/assign', {
        method: 'POST',
        body: {
          onboardingId: onboarding.id,
          title: title.trim(),
          description: description.trim() || undefined,
          dueDate,
          priority,
        },
      });
      onAssigned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Assign task to ${onboarding.employee_name}`} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <p className="error-text">{error}</p>}
        <div className="form-group">
          <label>Task title *</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div className="form-group">
          <label>Due date *</label>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
        </div>
        <div className="form-group">
          <label>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Assigning…' : 'Assign task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
