import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthedFetch } from '../../api/useAuthedFetch';
import { ApiError } from '../../api/client';
import { taskGuideFor } from '../../data/taskGuides';
import { quizFor, type PolicyQuiz as PolicyQuizData } from '../../data/policyQuizzes';
import PolicyQuiz from './PolicyQuiz';
import type { SubtaskRow } from '../../types/onboarding';

/* Testing switch: shows the correct answer on every quiz question so the
   pass path can be walked without reading the policies. Flip to false to
   make the quiz a real check. */
const REVEAL_QUIZ_ANSWERS = true;

/**
 * A task's checklist as cards rather than rows.
 *
 * The plain checklist (SubtaskChecklist) is right when an item is a sentence
 * you either did or did not do. It is wrong when each item is a small job of
 * its own with its own instructions and its own download — which is what the
 * install task and the reading task became when five trail steps were folded
 * into one. Each card opens onto the guide for that item, so "Install VS Code"
 * carries the same steps and links it had when it was a whole task.
 *
 * Completion is identical to the row version and goes through the same
 * endpoints: ticking the last required item completes the parent server-side,
 * and this reports that upward rather than predicting it.
 */
export default function SubtaskCards({
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* A policy subtask can only be ticked after passing its quiz. When one is
     pending this holds the subtask and its quiz; passing runs the real
     completion. */
  const [quiz, setQuiz] = useState<{ subtask: SubtaskRow; data: PolicyQuizData } | null>(null);

  const load = useCallback(() => {
    authedFetch<SubtaskRow[]>(`/onboarding-tasks/${taskId}/subtasks`)
      .then(setSubtasks)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load the steps'));
  }, [authedFetch, taskId]);

  useEffect(load, [load]);

  /** The tick. Completing a policy that has a quiz opens the quiz instead of
   *  completing straight away; everything else (and every reopen) goes
   *  through as before. */
  function toggle(subtask: SubtaskRow) {
    if (!subtask.completed_at) {
      const data = quizFor(subtask.title);
      if (data) {
        setQuiz({ subtask, data });
        return;
      }
    }
    void setCompletion(subtask, subtask.completed_at ? 'reopen' : 'complete');
  }

  /** The server round-trip, shared by the tick and the quiz's pass path. */
  async function setCompletion(subtask: SubtaskRow, action: 'complete' | 'reopen') {
    setBusyId(subtask.id);
    setError(null);
    try {
      const res = await authedFetch<{ parent_task_completed?: boolean }>(
        `/onboarding-tasks/subtasks/${subtask.id}/${action}`,
        { method: 'POST' },
      );
      setQuiz(null);
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
      <div className="subcards">
        {error ? <p className="error-text">{error}</p> : <ChecklistSkeleton rows={3} />}
      </div>
    );
  }

  const required = subtasks.filter((s) => s.is_required);
  const requiredDone = required.filter((s) => s.completed_at).length;
  const remaining = required.length - requiredDone;
  const pct = required.length ? Math.round((requiredDone / required.length) * 100) : 0;

  return (
    <div className="subcards">
      {error && <p className="error-text">{error}</p>}

      <div className="checklist-head">
        <div>
          <h4 className="checklist-title">Your checklist</h4>
          <p className="checklist-sub">
            {remaining === 0
              ? 'Everything here is done — this task is complete.'
              : `${remaining} left. The task completes on its own once they're all ticked.`}
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

      <ul className="subcards-list">
        {subtasks.map((s, i) => {
          const done = Boolean(s.completed_at);
          const guide = taskGuideFor(s.title);
          const open = openId === s.id;
          /* Only worth opening if there is something inside. An item with no
             guide is a card with a tick and nothing to expand, so it does not
             pretend to be expandable. */
          const expandable = Boolean(guide && (guide.steps.length > 0 || guide.resources || guide.to));
          /* What the card's action does. A policy opens the quiz; a software
             item is marked once you have downloaded it; anything else is a
             plain "mark done". The checkbox is gone — this button is the only
             way to complete a card now. */
          const hasQuiz = Boolean(quizFor(s.title));
          const isInstall = !hasQuiz && (/install/i.test(s.title) || Boolean(guide?.resources?.length));
          const busy = busyId === s.id;

          return (
            <li
              key={s.id}
              className={[
                'subcard',
                done ? 'is-done' : '',
                open ? 'is-open' : '',
                busyId === s.id ? 'is-busy' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ ['--row' as string]: i }}
            >
              <div className="subcard-face">
                {/* A status marker, not a control. Completing is done by the
                    action button on the right now, so this only reflects
                    state — a card cannot be marked done a pixel away from the
                    thing that opens it to read. */}
                <span
                  className={`subcard-status${done ? ' is-done' : ''}`}
                  aria-hidden="true"
                >
                  {done ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <span className="subcard-icon">{guide?.icon ?? '•'}</span>
                  )}
                </span>

                <span className="subcard-text">
                  <strong className="subcard-title">{s.title}</strong>
                  {s.description && <span className="subcard-desc">{s.description}</span>}
                </span>

                {expandable && (
                  <button
                    type="button"
                    className="subcard-toggle"
                    onClick={() => setOpenId(open ? null : s.id)}
                    aria-expanded={open}
                  >
                    {open ? 'Hide' : 'How'}
                    <ChevronIcon />
                  </button>
                )}

                {/* The completion action, beside How. Its label says what it
                    is FOR — a knowledge check for a policy, a confirmation for
                    a download — rather than the mechanical "mark done". Once
                    done it becomes an undo. */}
                {done ? (
                  <button
                    type="button"
                    className="subcard-action is-done"
                    disabled={busy}
                    onClick={() => void setCompletion(s, 'reopen')}
                  >
                    <CheckIcon />
                    Done
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`subcard-action${hasQuiz ? ' subcard-action--quiz' : ''}`}
                    disabled={busy}
                    onClick={() => toggle(s)}
                  >
                    {hasQuiz
                      ? 'Test your knowledge'
                      : isInstall
                        ? 'Click when you download it'
                        : 'Mark complete'}
                  </button>
                )}
              </div>

              {open && guide && (
                <div className="subcard-body">
                  <p className="subcard-summary">{guide.summary}</p>

                  {guide.steps.length > 0 && (
                    <ol className="subcard-steps">
                      {guide.steps.map((step, n) => (
                        <li key={step.title}>
                          <span className="subcard-step-num" aria-hidden="true">
                            {n + 1}
                          </span>
                          <span>
                            <strong>{step.title}</strong>
                            {step.detail && <span>{step.detail}</span>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {/* A policy lives on a page we own, so it is a router link
                      rather than an outbound one — and it carries the policy
                      name so Policies opens straight onto it. */}
                  {guide.to && (
                    <Link className="subcard-link subcard-link--internal" to={guide.to}>
                      Read it now
                      <ArrowIcon />
                    </Link>
                  )}

                  {guide.resources?.map((r) => (
                    <a
                      key={r.href}
                      className="subcard-link"
                      href={r.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span>
                        <strong>{r.label}</strong>
                        {r.note && <span className="subcard-link-note">{r.note}</span>}
                      </span>
                      <ExternalIcon />
                    </a>
                  ))}

                  {guide.tip && <p className="subcard-tip">{guide.tip}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {quiz && (
        <PolicyQuiz
          quiz={quiz.data}
          revealAnswers={REVEAL_QUIZ_ANSWERS}
          busy={busyId === quiz.subtask.id}
          onPass={() => void setCompletion(quiz.subtask, 'complete')}
          onClose={() => setQuiz(null)}
        />
      )}
    </div>
  );
}

/** Placeholder rows while the checklist loads. Lived in SubtaskChecklist,
 *  which this replaced. */
function ChecklistSkeleton({ rows = 3 }: { rows?: number }) {
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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M8 16L16 8M9 8h7v7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
