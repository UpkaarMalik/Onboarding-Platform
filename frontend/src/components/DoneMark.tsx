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
    </svg>
  );
}
