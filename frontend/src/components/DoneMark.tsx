/**
 * The "this step is finished" marker: a green ring that strokes itself
 * closed and a green tick that writes inside it — the success mark's
 * two-beat shape, with the ring beat deliberately quick so the tick,
 * which is the part carrying the meaning, is what you actually watch.
 *
 * It replaces the filled disc with a white tick punched out of it. A disc
 * is a shape competing with the numbered nodes either side of it; a tick
 * on its own says "done" and nothing else, and it says it in the one
 * colour the rest of the page already uses for completion.
 *
 * Pure CSS, driven off mount rather than off a "just completed" flag, so
 * a step that arrives from the database already completed plays exactly
 * what a step ticked off on screen plays — the marker has one appearance
 * and one animation, whichever way the page got to it.
 */
/**
 * The confetti, as angle / distance / shape rather than as a list of
 * keyframes: one CSS animation reads these off custom properties, so adding
 * or moving a piece is editing this table and nothing else.
 *
 * Deliberately uneven — eight identical pieces at eight identical distances
 * reads as a loading spinner, not as something bursting. The odd ones fly
 * further and are slimmer; the even ones are square and fall shorter.
 */
const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => ({
  angle,
  travel: i % 2 ? 22 : 17,
  size: i % 2 ? 2.6 : 3.4,
  round: i % 2 ? 1.3 : 0.7,
}));

export default function DoneMark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`done-mark${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="done-mark__ring" cx="12" cy="12" r="10" />
      <path className="done-mark__tick" d="M7 12.3l3.4 3.5 6.8-7.2" />
      {/* The burst. Drawn last so it sits over the ring, and inside the SVG
          rather than beside it so it shares the mark's own coordinates and
          needs no second element to line up with. The mark sets
          overflow: visible, which is what lets these leave the 24-unit box. */}
      <g className="done-mark__pop">
        {SPARKS.map((s, i) => (
          <rect
            key={i}
            className="done-mark__spark"
            x={12 - s.size / 2}
            y={12 - s.size / 2}
            width={s.size}
            height={s.size}
            rx={s.round}
            style={{ ['--a' as string]: `${s.angle}deg`, ['--d' as string]: `${s.travel}px` }}
          />
        ))}
      </g>
    </svg>
  );
}
