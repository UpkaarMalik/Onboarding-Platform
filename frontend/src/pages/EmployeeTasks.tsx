import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthedFetch } from '../api/useAuthedFetch';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import Modal from '../components/Modal';
import JourneyTrack from '../components/JourneyTrack';
import TaskRoadmap, { type RoadmapItem } from '../components/TaskRoadmap';
import BlockerLine from '../components/BlockerLine';
import SubtaskChecklist from '../components/tasks/SubtaskChecklist';
import DocumentChecklist from '../components/tasks/DocumentChecklist';
import { fireConfetti } from '../lib/confetti';
import EmployeeKnowledgeRail from '../components/EmployeeKnowledgeRail';
import { SERVER_PUSH_EVENT } from '../components/NotificationBell';
import { useToast, toastError } from '../components/Toast';
import { dueLabel, formatDate } from '../lib/format';
import type { DashboardResponse, PersonRef, TaskRow } from '../types/onboarding';

/** How far past the hero's resting place the page must scroll before the hero
 *  condenses. Enough that a nudge of the wheel doesn't fold the greeting away,
 *  small enough that it is gone by the time the trail needs the room. */
const HERO_CONDENSE_AFTER = 24;
/** How long the greeting stays up before the hero folds it away by itself.
 *  Long enough to be read, short enough that nobody scrolls to get the room
 *  back first — which is what everyone was doing when this only fired on
 *  scroll. */
const HERO_AUTO_CONDENSE_MS = 450;
/**
 * Un-condense at a smaller scroll than condense engaged at.
 *
 * Without this gap the boundary is a single number, and condensing is not a
 * passive observation — it collapses the greeting, which shortens the document
 * and can pull scrollY back across that very number. That re-expands the hero,
 * which lengthens the document, which crosses it again: the hero vibrates,
 * replaying its 240 ms padding and box-shadow transitions on every flip. A gap
 * means the way out is not the way in, so a shift that follows the condense
 * can't undo it.
 */
const HERO_UNCONDENSE_AT = 12;

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
/**
 * The line under the greeting.
 *
 * Six bands rather than one sentence with a number in it: the same figure
 * means quite different things at either end of an onboarding, and "27%
 * complete" on its own reads as a progress bar spelled out rather than as
 * anything addressed to the person reading it.
 *
 * The first two bands are split on the COUNT, not the percentage. A single
 * finished task is a different moment from several, and what fraction it
 * happens to be depends only on how many tasks HR wrote — on a short
 * onboarding one task can be a third of the whole thing.
 */
function progressLine(percent: number, doneCount: number): string {
  if (percent >= 100) return '🎉 Congratulations! Your onboarding is 100% completed. Welcome aboard for real!';
  if (doneCount === 0) return 'Your journey starts here. Complete your first task to get the ball rolling.';
  if (percent >= 75)
    return `Almost there! Your onboarding is ${percent}% completed. Just a few steps left to wrap up.`;
  if (percent >= 50)
    return `Great momentum! Your onboarding is ${percent}% completed. You're past the halfway mark, keep it going!`;
  if (doneCount >= 2)
    return `Nice start! Your onboarding is ${percent}% completed. You're picking up speed!`;
  return `You're on your way! Your onboarding is ${percent}% completed. One step at a time.`;
}

export default function EmployeeTasks() {
  const authedFetch = useAuthedFetch();
  const toast = useToast();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<TaskRow | null>(null);
  const [completing, setCompleting] = useState(false);
  const [checklistBusy, setChecklistBusy] = useState(false);
  const heroAnchorRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const [heroStuck, setHeroStuck] = useState(false);
  /**
   * True while the roadmap's mark is sailing, during which the hero holds
   * whatever shape it already had.
   *
   * The hero condenses on scroll position, and the voyage tows scroll
   * position — so without this the two form a loop. Condensing collapses a
   * 22rem greeting, which lifts the trail; the tow scrolls up to keep the
   * mark pinned; that smaller scrollY reads as "not past the hero any more",
   * so it expands; the trail drops; the tow scrolls back down; it condenses
   * again. That is the hero bouncing two or three times on its way down, and
   * it can't be tuned out with a threshold — the shift the hero causes is an
   * order of magnitude bigger than any sensible gap between condense and
   * un-condense. Holding it still for the crossing removes the loop instead
   * of damping it: no layout shift, so the tow has nothing to chase.
   *
   * A ref rather than state because only the scroll listener reads it, and
   * re-rendering on cast-off would be the very layout churn this avoids.
   */
  const sailingRef = useRef(false);
  const onVoyage = useCallback((sailing: boolean) => {
    sailingRef.current = sailing;
  }, []);

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

  /**
   * Re-read the trail when the server tells this browser something
   * happened — which, for this page, is nearly always somebody else:
   * HR or a task owner blocking a step, resolving a blocker, approving a
   * document, or closing the handover.
   *
   * The page's own actions already call loadAll() directly. What it had
   * no answer for was a change made in a different browser: the bell lit
   * up and the trail behind it kept showing the old state until the
   * person reloaded, so a blocked task still looked open and clicking it
   * failed for no visible reason.
   */
  useEffect(() => {
    const reload = () => void loadAll();
    window.addEventListener(SERVER_PUSH_EVENT, reload);
    return () => window.removeEventListener(SERVER_PUSH_EVENT, reload);
  }, [loadAll]);

  /**
   * Opens a task's popup and, when it is not one of the currently
   * actionable ones, builds that popup from the roadmap row instead of
   * guessing at fields the actionable buckets would have carried.
   *
   * Hoisted above this component's early returns, and a useCallback, so
   * the deep-link effect below can depend on it. Anything that reopens
   * this popup has to go through here — a second construction of the
   * same object is a second chance for the two to disagree about what a
   * completed or locked step looks like.
   */
  const openStep = useCallback(
    (id: string) => {
      if (!dashboard) return;
      const rich = [...dashboard.overdue, ...dashboard.today, ...dashboard.upcoming].find(
        (t) => t.id === id,
      );
      if (rich) {
        setActiveTask(rich);
        return;
      }
      const step = dashboard.steps.find((s) => s.id === id);
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
    },
    [dashboard],
  );

  /**
   * Deep link from a notification: /start-here?task=<id> opens that task.
   *
   * Waits for `dashboard`, because the id means nothing until the trail
   * has loaded — the effect re-runs when it arrives. The param is then
   * dropped with replace, so a refresh or a Back does not reopen a popup
   * the person has already closed, and an id that matches nothing (a
   * notification about a cancelled task, a link opened by the wrong
   * account) is cleared just the same and leaves them on the trail
   * rather than on an error.
   */
  useEffect(() => {
    const wanted = searchParams.get('task');
    if (!wanted || !dashboard) return;
    openStep(wanted);
    const next = new URLSearchParams(searchParams);
    next.delete('task');
    setSearchParams(next, { replace: true });
  }, [searchParams, dashboard, openStep, setSearchParams]);

  /**
   * Whether the page has scrolled past where the hero naturally sits, which is
   * what condenses it.
   *
   * Measured off a zero-height anchor pinned at the top of .tasks-page rather
   * than off the hero itself. The hero is the wrong thing to ask: once it is
   * sticking, its top is 0 by definition and its offsetTop tracks the scroll,
   * so both say "stuck" forever. The anchor stays where the layout put it and
   * simply scrolls away, which is the actual question.
   *
   * The threshold is what stops it condensing at rest. In this shell the hero
   * begins flush against the top of the window, so "has it touched the top"
   * is true before anyone has scrolled at all — the greeting would never once
   * be seen.
   */
  useEffect(() => {
    const read = () => {
      if (sailingRef.current) return;
      const anchor = heroAnchorRef.current;
      if (!anchor || sailingRef.current) return;
      const past = -anchor.getBoundingClientRect().top;
      // Reading the current state through the functional setter rather than
      // closing over heroStuck keeps this effect off the flip, so the listener
      // isn't torn down and rebound every time the hero changes shape.
      setHeroStuck((wasStuck) =>
        wasStuck ? past > HERO_UNCONDENSE_AT : past >= HERO_CONDENSE_AFTER,
      );
    };
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, [dashboard]);

  /**
   * Folds the greeting away once the boat has moored, instead of waiting for
   * a scroll the employee should not have to make.
   *
   * The voyage tows the page down to the task in play and then stops, and
   * until this the hero stayed at full height through all of it — the trail
   * arrived under a greeting nobody was reading any more, and the only way to
   * get the room back was to scroll, which is the thing the tow just did for
   * them. Waiting for the mooring rather than for load matters: condensing
   * mid-crossing lifts the trail in document coordinates underneath a tow that
   * is steering by them.
   */
  useEffect(() => {
    if (!dashboard) return;
    let id: number;
    const foldWhenMoored = () => {
      if (sailingRef.current) {
        // Short, because this interval lands on top of the delay below — at
        // 150ms the fold came a third of a beat late.
        id = window.setTimeout(foldWhenMoored, 40);
        return;
      }
      id = window.setTimeout(() => {
        // A fresh voyage during the beat means the page is moving again, so
        // go back to waiting for that one to finish.
        if (sailingRef.current) return foldWhenMoored();
        setHeroStuck(true);
      }, HERO_AUTO_CONDENSE_MS);
    };
    foldWhenMoored();
    return () => window.clearTimeout(id);
  }, [dashboard]);

  /**
   * Feeds the rail the hero's real pinned height.
   *
   * The rail pins below the hero, and both its `top` and its `max-height`
   * are derived from that one number. It used to be a constant in the CSS,
   * which drifts the moment the hero gains or loses a line: undershoot and
   * the rail's top slides behind the hero and is clipped, overshoot and its
   * bottom runs off the bottom of the screen. Measuring costs one
   * ResizeObserver and cannot go stale.
   */
  useEffect(() => {
    const hero = heroRef.current;
    const split = splitRef.current;
    if (!hero || !split) return;
    // The hero pins BELOW the topnav rather than under it, so its own top
    // line stays readable while pinned. Both that offset and the rail's come
    // off the same measured nav height.
    const nav = document.querySelector<HTMLElement>('.topnav');
    const sync = () => {
      const navH = nav?.offsetHeight ?? 0;
      hero.style.setProperty('--nav-h', `${navH}px`);
      // 12px of air so the rail isn't flush against the hero's shadow.
      split.style.setProperty('--rail-clearance', `${navH + hero.offsetHeight + 12}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(hero);
    if (nav) ro.observe(nav);
    return () => ro.disconnect();
  }, [dashboard, heroStuck]);

  /** Confetti says something good happened; the toast says WHAT, and stays
   *  long enough to read after the popup it happened in has closed. */
  function announceDone(title: string) {
    fireConfetti();
    toast({
      tone: 'success',
      title: `${title} — done`,
      message: 'Your trail has moved on to the next step.',
    });
  }

  /** A checklist finished the task for us — same celebration and cleanup as
   *  pressing "Mark done", since a completed task drops out of the actionable
   *  buckets and the open popup would otherwise show stale state. */
  async function finishTaskFromChecklist() {
    announceDone(activeTask?.title ?? 'Task');
    setActiveTask(null);
    await loadAll();
  }

  async function completeTask(taskId: string) {
    setCompleting(true);
    const title = activeTask?.title ?? 'Task';
    try {
      await authedFetch(`/onboarding-tasks/${taskId}/complete-as-employee`, { method: 'POST' });
      announceDone(title);
      setActiveTask(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      toast({
        tone: 'error',
        title: `Couldn't complete ${title}`,
        message: toastError(err, 'Something went wrong. Try again in a moment.'),
      });
    } finally {
      setCompleting(false);
    }
  }

  if (loading) return <TasksSkeleton />;
  if (error && !dashboard) return <p className="error-text">{error}</p>;
  if (!dashboard) return null;

  const firstName = user?.full_name?.split(' ')[0] ?? 'there';
  const actionable = [...dashboard.overdue, ...dashboard.today, ...dashboard.upcoming];

  // `steps` carries the full journey; the actionable buckets carry the richer
  // row for whichever of them is currently open. Merge so a card can show its
  // description and subtask counts regardless of which side it came from.
  const richById = new Map(actionable.map((t) => [t.id, t]));
  // Rendered in the order the server sends, which is already the trail's order
  // (paperwork, reading, kit, installs, then the rest) with the sequential gate
  // applied — see backend trail-order.util. Sorting again here would be a
  // second opinion on the same question, and the one that loses an argument
  // with the API is the one the employee is looking at.
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
      blocker: s.blocker ?? rich?.blocker ?? null,
    };
  });

  /**
   * The "you are here" step, taken from the trail's OWN order.
   *
   * This used to be the first entry of [...overdue, ...today, ...upcoming],
   * which is ordered by due_date with ties broken arbitrarily by Postgres — so
   * on an onboarding where several tasks share a due date it could mark step 2
   * ACTIVE while step 1 was still open, and the "Up next" line would name a
   * task the employee hadn't reached. Walking roadmapSteps instead means the
   * highlight and the numbering can never disagree.
   *
   * Nothing is skipped: the server opens exactly one step at a time and the
   * trail marks that one, so the highlight, the numbering and the boat all
   * land on the step the employee is actually on.
   */
  const currentStep =
    roadmapSteps.find((s) => s.status !== 'completed' && s.status !== 'cancelled') ?? null;
  const currentStepId = currentStep?.id ?? null;
  // The richer bucketed row when there is one — it carries priority and the
  // overdue flag that `steps` doesn't.
  const doFirst = currentStep ? richById.get(currentStep.id) ?? currentStep : null;

  // Counted off the SAME array the trail renders rather than the backend's
  // separate progress aggregate. Both currently agree, but deriving them from
  // one source means the bar can never claim a number the cards below it
  // contradict — which is the one way this panel could lie.
  const totalSteps = roadmapSteps.length;
  const doneSteps = roadmapSteps.filter((s) => s.status === 'completed').length;
  const percent = totalSteps === 0 ? 0 : Math.round((doneSteps / totalSteps) * 100);
  const remaining = totalSteps - doneSteps;
  const allDone = totalSteps > 0 && remaining === 0;

  /**
   * Where the track's marker and the trail's mark come to REST, which is not
   * the same question as which step is open.
   *
   * With every step finished there is no open step, and both of them were
   * falling back to "none" — which the track reads as index -1 and the trail
   * reads as berth 0. So the moment the last task was ticked off, the marker
   * snapped back to step one and the boomerang flew to the top of the trail:
   * the journey reading as not yet started at the exact moment it finished.
   * Finished means resting on the LAST step.
   *
   * Passing it as the trail's `currentId` cannot mislabel that step as active,
   * because visualState checks `completed` before it checks the current id.
   */
  const restingStepId =
    currentStepId ?? (allDone ? roadmapSteps[roadmapSteps.length - 1]?.id ?? null : null);

  const activeIsDocuments = activeTask?.system_key === 'document_upload';
  const activeHasSubtasks = (activeTask?.subtask_count ?? 0) > 0;
  const activeIsChecklistDriven = activeIsDocuments || activeHasSubtasks;
  /* Closed by someone other than the joinee — they can see it and see what it
     is waiting on, but they cannot tick it. */
  const activeIsOwnerClosed = activeTask?.completion_mode === 'owner';

  return (
    <div className="tasks-page">
      {/* Out of flow on purpose: .tasks-page is a flex column with a gap, so
          an in-flow marker would push the whole page down by one gap. The
          inline style is what beats `.tasks-page > * { position: relative }`. */}
      <div
        ref={heroAnchorRef}
        aria-hidden="true"
        style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 0 }}
      />

      {error && <p className="error-text">{error}</p>}

      <header ref={heroRef} className={`tasks-hero${heroStuck ? ' tasks-hero--stuck' : ''}`}>
        {/* Count, title and the two names on one line, and all three survive
            the condense. They are what answers "where am I, and who do I
            ask" — the thing someone deep in the trail still wants — and
            folding the names away with the greeting was why they were never
            seen at all. */}
        <div className="tasks-hero-row">
          {/* Empty first cell, as on the right: the row is `1fr auto 1fr` and
              the title is centred on the middle one, so a missing outer cell
              would slide the title across rather than close up. */}
          <span aria-hidden="true" />

          <h1 className="tasks-title">
            {allDone ? 'You’re all set, ' : 'Your trail, '}
            <span className="tasks-title-script">{firstName}</span>
          </h1>

          {/* Empty third cell when there is nobody yet, so the title stays
              centred on the row rather than sliding right. */}
          {dashboard?.people ? (
            <ul className="tasks-people">
              <PersonLine role="Manager" person={dashboard.people.manager} />
              <PersonLine role="Buddy" person={dashboard.people.buddy} />
            </ul>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>

        {/* All that is left of the greeting is the line restating the count,
            which is the one part worth trading for trail once the hero
            sticks. */}
        <div className="tasks-hero-greeting">
          <p className="tasks-lede">{progressLine(percent, doneSteps)}</p>
        </div>

        {/* One node per task rather than the five onboarding stages, so the
            track and the trail below describe the same journey. Completion
            is passed per node because tasks finish out of order. */}
        <JourneyTrack
          compact
          stages={roadmapSteps.map((s, i) => ({
            key: s.id,
            label: `${i + 1}. ${s.title}`,
            done: s.status === 'completed',
          }))}
          currentKey={restingStepId ?? ''}
          finale={
            allDone
              ? {
                  title: `You’re all set, ${firstName}.`,
                  note: 'Every step of your onboarding is behind you — the trail stays here whenever you’d like to look back.',
                }
              : undefined
          }
        />

        {doFirst && (
          <div className="tasks-next">
            <span className="tasks-next-lead">
              <span className="tasks-live-dot" aria-hidden="true" />
              <span className="tasks-next-text">
                Up next: <strong>{doFirst.title}</strong>
                {dueLabel(doFirst.due_date, doFirst.status) && (
                  <span className="muted"> · {dueLabel(doFirst.due_date, doFirst.status)}</span>
                )}
              </span>
            </span>

            <button type="button" className="btn-solid btn-sm" onClick={() => openStep(doFirst.id)}>
              Open
            </button>
          </div>
        )}
      </header>

      {/* Reference on the left, work on the right. The rail is sticky so an
          article stays put while the trail scrolls past it. */}
      <div ref={splitRef} className="employee-home-split">
        <EmployeeKnowledgeRail onboardingStatus={dashboard?.onboarding.status ?? ''} />

        {roadmapSteps.length === 0 ? (
          <p className="muted">No steps on your onboarding yet — check back shortly.</p>
        ) : (
          <section className="tasks-trail">
            <TaskRoadmap
              steps={roadmapSteps}
              currentId={restingStepId}
              onSelect={openStep}
              onLocked={(step, blockedBy) =>
                toast({
                  tone: 'info',
                  title: `${step.title} hasn't opened yet`,
                  message: blockedBy
                    ? `Finish "${blockedBy.title}" first — steps open one at a time.`
                    : 'Steps open one at a time, as you finish the one before.',
                })
              }
              onVoyage={onVoyage}
            />
          </section>
        )}
      </div>

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
                  finish one task.

                  Neither does an owner-mode task. The company email & laptop
                  handover is HR's to close (migration 0031) — the API refuses
                  an employee confirmation on it, so offering the button was
                  offering a 400. */}
              {activeTask.status !== 'completed' &&
                !activeIsChecklistDriven &&
                activeIsOwnerClosed && (
                  <span className="field-hint">Waiting on HR to confirm this</span>
                )}
              {activeTask.status !== 'completed' &&
                !activeIsChecklistDriven &&
                !activeIsOwnerClosed && (
                <button
                  type="button"
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
          {/* Before the detail grid: if this task is stuck, that is the
              answer to why the popup was opened at all. */}
          {activeTask.blocker && <BlockerLine blocker={activeTask.blocker} />}

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

/** One of the two people HR picked. Initials on the app's amber avatar;
 *  no department tint, because no department is shown. */
function PersonLine({ role, person }: { role: string; person: PersonRef | null }) {
  const initials = person?.full_name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <li className="people-line">
      <span className={`people-avatar${person ? '' : ' is-empty'}`} aria-hidden="true">
        {initials ?? <PersonIcon />}
      </span>
      <span className="people-text">
        <span className="people-role">{role}</span>
        <span className="people-name">{person?.full_name ?? 'Not assigned yet'}</span>
      </span>
    </li>
  );
}

/** Shown in an avatar when nobody is assigned yet. */
function PersonIcon() {
  return (
    <svg className="person-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6" />
    </svg>
  );
}
