import { useCallback, useEffect, useState } from 'react';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import Modal from '../components/Modal';
import Reveal from '../components/Reveal';
import TaskRoadmap, { type RoadmapItem } from '../components/TaskRoadmap';
import SubtaskChecklist from '../components/tasks/SubtaskChecklist';
import DocumentChecklist from '../components/tasks/DocumentChecklist';
import { fireConfetti } from '../lib/confetti';
import { dueLabel, formatDate } from '../lib/format';
import type { DashboardResponse, TaskRow } from '../types/onboarding';

/**
 * The employee's Tasks tab: their whole onboarding as a serpentine trail.
 *
 * Everything task-related used to live on the Home page alongside the
 * greeting, knowledge articles, notes and diary, which meant the one screen
 * carried both "welcome, here's your world" and "here's your work". Splitting
 * them lets the trail have the room it needs and leaves Home as the softer
 * landing page.
 *
 * The roadmap renders from `dashboard.steps`, which is the only payload that
 * includes locked and completed tasks — today/upcoming/overdue deliberately
 * exclude them, so a roadmap built from those would show a journey that starts
 * wherever the employee currently is.
 */
export default function EmployeeTasks() {
  const authedFetch = useAuthedFetch();
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskRow | null>(null);
  const [completing, setCompleting] = useState(false);
  const [checklistBusy, setChecklistBusy] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const data = await authedFetch<DashboardResponse>('/onboardings/me');
      setDashboard(data);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /** A checklist finished the task for us — same celebration and cleanup as
   *  pressing "Mark done", since a completed task drops out of the actionable
   *  buckets and the open popup would otherwise show stale state. */
  async function finishTaskFromChecklist() {
    fireConfetti();
    setActiveTask(null);
    await loadAll();
  }

  async function completeTask(taskId: string) {
    setCompleting(true);
    try {
      await authedFetch(`/onboarding-tasks/${taskId}/complete-as-employee`, { method: 'POST' });
      fireConfetti();
      setActiveTask(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setCompleting(false);
    }
  }

  if (loading) return <TasksSkeleton />;
  if (error && !dashboard) return <p className="error-text">{error}</p>;
  if (!dashboard) return null;

  const firstName = user?.full_name?.split(' ')[0] ?? 'there';
  const actionable = [...dashboard.overdue, ...dashboard.today, ...dashboard.upcoming];
  const doFirst = actionable.find((t) => t.status !== 'completed') ?? null;
  const currentStepId =
    doFirst?.id ?? dashboard.steps.find((s) => s.status !== 'completed')?.id ?? null;

  // `steps` carries the full journey; the actionable buckets carry the richer
  // row for whichever of them is currently open. Merge so a card can show its
  // description and subtask counts regardless of which side it came from.
  const richById = new Map(actionable.map((t) => [t.id, t]));
  const roadmapSteps: RoadmapItem[] = dashboard.steps.map((s) => {
    const rich = richById.get(s.id);
    return {
      id: s.id,
      title: s.title,
      status: s.status,
      due_date: s.due_date,
      is_checkpoint: s.is_checkpoint,
      description: s.description ?? rich?.description ?? null,
      system_key: s.system_key ?? rich?.system_key ?? null,
      subtask_count: s.subtask_count ?? rich?.subtask_count ?? 0,
      subtask_completed_count: s.subtask_completed_count ?? rich?.subtask_completed_count ?? 0,
    };
  });

  function openStep(id: string) {
    const rich = richById.get(id);
    if (rich) {
      setActiveTask(rich);
      return;
    }
    // A completed or locked step isn't in the actionable buckets, so build the
    // popup from the roadmap row instead of guessing at missing fields.
    const step = dashboard!.steps.find((s) => s.id === id);
    if (!step) return;
    setActiveTask({
      id: step.id,
      title: step.title,
      description: step.description ?? null,
      status: step.status,
      due_date: step.due_date,
      is_checkpoint: step.is_checkpoint,
      system_key: step.system_key ?? null,
      subtask_count: step.subtask_count ?? 0,
      subtask_completed_count: step.subtask_completed_count ?? 0,
    });
  }

  const { requiredCompleted, requiredTotal, percent } = dashboard.progress;
  const remaining = requiredTotal - requiredCompleted;
  const allDone = requiredTotal > 0 && remaining === 0;

  const activeIsDocuments = activeTask?.system_key === 'document_upload';
  const activeHasSubtasks = (activeTask?.subtask_count ?? 0) > 0;
  const activeIsChecklistDriven = activeIsDocuments || activeHasSubtasks;

  return (
    <div className="tasks-page">
      {error && <p className="error-text">{error}</p>}

      <Reveal>
        <header className="tasks-hero">
          <span className="tasks-eyebrow">
            <span className="tasks-eyebrow-dot" />
            Your onboarding journey
          </span>
          <h1 className="tasks-title">
            {allDone ? 'You’re all set, ' : 'Your trail, '}
            <span className="tasks-title-script">{firstName}</span>
          </h1>
          <p className="tasks-lede">
            {allDone
              ? 'Every required step on your onboarding is complete. Have a look back through the trail any time.'
              : `Follow the trail below. ${remaining} step${remaining === 1 ? '' : 's'} left to be fully set up.`}
          </p>

          <div className="tasks-progress">
            <div className="tasks-progress-top">
              <span className="tasks-progress-count">
                <span className="tasks-progress-badge">{requiredCompleted}</span>
                of {requiredTotal} steps complete
              </span>
              <span className="tasks-progress-pct">{percent}%</span>
            </div>
            <span className="tasks-progress-track">
              <span className="tasks-progress-fill" style={{ width: `${percent}%` }} />
            </span>
            {doFirst && (
              <div className="tasks-progress-foot">
                <span className="tasks-live-dot" aria-hidden="true" />
                <span>
                  Up next: <strong>{doFirst.title}</strong>
                  {dueLabel(doFirst.due_date, doFirst.status) && (
                    <span className="muted"> · {dueLabel(doFirst.due_date, doFirst.status)}</span>
                  )}
                </span>
                <button type="button" className="btn-solid btn-sm" onClick={() => openStep(doFirst.id)}>
                  Open
                </button>
              </div>
            )}
          </div>
        </header>
      </Reveal>

      {roadmapSteps.length === 0 ? (
        <p className="muted">No steps on your onboarding yet — check back shortly.</p>
      ) : (
        <section className="tasks-trail dot-grid">
          <TaskRoadmap steps={roadmapSteps} currentId={currentStepId} onSelect={openStep} />
        </section>
      )}

      {activeTask && (
        <Modal
          title={activeTask.title}
          size={activeIsChecklistDriven ? 'xl' : 'default'}
          busy={checklistBusy || completing}
          subtitle={
            activeTask.status === 'completed'
              ? 'Completed'
              : dueLabel(activeTask.due_date, activeTask.status)
          }
          icon={activeIsDocuments ? <PaperclipIcon /> : <FlagIcon />}
          onClose={() => setActiveTask(null)}
          actions={
            <>
              <button type="button" onClick={() => setActiveTask(null)}>
                Close
              </button>
              {/* A checklist-driven task has no "Mark done" button: it completes
                  on its own once the last required item is ticked or the last
                  document submitted, so offering both would be two ways to
                  finish one task. */}
              {activeTask.status !== 'completed' && !activeIsChecklistDriven && (
                <button
                  className="btn-solid"
                  disabled={completing}
                  onClick={() => completeTask(activeTask.id)}
                  
                >
                  {completing ? 'Marking done…' : 'Mark done'}
                </button>
              )}
            </>
          }
        >
          {activeTask.description && <p className="modal-lede">{activeTask.description}</p>}

          <dl className="detail-grid">
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`status-pill status-${activeTask.status}`}>
                  {activeTask.status.replace(/_/g, ' ')}
                </span>
              </dd>
            </div>
            <div>
              <dt>Due date</dt>
              <dd>{formatDate(activeTask.due_date)}</dd>
            </div>
            {activeTask.priority && (
              <div>
                <dt>Priority</dt>
                <dd>{activeTask.priority}</dd>
              </div>
            )}
            {activeTask.is_checkpoint && (
              <div>
                <dt>Checkpoint</dt>
                <dd>Unlocks the rest of your onboarding</dd>
              </div>
            )}
          </dl>

          {activeIsDocuments ? (
            <DocumentChecklist
              onChanged={() => {
                setChecklistBusy(false);
                void loadAll();
              }}
              onParentCompleted={finishTaskFromChecklist}
            />
          ) : (
            activeHasSubtasks && (
              <SubtaskChecklist
                taskId={activeTask.id}
                onChanged={() => void loadAll()}
                onParentCompleted={finishTaskFromChecklist}
              />
            )
          )}
        </Modal>
      )}
    </div>
  );
}

function TasksSkeleton() {
  return (
    <div className="tasks-page">
      <div className="tasks-hero">
        <span className="skeleton-line" style={{ width: '9rem' }} />
        <span className="skeleton-line" style={{ width: '18rem', height: '2.2rem' }} />
        <span className="skeleton-line" style={{ width: '26rem' }} />
      </div>
      <div className="roadmap">
        {[0, 1, 2].map((i) => (
          <div key={i} className="roadmap-item" style={{ ['--i' as string]: i }}>
            <div className={`roadmap-row roadmap-row--${i % 2 === 0 ? 'left' : 'right'}`}>
              <div className="roadmap-card is-skeleton">
                <span className="skeleton-line" style={{ width: '5rem' }} />
                <span className="skeleton-line" style={{ width: '80%', height: '1.1rem' }} />
                <span className="skeleton-line" style={{ width: '60%' }} />
              </div>
              <span className="roadmap-node roadmap-node--upcoming" />
              <div className="roadmap-spacer" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" strokeLinejoin="round" />
      <path d="M4 22v-7" strokeLinecap="round" />
    </svg>
  );
}
