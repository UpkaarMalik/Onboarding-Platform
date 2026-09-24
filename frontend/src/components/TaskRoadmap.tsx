import { useLayoutEffect, useRef, useState } from 'react';
import { dueLabel } from '../lib/format';
import { MARK_BOOMERANG_PATH, MARK_RADIUS } from '../lib/andMark';
import BlockerLine, { type TaskBlocker } from './BlockerLine';

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
  blocker?: TaskBlocker | null;
}

type VisualState = 'done' | 'active' | 'queued' | 'upcoming' | 'blocked';

/**
 * The server sends steps already in trail order with one step open and the
 * rest locked behind it (see backend trail-order.util), so this is a straight
 * reading of what it said — no second opinion about what the employee can do
 * next.
 */
function visualState(step: RoadmapItem, currentId: string | null): VisualState {
  if (step.status === 'completed') return 'done';
  if (step.status === 'blocked') return 'blocked';
  if (step.id === currentId) return 'active';
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
const BOAT_SPEED = 220;
/** Clamped either side of it: below this a hop is a twitch, above it the trail
 *  is long enough that watching the whole crossing becomes a chore. */
const BOAT_MIN_DUR = 1.2;
const BOAT_MAX_DUR = 8;

/** Keys that scroll. Pressing one is the employee taking the wheel, and the
 *  boat stops towing the page from that moment on. */
const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
  'Spacebar',
]);

/**
 * Where down the viewport the boat is held while the page follows it, as a
 * fraction of the window height.
 *
 * A fraction of the WHOLE window, deliberately, and not "the middle of
 * whatever the sticky hero leaves free". The hero's height depends on the
 * scroll position — it condenses once it sticks — so a target computed from it
 * is a loop: scrolling shrinks the hero, a shorter hero moves the target,
 * moving the target scrolls, and the page hunts for a moment before it
 * settles. 0.58 lands within a couple of pixels of that centre once the hero
 * has condensed, and is simply a constant.
 */
const BOAT_VIEW_ANCHOR = 0.58;

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
  onVoyage,
}: {
  steps: RoadmapItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  /** Called with true when the mark casts off and false when it ties up.
   *  The page around the trail needs to know, because for as long as this is
   *  true the scroll position belongs to the voyage — see the note on the tow
   *  in RoadmapTrail, and the hero's scroll listener in EmployeeTasks. */
  onVoyage?: (sailing: boolean) => void;
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
      <RoadmapTrail
        geom={geom}
        states={states}
        currentIndex={currentIndex}
        onVoyage={onVoyage}
      />

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
 * The runner on the trail: the AND Payments mark — the navy disc with the
 * boomerang on it, imported from lib/andMark, which carries the outline
 * traced from the brand asset itself.
 *
 * Two things follow from it being a disc rather than the side-on boat it
 * replaced. It is radially symmetric, so it never needs to rotate to the
 * tangent (and must not: `rotate="auto"` would have stood the old hull on its
 * bow going down the page). And it is centred on the motion point rather than
 * floating on a waterline, so MARK_BERTH has to clear the node by the disc's
 * own radius as well.
 */

/**
 * How far above the node the mark ties up, in page pixels. Applied to the end
 * of its route, not to the mark: the trail's tangent is vertical at every node
 * (see segmentPath), so an endpoint lifted straight up still arrives
 * vertically, and the mark ends up floating over the step number with the
 * curve running on underneath it. It has to clear the node's 20px radius plus
 * the disc's own 19, so 46 leaves a 7px gap.
 */
const MARK_BERTH = 46;

/**
 * The spin, as a fidget spinner behaves: flicked hard, then coasting down.
 *
 * Turn COUNT is still derived from how long the crossing takes, so a short hop
 * and a long voyage feel like the same flick rather than the same number of
 * turns crammed into different times.
 */
const SPIN_TURNS_PER_SEC = 2.8;
const SPIN_MIN_TURNS = 2;

/**
 * Angular progress, 0 to 1, across the crossing.
 *
 * Linear: the boomerang turns at a constant rate from the very first frame of
 * the voyage to the very last, and then stops dead on landing. Its derivative
 * is a flat 1 across `[0, 1]`, so there is no front-loaded flick and no lazy
 * freewheel at the end — the spin is the voyage, start to finish, and the
 * moor is where the star meets it.
 *
 * At t = 1 this is exactly 1, so multiplied by a whole number of turns the
 * mark still comes to rest on the logo's own orientation, to the degree.
 */
const spinEase = (t: number) => t;

/** A four-pointed star drawn from unit-radius points, translated to whatever
 *  the caller wants at whatever size — kept as a shape so the same node can
 *  live on the disc AND float off it during the flourish without duplicating
 *  the geometry. */
const SPARKLE_PATH =
  'M0,-1 L0.22,-0.22 L1,0 L0.22,0.22 L0,1 L-0.22,0.22 L-1,0 L-0.22,-0.22 Z';

/**
 * The sparkle at the tail tip. Anchored inside the spinning group so it
 * inherits the boomerang's orientation — which, since the voyage always lands
 * on an integer number of turns, is exactly its rest orientation whenever it
 * matters. Its own animation runs whenever the mark is moored (see
 * `.roadmap-runner.is-sailing` gating in CSS) and stays quiet through the
 * crossing so the twinkle doesn't compete with the spin.
 */
function Sparkle() {
  // Base sizing lives on the wrapping <g>, not the <path>: browsers let the
  // CSS `transform` property on an SVG element override its `transform`
  // ATTRIBUTE, so a `scale(4.2)` written on the path itself is thrown away
  // the moment the twinkle keyframes attach their own transform. Placing the
  // sizing one level up leaves the path free to be pulsed by CSS.
  return (
    <g className="roadmap-mark-sparkle" transform="translate(14.5 22) scale(4.2)">
      <path className="roadmap-mark-sparkle-shape" d={SPARKLE_PATH} />
    </g>
  );
}

/** The mark itself, with no notion of where it is — placing it is the
 *  caller's job, and turning the boomerang is the voyage's. */
function MarkShape({ spinRef }: { spinRef: React.RefObject<SVGGElement> }) {
  return (
    <g className="roadmap-mark">
      {/* A soft glow under the disc, and only that: it marks where the
          employee is without tinting the mark. */}
      <circle className="roadmap-mark-glow" r={MARK_RADIUS + 3} filter="url(#roadmapRunnerGlow)" />
      <circle className="roadmap-mark-disc" r={MARK_RADIUS} />
      {/* The boomerang is its own group so the disc behind it stays put while
          it turns. The transform is written by the voyage effect, never here —
          one source of truth for its angle, the same rule the position
          follows. The sparkle rides inside the same group so it sits at the
          tail tip in the mark's own coordinate frame; whenever the voyage is
          idle the boomerang is at 0° and the sparkle lands where the artwork
          expects it. */}
      <g ref={spinRef}>
        <path className="roadmap-mark-boomerang" d={MARK_BOOMERANG_PATH} />
        <Sparkle />
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
  onVoyage,
}: {
  geom: Geometry | null;
  states: VisualState[];
  currentIndex: number;
  onVoyage?: (sailing: boolean) => void;
}) {
  // Mirrored into a ref so the voyage effect can announce itself without
  // taking the callback as a dependency: a parent that re-creates the
  // function would otherwise restart the crossing from t = 0.
  const onVoyageRef = useRef(onVoyage);
  onVoyageRef.current = onVoyage;
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
  // The boomerang's own group, turned by the voyage effect below.
  const spinRef = useRef<SVGGElement>(null);
  // The overlay, needed to turn the boat's position in the drawing into a
  // position on the page.
  const svgRef = useRef<SVGSVGElement>(null);
  // Whether the page has been led to the boat yet. A voyage always leads;
  // a boat that simply appears at its mooring leads only the first time, so
  // that a re-measure after a resize doesn't yank the page out from under
  // someone who has scrolled off to read an earlier step.
  const ledRef = useRef(false);

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

    mooring = { x: pts[leg.to].x, y: pts[leg.to].y - MARK_BERTH };

    if (leg.from < leg.to) {
      // Both ends raised to mooring height: it casts off from where it was
      // tied up and arrives at where it will tie up, so there is no MARK_BERTH
      // drop as it leaves and none as it lands. Every point between is on the
      // trail itself.
      const legPts = pts
        .slice(leg.from, leg.to + 1)
        .map((pt, k, all) =>
          k === 0 || k === all.length - 1 ? { x: pt.x, y: pt.y - MARK_BERTH } : pt,
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

    /**
     * Sailing/moored is written to the outer runner group as a class so the
     * sparkle can be gated purely from CSS: it stays hidden through the spin
     * and restarts its twinkle fresh the moment the mark drops anchor
     * (removing `animation` and adding it back is what replays the keyframes).
     */
    const runner = boat.parentNode as SVGGElement | null;
    const setSailing = (sailing: boolean) => {
      runner?.classList.toggle('is-sailing', sailing);
      onVoyageRef.current?.(sailing);
    };

    /**
     * The boomerang's angle about the disc's centre.
     *
     * `rotate(deg)` with no centre argument turns about the current user-space
     * origin, and the parent's translate() has already put that origin on the
     * motion point — which is where the disc is drawn (cx/cy default to 0). So
     * the pivot IS the blue circle's centre, exactly, with nothing to keep in
     * sync.
     *
     * An earlier version slid the boomerang so its bounding-box centre sat on
     * the disc's before turning. A bounding box has no relationship to the
     * artwork, so that pivot was effectively an arbitrary point, and the slide
     * added a second movement on top of the spin. Both are gone: it turns
     * about the circle's centre and does nothing else.
     */
    const spinTo = (deg: number) => {
      spinRef.current?.setAttribute('transform', `rotate(${deg})`);
    };

    /**
     * The page follows the boat.
     *
     * The task in play can be eight rows down a trail several screens tall,
     * and a "you are here" marker the employee has to go hunting for is not a
     * marker. So the boat tows the scroll position: it is held at a fixed
     * height down the window (see BOAT_VIEW_ANCHOR) for the whole crossing,
     * and by the time it moors the employee is already looking at the task.
     *
     * It lets go the instant they take the scroll themselves, which is watched
     * two ways. Wheel, touch and the scrolling keys release it on the input
     * itself, before the page has moved at all. Scroll events are the backstop
     * for the one gesture those miss — a scrollbar drag produces no wheel, no
     * touch and no keystroke — by checking where the page ended up against
     * where this code last asked it to go.
     */
    let towing = true;
    let commanded = window.scrollY;
    // When the tow last moved the page itself. A running voyage commands a
    // scroll every frame, so a scroll event arriving within a few frames of
    // one of ours is either ours or the browser reacting to it — clamping
    // scrollY because the condensing hero just shortened the document, say.
    // Those reactions are indistinguishable by position from somebody
    // grabbing the scrollbar, and treating them as such drops the tow and
    // strands the page for the rest of the crossing. Wheel, touch and the
    // scrolling keys are unaffected: they release the tow on the input
    // itself, which is how an employee actually takes over.
    let commandedAt = 0;
    const SELF_SCROLL_WINDOW = 100;
    const yield_ = () => {
      towing = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) yield_();
    };
    const onScroll = () => {
      if (performance.now() - commandedAt < SELF_SCROLL_WINDOW) return;
      if (Math.abs(window.scrollY - commanded) > 2) yield_();
    };
    window.addEventListener('wheel', yield_, { passive: true });
    window.addEventListener('touchmove', yield_, { passive: true });
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, { passive: true });
    const unhook = () => {
      window.removeEventListener('wheel', yield_);
      window.removeEventListener('touchmove', yield_);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll);
    };

    /**
     * The page follows the boat, every frame, with nothing held back.
     *
     * Two guards used to live here and both were wrong, in opposite ways.
     *
     * A high-water mark on the target ("only ever pull further down the page")
     * was silently defeated by the hero: condensing it collapses the greeting
     * and lifts the whole trail in document coordinates, so every target for
     * the rest of the voyage evaluated BELOW the mark and the tow quietly
     * stopped while the mark kept sailing. Comparing against the live scrollY
     * instead needed a slack margin to avoid firing on sub-pixel deltas, and
     * that margin turned a continuous tow into a series of jumps its own size
     * — the page juddering rather than gliding.
     *
     * Neither guard was needed. The boat sails DOWN a leg by construction, so
     * the target rises on its own; the only thing that lowers it is the trail
     * being lifted by a layout shift, and in that case scrolling up by the
     * same amount is precisely what holds the mark still on screen. Forward
     * motion is the boat's job, not the scroll's.
     */
    const follow = (y: number) => {
      const svg = svgRef.current;
      if (!towing || !svg) return;
      // The overlay is drawn at one unit per pixel (viewBox `0 0 w h` on a
      // w x h element), so the boat's own y needs no scaling — only the
      // overlay's offset down the page.
      const pageY = svg.getBoundingClientRect().top + window.scrollY + y;
      const furthest = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const want = pageY - window.innerHeight * BOAT_VIEW_ANCHOR;
      const target = Math.min(Math.max(0, want), furthest);
      window.scrollTo(0, target);
      // Read the position BACK rather than trusting the number we passed: the
      // browser clamps and rounds what it is given, and `commanded` is only
      // useful to onScroll if it is what actually happened.
      commanded = window.scrollY;
      commandedAt = performance.now();
    };

    /** Nothing to sail — put the boat where it belongs and, if this is the
     *  first time, take the page there too. */
    const moor = () => {
      if (!mooring) return unhook;
      place(mooring.x, mooring.y);
      spinTo(0);
      setSailing(false);
      if (!ledRef.current) {
        ledRef.current = true;
        follow(mooring.y);
      }
      return unhook;
    };

    // Either the boat is already where it belongs, or this employee's current
    // task is step one and there is no route behind it.
    const path = routeRef.current;
    if (!route || !path) return moor();

    const len = path.getTotalLength();
    if (!len) return moor();

    ledRef.current = true;

    const end = path.getPointAtLength(len);
    if (reduced) {
      place(end.x, end.y);
      spinTo(0);
      setSailing(false);
      follow(end.y);
      return unhook;
    }

    const dur =
      Math.min(BOAT_MAX_DUR, Math.max(BOAT_MIN_DUR, len / BOAT_SPEED)) * 1000;

    /*
     * A WHOLE number of turns, which is the whole trick.
     *
     * The spin is `eased * 360 * turns`, and `eased` is exactly 1 on the last
     * frame, so the final angle is exactly 360 x turns — the same orientation
     * as 0, i.e. the mark's rest position, to the degree. Spinning at a fixed
     * rate for the travel's duration would instead stop wherever the clock
     * happened to land and leave the boomerang crooked on the disc.
     *
     * Rounding to an integer is what keeps that true, so the turn count is
     * derived from the duration and then rounded, never used as a fraction.
     */
    const turns = Math.max(SPIN_MIN_TURNS, Math.round((dur / 1000) * SPIN_TURNS_PER_SEC));
    // The clock starts on the FIRST FRAME, not here. requestAnimationFrame is
    // paused while the page is hidden, but performance.now() is not: timing
    // from effect time means a Tasks page opened in a background tab spends
    // its whole voyage hidden and is already moored by the time anyone looks.
    // Starting on the first frame turns that into a delayed departure instead.
    let started = 0;
    let raf = 0;

    const tick = (now: number) => {
      if (!started) started = now;
      const t = Math.min(1, (now - started) / dur);
      // ease-in-out
      const eased = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const p = path.getPointAtLength(eased * len);
      place(p.x, p.y);
      // The spin runs on its own ease — the flick — while the position runs on
      // the travel's. They share only the clock, and both land exactly on 1,
      // so at t = 1 this is exactly 360 x turns: the logo, to the degree.
      spinTo(spinEase(t) * 360 * turns);
      follow(p.y);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setSailing(false);
    };

    const first = path.getPointAtLength(0);
    place(first.x, first.y);
    spinTo(0);
    setSailing(true);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setSailing(false);
      unhook();
    };
    // mooring is a fresh object every render, so its coordinates are the deps:
    // a resize has to re-place a boat that is already tied up.
  }, [route, reduced, mooring?.x, mooring?.y]);

  if (!ready || !geom) return null;

  const { w, h } = geom;

  return (
    <svg
      ref={svgRef}
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
          <MarkShape spinRef={spinRef} />
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
  // A locked step is one the employee hasn't reached yet: steps open one at a
  // time, so inviting a click on a later one would promise something the
  // journey doesn't allow.
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
      {/* Above the meta row, not inside it: this is the reason the card is
          the colour it is, and it should be read before the due date. */}
      {step.blocker && <BlockerLine blocker={step.blocker} />}

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
          Opens once the step before it is done
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