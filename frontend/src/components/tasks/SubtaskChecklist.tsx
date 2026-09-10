import { useCallback, useEffect, useState } from 'react';
import { useAuthedFetch } from '../../api/useAuthedFetch';
import { ApiError } from '../../api/client';
import type { SubtaskRow } from '../../types/onboarding';

/**
 * The checklist inside a task's popup. Ticking the last REQUIRED item completes
 * the parent task server-side (OnboardingTasksService.markSubtaskDone), so this
 * reports the parent's completion upward rather than trying to predict it.
 *
 * Un-ticking is offered but deliberately never reopens a parent that already
 * completed — correcting a checklist entry after the fact shouldn't drag
 * finished work, and the progress built on it, backwards.
 */
export default function SubtaskChecklist({
  taskId,
  onChanged,
  onParentCompleted,
}: {
  taskId: string;
  onChanged: () => void;
  onParentCompleted: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const [subtasks, setSubtasks] = useState<SubtaskRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [justDone, setJustDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    authedFetch<SubtaskRow[]>(`/onboarding-tasks/${taskId}/subtasks`)
      .then(setSubtasks)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the steps'));
  }, [authedFetch, taskId]);

  useEffect(load, [load]);

  async function toggle(subtask: SubtaskRow) {
    setBusyId(subtask.id);
    setError(null);
    try {
      const action = subtask.completed_at ? 'reopen' : 'complete';
      const res = await authedFetch<{ parent_task_completed?: boolean }>(
        `/onboarding-tasks/subtasks/${subtask.id}/${action}`,
        { method: 'POST' },
      );
      if (!subtask.completed_at) {
        // Drives a one-shot tick animation on the row that just closed.
        setJustDone(subtask.id);
        window.setTimeout(() => setJustDone(null), 700);
      }
      load();
      onChanged();
      if (res?.parent_task_completed) onParentCompleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this step');
    } finally {
      setBusyId(null);
    }
  }

  if (!subtasks) {
    return (
      <div className="checklist">
        {error ? <p className="error-text">{error}</p> : <ChecklistSkeleton rows={3} />}
      </div>
    );
  }

  const required = subtasks.filter((s) => s.is_required);
  const requiredDone = required.filter((s) => s.completed_at).length;
  const remaining = required.length - requiredDone;
  const pct = required.length ? Math.round((requiredDone / required.length) * 100) : 0;

  return (
    <div className="checklist">
      {error && <p className="error-text">{error}</p>}

      <div className="checklist-head">
        <div>
          <h4 className="checklist-title">Steps</h4>
          <p className="checklist-sub">
            {remaining === 0
              ? 'All required steps done — this task is complete.'
              : `${remaining} required step${remaining === 1 ? '' : 's'} left. The task completes on its own once they're all ticked.`}
          </p>
        </div>
        <span className="checklist-count">
          {requiredDone}
          <span className="checklist-count-of">/{required.length}</span>
        </span>
      </div>

      <span className="checklist-track">
        <span className="checklist-track-fill" style={{ width: `${pct}%` }} />
      </span>

      <ul className="checklist-list">
        {subtasks.map((s, i) => {
          const done = Boolean(s.completed_at);
          return (
            <li
              key={s.id}
              className={[
                'checklist-row',
                done ? 'is-done' : '',
                justDone === s.id ? 'is-celebrating' : '',
                busyId === s.id ? 'is-busy' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ ['--row' as string]: i }}
            >
              <label className="checklist-label">
                <input
                  type="checkbox"
                  className="checklist-box"
                  checked={done}
                  disabled={busyId === s.id}
                  onChange={() => toggle(s)}
                />
                <span className="checklist-tick" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="checklist-text">
                  <span className="checklist-row-title">{s.title}</span>
                  {!s.is_required && <span className="checklist-optional">Optional</span>}
                  {s.description && <span className="checklist-row-desc">{s.description}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ChecklistSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="checklist-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="checklist-row is-skeleton" style={{ ['--row' as string]: i }}>
          <span className="skeleton-line" />
        </li>
      ))}
    </ul>
  );
}
