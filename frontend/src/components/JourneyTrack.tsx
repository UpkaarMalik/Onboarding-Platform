import { useEffect, useRef, useState } from 'react';

/**
 * The horizontal roadmap: numbered nodes on a connected track, the
 * completed stretch filled in the accent color, and a small marker
 * dot riding right at the current stage — same idea as a mission
 * "Earth → Moon → Mars" progress graphic, just onboarding stages
 * instead of planets, and a dot instead of a plane/rocket.
 *
 * Every mount (including a fresh login) replays the climb from stage
 * 1 up to wherever you actually are, one stage at a time, rather than
 * snapping straight to the final position — the point is to show the
 * journey, not just the destination.
 */
/** How long the hero takes to empty itself once the marker lands: the
 *  meter's exit in .journey-track--retired, which is the slower of the two
 *  halves. The sign-off waits exactly this long so it never shares the
 *  panel with the thing it replaces. */
const EXIT_MS = 380;

export default function JourneyTrack({
  stages,
  currentKey,
  compact = false,
  finale,
  onSettled,
}: {
  /** `done` is optional: the onboarding-stage track on Home is strictly
   *  sequential, so "everything before the current node" is correct there.
   *  The per-task track on the Tasks page is NOT — tasks get completed out of
   *  order, so it passes explicit per-node state and the index walk would
   *  otherwise mark the wrong ones. */
  stages: { key: string; label: string; done?: boolean }[];
  currentKey: string;
  /** Numbers only, no labels — for a track with one node per task, where
   *  labels would collide. */
  compact?: boolean;
  /** Written under the track once the marker has finished its climb and
   *  come to rest on the last node, at which point the track itself bows
   *  out and leaves the words behind. Passed only when there is something
   *  to say at the end — the caller decides that; this just waits for the
   *  arrival, because only the track knows when the walk is over. */
  finale?: { title: string; note?: string };
  /** Fired the moment the marker lands, which is the cue for the page to
   *  fold the rest of the hero away. The bar clears itself at the same
   *  time, so the two halves of the exit move together and the sign-off
   *  that follows arrives on an empty panel. Timed from here so the
   *  choreography lives in one place rather than two components each
   *  guessing at the other's clock. */
  onSettled?: () => void;
}) {
  const currentIndex = stages.findIndex((s) => s.key === currentKey);
  const activeIndex = currentIndex === -1 ? 0 : currentIndex;
  const [animatedIndex, setAnimatedIndex] = useState(0);

  useEffect(() => {
    setAnimatedIndex(0);
    if (activeIndex === 0) return;
    let step = 0;
    const interval = setInterval(() => {
      step += 1;
      setAnimatedIndex(step);
      if (step >= activeIndex) clearInterval(interval);
    }, 350);
    return () => clearInterval(interval);
  }, [activeIndex]);

  /** The marker is on the last node AND has stopped moving there. */
  const [landed, setLanded] = useState(false);
  /** The panel has finished emptying, so the sign-off may be written. */
  const [shown, setShown] = useState(false);
  /** Mirrored so the timing effect below does not restart every time the
   *  page hands down a freshly-made callback. */
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  /**
   * The finale waits for the marker to ARRIVE, not just for the last step
   * of the walk to be scheduled: `left` is transitioned over 350ms, so at
   * the moment animatedIndex reaches the end the marker is still travelling
   * that last leg. Landing the words on a dot that is still sliding is what
   * makes a celebration look mistimed.
   */
  const hasFinale = !!finale;
  useEffect(() => {
    // `hasFinale`, NOT `finale`. The page builds that object inline, so it is
    // a new one on every render. Depending on the object meant that any
    // re-render at all — a scroll toggling the sticky hero, a notification
    // poll, this very sequence folding the hero — re-entered this effect,
    // and the reset at the top of it tore the sign-off back off the screen,
    // brought the bar back, and replayed the whole ending 420ms later.
    if (!hasFinale) {
      setLanded(false);
      return;
    }
    // Landing is one-way while there is still something to say. A refetch
    // that changes which step is current restarts the walk, and un-landing
    // on that would leave the page in its finished shape — hero folded, bar
    // gone — with the words that explain it missing.
    if (animatedIndex < activeIndex) return;
    const id = window.setTimeout(() => setLanded(true), 420);
    return () => window.clearTimeout(id);
  }, [hasFinale, animatedIndex, activeIndex]);

  /**
   * The handover.
   *
   * Nothing is written until the panel is empty. The bar and the rest of the
   * hero leave together the instant the marker lands — one movement, not two
   * — and only once that is over do the words arrive. An earlier version put
   * the sign-off up first and cleared the bar underneath it afterwards, so
   * for the better part of a second the panel held both the measurement and
   * the verdict, which reads as a page mid-update rather than as a finish.
   *
   * EXIT_MS covers the slower of the two: the meter's own animation, which
   * .journey-track--retired runs for 380ms.
   */
  useEffect(() => {
    if (!landed) return;
    onSettledRef.current?.();
    const id = window.setTimeout(() => setShown(true), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [landed]);

  function isDone(stage: { done?: boolean }, i: number) {
    return stage.done ?? i < animatedIndex;
  }

  /**
   * Where node `i`'s dot actually is, in the LINE's coordinate space.
   *
   * The nodes are laid out by flexbox: one `flex: 1` column each, dot
   * centred in its column. So node i sits at `(i + 0.5) / N` of the ROW's
   * width — not at `i / (N - 1)`, which is where this used to put the
   * marker. The two agree only in the middle, and drift apart towards both
   * ends: on an eleven-step trail the marker sat 9px short of step 4 and
   * 23px PAST step 11, which is what "it has gone ahead" looks like.
   *
   * The row and the line are also not the same width — the line is inset by
   * --journey-inset on each side — so the row's width is `100% + 2 * inset`
   * of the line's, and the result shifts back by one inset to land in the
   * line's own frame. Both fill and marker use it, so the orange always
   * stops exactly under the mark rather than short of it.
   */
  function nodeLeft(i: number) {
    const f = (i + 0.5) / stages.length;
    return `calc((100% + var(--journey-inset) * 2) * ${f} - var(--journey-inset))`;
  }
  const markerAt = nodeLeft(animatedIndex);

  return (
    <div
      className={`journey-track${compact ? ' journey-track--compact' : ''}${landed ? ' journey-track--retired' : ''}`}
    >
      {/* The bar and its nodes are wrapped so they can leave as one thing.
          Once the onboarding is over the meter has nothing left to measure,
          and a full bar sitting under the words is the reader being told
          the same thing twice. */}
      <div className="journey-meter">
        <div className="journey-line">
          <div className="journey-line-fill" style={{ width: markerAt }} />
          <div className="journey-marker" style={{ left: markerAt }} />
        </div>
        <div className="journey-nodes">
          {stages.map((s, i) => (
            <div
              key={s.key}
              className={`journey-node ${isDone(s, i) ? 'done' : ''} ${i === animatedIndex ? 'current' : ''}`}
              title={compact ? s.label : undefined}
            >
              <span className="journey-dot">{isDone(s, i) ? '✓' : i + 1}</span>
              {!compact && <span className="journey-label">{s.label}</span>}
            </div>
          ))}
        </div>
      </div>
      {/* role="status" so it is announced when it appears: it is the one
          thing on this page that says the whole onboarding is over, and it
          arrives on a timer rather than on anything the reader did. */}
      {finale && shown && (
        <p className="journey-finale" role="status">
          <span className="journey-finale__title">{finale.title}</span>
          {finale.note && <span className="journey-finale__note">{finale.note}</span>}
        </p>
      )}
    </div>
  );
}
