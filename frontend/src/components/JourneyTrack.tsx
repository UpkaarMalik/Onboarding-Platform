import { useEffect, useState } from 'react';

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
export default function JourneyTrack({
  stages,
  currentKey,
  compact = false,
  finale,
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

  /**
   * The finale waits for the marker to ARRIVE, not just for the last step
   * of the walk to be scheduled: `left` is transitioned over 350ms, so at
   * the moment animatedIndex reaches the end the marker is still travelling
   * that last leg. Landing the words on a dot that is still sliding is what
   * makes a celebration look mistimed.
   */
  useEffect(() => {
    setLanded(false);
    if (!finale || animatedIndex < activeIndex) return;
    const id = window.setTimeout(() => setLanded(true), 420);
    return () => window.clearTimeout(id);
  }, [finale, animatedIndex, activeIndex]);

  /**
   * Both fill and marker run to the same point: the CURRENT step's
   * node centre. Node k sits at `k / (N-1) * 100%` of the line's
   * inner coordinate frame (the line's 18px horizontal margin makes
   * its 0%/100% land on the first and last node centres), so the
   * marker uses that formula and the fill runs up to it. Splitting
   * the two — marker at the node, fill stopping short at
   * `doneCount / N` — left a visible gap between the end of the
   * orange and the marker, which read as the orange being missing.
   * The hero's "N of M done" copy is a separate count, and is what it
   * is; the LINE is now unambiguously "you've walked from step 1 to
   * this step".
   */
  function isDone(stage: { done?: boolean }, i: number) {
    return stage.done ?? i < animatedIndex;
  }
  const fillPercent =
    stages.length > 1 ? (animatedIndex / (stages.length - 1)) * 100 : 0;
  const markerPercent = fillPercent;

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
          <div className="journey-line-fill" style={{ width: `${fillPercent}%` }} />
          <div className="journey-marker" style={{ left: `${markerPercent}%` }} />
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
      {finale && landed && (
        <p className="journey-finale" role="status">
          <span className="journey-finale__title">{finale.title}</span>
          {finale.note && <span className="journey-finale__note">{finale.note}</span>}
        </p>
      )}
    </div>
  );
}
