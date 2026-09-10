import { dueLabel } from '../lib/format';

export interface RoadmapItem {
  id: string;
  title: string;
  due_date: string;
  is_checkpoint: boolean;
  status: string; // raw backend status: locked | pending | blocked | completed | cancelled
  description?: string | null;
  system_key?: string | null;
  subtask_count?: number;
  subtask_completed_count?: number;
}

type VisualState = 'done' | 'active' | 'queued' | 'upcoming' | 'blocked';

function visualState(step: RoadmapItem, currentId: string | null): VisualState {
  if (step.status === 'completed') return 'done';
  if (step.status === 'blocked') return 'blocked';
  if (step.id === currentId) return 'active';
  // Phase-2 tasks start 'locked' until the checkpoint task is done
  // (OnboardingsService.insertOnboardingTask) — genuinely not actionable yet,
  // distinct from a task that's simply next in line.
  if (step.status === 'locked') return 'upcoming';
  return 'queued';
}

/** The connector inherits the *weaker* of the two nodes it joins, so the trail
 *  reads as a filling progress bar: solid green behind you, flowing amber at
 *  the frontier, faint ahead. */
function connectorState(a: VisualState, b: VisualState): 'done' | 'active' | 'upcoming' {
  if (a === 'done' && b === 'done') return 'done';
  if (a === 'done' || a === 'active' || b === 'active') return 'active';
  return 'upcoming';
}

const STATE_LABEL: Record<VisualState, string> = {
  done: 'Done',
  active: 'In progress',
  queued: 'Queued',
  upcoming: 'Upcoming',
  blocked: 'Blocked',
};

/**
 * The serpentine onboarding trail: every required task for this employee, in
 * order, as alternating left/right cards joined by a continuously curving
 * dashed spine that flows behind them.
 *
 * ON THE SVG GEOMETRY — this is the whole reason the component is shaped this
 * way. The obvious implementation is one big SVG behind the cards with
 * hand-plotted waypoints, and it cannot work here: the cards are rem-sized and
 * the container is fluid, so a uniformly-scaled SVG drifts away from them at
 * every width, and the height depends on the step count and on whether each
 * card has a description. Measuring with getBoundingClientRect instead trades
 * that for a re-measure pipeline that has to survive font loading, reflow, and
 * the `scale()` transform an ancestor applies on hover.
 *
 * So: ONE SMALL SVG PER GAP. Each spans only the space between two adjacent
 * nodes and never crosses a card, so no coordinate ever needs to know a card's
 * rendered height. `viewBox="0 0 100 100"` with `preserveAspectRatio="none"`
 * makes x a pure percentage of width and y a pure percentage of the gap's fixed
 * height — exact at every width, for any number of steps, with no measurement.
 * `vector-effect="non-scaling-stroke"` is what makes that safe: it keeps the
 * stroke width and the dash pattern true under the anisotropic scale, which is
 * otherwise the one thing that would disqualify this approach.
 *
 * Nodes always sit in the grid's centre column, so every gap's endpoints are
 * x=50 by construction. The curve bows toward whichever side the card above
 * occupied, which is what produces the serpentine.
 *
 * There is deliberately no travelling beacon: SMIL <animateMotion> and CSS
 * `offset-path` both refuse to restart when the path they reference changes, so
 * either would need a remount hack every time a task completes. The flowing
 * dash offset plus a pulsing active node reads as "you are here" with no
 * coordinate coupling at all.
 */
export default function TaskRoadmap({
  steps,
  currentId,
  onSelect,
}: {
  steps: RoadmapItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  if (steps.length === 0) return null;

  return (
    <div className="roadmap">
      {steps.map((step, i) => {
        const state = visualState(step, currentId);
        const isLast = i === steps.length - 1;
        const isFinal = isLast && step.is_checkpoint;
        const side: 'left' | 'right' = i % 2 === 0 ? 'left' : 'right';

        const card = (
          <RoadmapCard step={step} state={state} index={i} onSelect={onSelect} final={isFinal} />
        );

        return (
          <div key={step.id} className="roadmap-item" style={{ ['--i' as string]: i }}>
            {isFinal ? (
              <div className="roadmap-row roadmap-row--center">
                <span className={`roadmap-node roadmap-node--${state} roadmap-node--final`}>
                  {state === 'done' ? <CheckIcon /> : i + 1}
                </span>
                {card}
              </div>
            ) : (
              <div className={`roadmap-row roadmap-row--${side}`}>
                {side === 'left' ? card : <div className="roadmap-spacer" />}
                <span className={`roadmap-node roadmap-node--${state}`}>
                  {state === 'done' ? <CheckIcon /> : i + 1}
                </span>
                {side === 'right' ? card : <div className="roadmap-spacer" />}
              </div>
            )}

            {!isLast && (
              <RoadmapGap
                state={connectorState(state, visualState(steps[i + 1], currentId))}
                bowToward={side}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One curved segment of the trail. Two stacked paths on identical geometry: a
 * static pale rail underneath so the route is legible even where no progress
 * has been made, and a dashed one on top whose offset animates to make the
 * dashes travel. The flowing layer is omitted entirely for stretches that lie
 * ahead of the employee — nothing should appear to be moving there.
 */
function RoadmapGap({
  state,
  bowToward,
}: {
  state: 'done' | 'active' | 'upcoming';
  bowToward: 'left' | 'right';
}) {
  // The control points pull the curve toward the card it just left. Both
  // endpoints stay at x=50 (the node column), so consecutive gaps meet exactly.
  // A moderate lobe: the full-width sweep of the reference mockup assumed far
  // more vertical space between cards than a 5rem gap gives, and an extreme
  // bow over a short gap reads as a kink rather than a curve.
  const bow = bowToward === 'left' ? 26 : 74;
  const d = `M50,0 C${bow},28 ${bow},72 50,100`;

  return (
    <div className={`roadmap-gap roadmap-gap--${state}`} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path className="roadmap-spine roadmap-spine--rail" d={d} vectorEffect="non-scaling-stroke" />
        {state !== 'upcoming' && (
          <path
            className={`roadmap-spine roadmap-spine--flow roadmap-spine--${state}`}
            d={d}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RoadmapCard({
  step,
  state,
  index,
  onSelect,
  final,
}: {
  step: RoadmapItem;
  state: VisualState;
  index: number;
  onSelect: (id: string) => void;
  final?: boolean;
}) {
  // A 'locked' task genuinely isn't actionable yet — the checkpoint has to be
  // confirmed before the backend unlocks it — so inviting a click would only
  // produce a 403.
  const clickable = state !== 'upcoming';
  const Tag = clickable ? 'button' : 'div';

  const total = step.subtask_count ?? 0;
  const done = step.subtask_completed_count ?? 0;
  const isDocuments = step.system_key === 'document_upload';

  return (
    <Tag
      type={clickable ? 'button' : undefined}
      className={`roadmap-card roadmap-card--${state}${final ? ' roadmap-card--final' : ''}`}
      onClick={clickable ? () => onSelect(step.id) : undefined}
    >
      <div className="roadmap-card-top">
        <span className="roadmap-card-step">
          Step {String(index + 1).padStart(2, '0')}
          {state === 'active' && <span className="roadmap-card-step-live"> · Active</span>}
        </span>
        <span className={`roadmap-card-pill roadmap-card-pill--${state}`}>
          {state === 'done' && <CheckIcon />}
          {final && state !== 'done' ? 'Goal checkpoint' : STATE_LABEL[state]}
        </span>
      </div>

      <h3 className="roadmap-card-title">{step.title}</h3>
      {step.description && <p className="roadmap-card-desc">{step.description}</p>}

      <div className="roadmap-card-meta">
        <span className={`roadmap-card-due${state !== 'done' && step.status !== 'locked' ? '' : ' is-quiet'}`}>
          {state === 'done' ? 'Completed' : dueLabel(step.due_date, step.status)}
        </span>

        {isDocuments && (
          <span className="roadmap-chip roadmap-chip--docs">
            <DocIcon />
            Paperwork
          </span>
        )}

        {total > 0 && (
          <span className="roadmap-chip">
            {done}/{total} steps
          </span>
        )}
      </div>

      {total > 0 && state !== 'done' && (
        <span className="roadmap-card-track">
          <span
            className="roadmap-card-track-fill"
            style={{ width: `${Math.round((done / total) * 100)}%` }}
          />
        </span>
      )}

      {clickable && (
        <span className="roadmap-card-cta">
          {state === 'done' ? 'View' : isDocuments ? 'Upload documents' : 'Open task'}
          <span className="roadmap-card-cta-arrow">→</span>
        </span>
      )}

      {state === 'upcoming' && (
        <span className="roadmap-card-locked">
          <LockIcon />
          Unlocks after the checkpoint
        </span>
      )}
    </Tag>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round" />
    </svg>
  );
}
