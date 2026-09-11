import { useLayoutEffect, useRef, useState } from 'react';
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

interface Point {
  x: number;
  y: number;
}
interface Geometry {
  w: number;
  h: number;
  pts: Point[];
}

/**
 * Distance from `el` to `root` in LAYOUT pixels, by walking the offsetParent
 * chain rather than diffing getBoundingClientRect().
 *
 * That distinction is load-bearing: `.roadmap-item` runs a fadeInUp entrance
 * animation and the cards lift on hover, both of which are transforms.
 * Client rects include every ancestor transform, so a rect-based measurement
 * taken while the entrance animation is mid-flight bakes the translate into
 * the curve and leaves it permanently offset. offsetTop/offsetLeft are pure
 * layout values and ignore transforms entirely.
 *
 * Requires `root` to be positioned so it is guaranteed to appear in the chain.
 */
function offsetWithin(el: HTMLElement, root: HTMLElement): Point {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function sameGeometry(a: Geometry | null, b: Geometry): boolean {
  if (!a || a.w !== b.w || a.h !== b.h || a.pts.length !== b.pts.length) return false;
  return a.pts.every((p, i) => p.x === b.pts[i].x && p.y === b.pts[i].y);
}

/**
 * One smooth S between two adjacent nodes. Both control points sit directly
 * below/above their own endpoint, which makes the tangent vertical at every
 * node — so consecutive segments meet without a visible kink, and the whole
 * trail reads as one continuous route even though it is drawn in pieces.
 */
function segmentPath(a: Point, b: Point): string {
  const dy = b.y - a.y;
  const pull = Math.max(dy * 0.5, 1);
  return `M${a.x},${a.y} C${a.x},${a.y + pull} ${b.x},${b.y - pull} ${b.x},${b.y}`;
}

/** Pixels a second the boat makes good. Speed rather than a fixed duration,
 *  so a one-step hop and a ten-step maiden voyage feel like the same boat. */
const BOAT_SPEED = 170;
/** Clamped either side of it: below this a hop is a twitch, above it the trail
 *  is long enough that watching the whole crossing becomes a chore. */
const BOAT_MIN_DUR = 1.6;
const BOAT_MAX_DUR = 11;

/**
 * The serpentine onboarding trail: every required task for this employee, in
 * order, as alternating left/right cards joined by a continuously curving
 * dashed spine that flows behind them, with a glowing boat that sails the
 * route already walked and lands on the task currently in play.
 *
 * ON THE GEOMETRY — the connectors span node centre to node centre, which
 * means they cross the cards rather than living in the space between them
 * (a card is far taller than its 2.5rem node, so a between-rows-only curve
 * leaves a visible break beside every card). Node centres depend on card
 * heights, which depend on whether each task has a description, so there is
 * no percentage that expresses them: this measures.
 *
 * The measurement is kept honest by three things. It reads offsetTop/
 * offsetLeft, not client rects, so the entrance and hover transforms can't
 * corrupt it (see offsetWithin). A ResizeObserver on the container re-runs it
 * on any reflow, and `document.fonts.ready` covers the one reflow that fires
 * before the observer is useful. And the result is compared before it is
 * stored, so an observation that changes nothing can't drive a render loop.
 *
 * The curve is drawn once as an absolutely-positioned overlay behind the
 * cards — one <path> pair per gap (pale rail + animated dashes on top, so the
 * rail shows through the dash gaps) plus one invisible concatenated path that
 * exists only as the motion track for the boat.
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
  const rootRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Geometry | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const nodes = Array.from(root.querySelectorAll<HTMLElement>('[data-roadmap-node]'));
      const next: Geometry = {
        w: root.offsetWidth,
        h: root.offsetHeight,
        pts: nodes.map((n) => {
          const o = offsetWithin(n, root);
          return { x: o.x + n.offsetWidth / 2, y: o.y + n.offsetHeight / 2 };
        }),
      };
      setGeom((prev) => (sameGeometry(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    // Web fonts land after first paint and change every card's height.
    document.fonts?.ready.then(schedule).catch(() => {});

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [steps]);

  if (steps.length === 0) return null;

  const states = steps.map((s) => visualState(s, currentId));
  const currentIndex = steps.findIndex((s) => s.id === currentId);

  return (
    <div className="roadmap" ref={rootRef}>
      <RoadmapTrail geom={geom} states={states} currentIndex={currentIndex} />

      {steps.map((step, i) => {
        const state = states[i];
        const isLast = i === steps.length - 1;
        const isFinal = isLast && step.is_checkpoint;
        const side: 'left' | 'right' = i % 2 === 0 ? 'left' : 'right';

        const card = (
          <RoadmapCard step={step} state={state} index={i} onSelect={onSelect} final={isFinal} />
        );
        const node = (
          <span className={`roadmap-node roadmap-node--${state}${isFinal ? ' roadmap-node--final' : ''}`} data-roadmap-node="">
            {state === 'done' ? <CheckIcon /> : i + 1}
          </span>
        );

        return (
          <div key={step.id} className="roadmap-item" style={{ ['--i' as string]: i }}>
            {isFinal ? (
              <div className="roadmap-row roadmap-row--center">
                {node}
                {card}
              </div>
            ) : (
              <div className={`roadmap-row roadmap-row--${side}`}>
                {side === 'left' ? card : <div className="roadmap-spacer" />}
                {node}
                {side === 'right' ? card : <div className="roadmap-spacer" />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The boat, drawn from the side after the reference illustration: a small
 * white fishing boat with a navy underbody, a wheelhouse, a mast and sail,
 * and a life ring on the bow. Coordinates are local to the motion point, with
 * the waterline on y = 0 and the bow to the left.
 *
 * Side-on, not overhead, which settles two things that an overhead boat had
 * the opposite answer for. The travel must NOT rotate to the tangent —
 * rotate="auto" would stand this hull on its bow as it went down the page — so
 * the boat stays upright and the route bends around it. And it moors ABOVE the
 * node in page coordinates rather than back along its own axis, which is why
 * BOAT_BERTH is applied to the path's endpoint instead of to the boat.
 *
 * The hull is a constant because the navy underbody is the same outline used
 * as a clip: rather than draw a second path along the waterline and keep the
 * two in sync by hand, a straight rect below the waterline is clipped to the
 * hull, so the paint follows the hull exactly whatever the hull does next.
 */
const BOAT_HULL =
  'M-22.6,-5 C-17.6,-3 -10,-2.3 -1,-2.2 C8,-2.1 16,-2.5 22.4,-3.2 ' +
  'L21,4.6 C16,6.4 6,6.9 -3,6.7 C-11,6.5 -18.2,3.2 -22.6,-5 Z';
/** The sheer — the boat's top edge. Stroked dark over the hull, and over the
 *  life ring, which is what turns the ring into a dome above the gunwale. */
const BOAT_SHEER = 'M-22.6,-5 C-17.6,-3 -10,-2.3 -1,-2.2 C8,-2.1 16,-2.5 22.4,-3.2';

/**
 * How far above the node the boat ties up, in page pixels. Applied to the end
 * of its route, not to the boat: the trail's tangent is vertical at every node
 * (see segmentPath), so an endpoint lifted straight up still arrives
 * vertically, and the boat ends up floating over the step number with the
 * curve running on underneath it. 32 clears the node's 20px radius and the
 * boat's own 7px of keel.
 */
const BOAT_BERTH = 32;

/** The boat itself, with no notion of where it is — placing it is the
 *  caller's job, either by animateMotion or by a static transform. */
function BoatShape() {
  return (
    <g className="roadmap-boat">
      {/* A soft lamp-glow under the hull, and only that: it marks where the
          employee is without tinting the boat. */}
      <circle className="roadmap-boat-glow" r="14" filter="url(#roadmapRunnerGlow)" />
      <g className="roadmap-boat-body">
        {/* Rig first: the sail sits behind the mast, and both sit behind the
            wheelhouse, so the mast reads as stepped on the cabin roof. */}
        <path className="roadmap-boat-sail" d="M8.6,-30.6 L14.8,-17.2 L2.4,-17.2 Z" />
        <path className="roadmap-boat-mast" d="M8.6,-14 L8.6,-31.6" />
        <path className="roadmap-boat-spar" d="M4,-24.6 L13.4,-24.6" />
        <ellipse className="roadmap-boat-lamp" cx="8.6" cy="-20.2" rx="2.3" ry="1.8" />
        <path className="roadmap-boat-spar" d="M-5.4,-17 L-8.8,-19.8" />
        <circle className="roadmap-boat-lamp" cx="-9.4" cy="-20.3" r="1.1" />

        {/* Stern screen */}
        <path className="roadmap-boat-screen" d="M15,-2.6 L15.4,-9.2 L20.8,-8.4 L20.6,-2.9 Z" />
        <path className="roadmap-boat-screen-frame" d="M15,-2.6 L15.4,-9.2 L20.8,-8.4 L20.6,-2.9" />
        <path className="roadmap-boat-screen-frame" d="M18,-8.8 L18,-2.75" />

        {/* Hull, then the paint below the waterline clipped to it. */}
        <path className="roadmap-boat-hull" d={BOAT_HULL} />
        <rect
          className="roadmap-boat-boot"
          x="-26"
          y="2.8"
          width="50"
          height="8"
          clipPath="url(#roadmapBoatHull)"
        />
        <path className="roadmap-boat-strake" d="M-12,0.8 C-3,1.8 8,1.6 17.4,0.6" />
        <circle className="roadmap-boat-port" cx="16.4" cy="0.4" r="1" />

        {/* The life ring: the one warm note on the boat, and the only place
            the page's accent colour touches it. Drawn before the sheer so the
            gunwale cuts it into a dome. */}
        <circle className="roadmap-boat-ring" cx="-7.6" cy="-3" r="3" />
        <path className="roadmap-boat-sheer" d={BOAT_SHEER} />

        {/* Stem post and bow bollard */}
        <path className="roadmap-boat-stem" d="M-23.6,-7 L-22.3,-3" />
        <rect
          className="roadmap-boat-bollard"
          x="-24.2"
          y="-11.2"
          width="3.4"
          height="5.6"
          rx="1.7"
        />

        {/* Wheelhouse */}
        <rect className="roadmap-boat-cabin" x="-4.6" y="-15.6" width="17" height="13.2" rx="1" />
        <rect className="roadmap-boat-cabin-roof" x="-6.6" y="-17.4" width="21" height="2.3" rx="1.15" />
        <rect className="roadmap-boat-window" x="-3" y="-13.8" width="3.4" height="4" rx="0.9" />
        <rect className="roadmap-boat-window" x="1" y="-13.8" width="3.4" height="4" rx="0.9" />
        <rect className="roadmap-boat-window" x="5" y="-13.8" width="3.4" height="4" rx="0.9" />
        <rect className="roadmap-boat-window" x="9.4" y="-13.2" width="1.9" height="6.6" rx="0.95" />
      </g>
    </g>
  );
}

/**
 * The drawn trail. Renders nothing until the first measurement lands, which
 * is one frame — the cards are already on screen by then, so the curve fades
 * in rather than popping the layout.
 */
function RoadmapTrail({
  geom,
  states,
  currentIndex,
}: {
  geom: Geometry | null;
  states: VisualState[];
  currentIndex: number;
}) {
  // Which leg the boat still has to sail. This is held rather than derived,
  // because it depends on where the boat already IS: on the first render it
  // sails the whole route walked so far, and from then on only the leg it has
  // just gained. Deriving it from currentIndex alone would replay the journey
  // from step one every time a task was completed.
  const legRef = useRef<{ from: number; to: number } | null>(null);
  // The route, rendered invisibly into the SVG purely so it can be measured:
  // getTotalLength/getPointAtLength are what move the boat.
  const routeRef = useRef<SVGPathElement>(null);
  const boatRef = useRef<SVGGElement>(null);

  const pts = geom?.pts ?? [];
  const ready = !!geom && pts.length >= 2 && geom.w > 0;

  // Reduced motion is honoured here rather than in CSS, because the boat is
  // also the "you are here" marker: the voyage is what has to go, not the
  // boat. It is placed at its mooring directly instead.
  const reduced =
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let route: string | null = null;
  let mooring: Point | null = null;
  let segments: Array<{ d: string; state: 'done' | 'active' | 'upcoming' }> = [];

  if (ready) {
    segments = pts.slice(0, -1).map((pt, k) => ({
      d: segmentPath(pt, pts[k + 1]),
      state: connectorState(states[k] ?? 'queued', states[k + 1] ?? 'queued'),
    }));

    // Where the boat belongs: moored at the task in play, or at step one when
    // nothing has started yet. There is always such a place, so the boat is
    // always on the trail — it is the "you are here" marker, and a marker that
    // vanishes for the employee who has only just begun is no marker at all.
    const berth = currentIndex >= 0 ? Math.min(currentIndex, pts.length - 1) : 0;
    if (legRef.current === null) legRef.current = { from: 0, to: berth };
    else if (legRef.current.to !== berth) legRef.current = { from: legRef.current.to, to: berth };
    const leg = legRef.current;

    mooring = { x: pts[leg.to].x, y: pts[leg.to].y - BOAT_BERTH };

    if (leg.from < leg.to) {
      // Both ends raised to mooring height: it casts off from where it was
      // tied up and arrives at where it will tie up, so there is no BOAT_BERTH
      // drop as it leaves and none as it lands. Every point between is on the
      // trail itself.
      const legPts = pts
        .slice(leg.from, leg.to + 1)
        .map((pt, k, all) =>
          k === 0 || k === all.length - 1 ? { x: pt.x, y: pt.y - BOAT_BERTH } : pt,
        );
      // ONE continuous path: a single M followed by curves that each pick up
      // where the last left off. segmentPath emits its own M, which would give
      // the route as many subpaths as it has legs.
      route =
        `M${legPts[0].x},${legPts[0].y} ` +
        legPts
          .slice(0, -1)
          .map((pt, k) => segmentPath(pt, legPts[k + 1]).replace(/^M[^C]*/, ''))
          .join(' ');
    }
  }

  /**
   * The voyage.
   *
   * This is a requestAnimationFrame loop walking getPointAtLength, and not the
   * <animateMotion> element it replaced, because that element does not work.
   * SMIL path motion is unevenly implemented: in this app's own runtime it
   * froze the boat at the start for the full duration and then jumped it to
   * the finish in one frame — a silent failure, since the element is valid,
   * the timeline runs, and fill="freeze" lands the boat in exactly the right
   * place. Only sampling the painted position mid-flight shows it never moved.
   *
   * Measuring the real path also means the duration can come from the real
   * arc length rather than an estimate, and the easing is ours: the boat leans
   * into the crossing and comes alongside rather than starting and stopping at
   * full speed.
   */
  useLayoutEffect(() => {
    const boat = boatRef.current;
    if (!boat) return;

    const place = (x: number, y: number) => {
      boat.setAttribute('transform', `translate(${x},${y})`);
    };

    // Nothing to sail: either the boat is already where it belongs, or this
    // employee's current task is step one and there is no route behind it.
    const path = routeRef.current;
    if (!route || !path) {
      if (mooring) place(mooring.x, mooring.y);
      return;
    }

    const len = path.getTotalLength();
    if (!len) {
      if (mooring) place(mooring.x, mooring.y);
      return;
    }

    const end = path.getPointAtLength(len);
    if (reduced) {
      place(end.x, end.y);
      return;
    }

    const dur =
      Math.min(BOAT_MAX_DUR, Math.max(BOAT_MIN_DUR, len / BOAT_SPEED)) * 1000;
    const started = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / dur);
      // ease-in-out
      const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const p = path.getPointAtLength(eased * len);
      place(p.x, p.y);
      if (t < 1) raf = requestAnimationFrame(tick);
    };

    const first = path.getPointAtLength(0);
    place(first.x, first.y);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // mooring is a fresh object every render, so its coordinates are the deps:
    // a resize has to re-place a boat that is already tied up.
  }, [route, reduced, mooring?.x, mooring?.y]);

  if (!ready || !geom) return null;

  const { w, h } = geom;

  return (
    <svg
      className="roadmap-trail"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <filter id="roadmapRunnerGlow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
        {/* The hull, reused as a clip so the paint below the waterline follows
            it exactly — see BOAT_HULL. */}
        <clipPath id="roadmapBoatHull">
          <path d={BOAT_HULL} />
        </clipPath>
      </defs>

      {segments.map((seg, i) => (
        <g key={i}>
          <path className="roadmap-spine roadmap-spine--rail" d={seg.d} />
          {/* Every segment flows, including the ones ahead — the trail reads
              as one continuous moving route rather than stopping dead at the
              current step. Colour and speed carry the state instead. */}
          <path className={`roadmap-spine roadmap-spine--flow roadmap-spine--${seg.state}`} d={seg.d} />
        </g>
      ))}

      {/* The route: never painted, only measured. */}
      {route && <path ref={routeRef} className="roadmap-route" d={route} />}

      {/* Moored or under way, the boat is always on the trail, and its position
          comes from the effect above rather than from an attribute here — one
          source of truth for where it is. */}
      <g className="roadmap-runner">
        <g ref={boatRef}>
          <BoatShape />
        </g>
      </g>
    </svg>
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
