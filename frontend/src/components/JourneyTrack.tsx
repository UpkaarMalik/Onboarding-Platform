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
    <div className={`journey-track${compact ? ' journey-track--compact' : ''}`}>
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
  );
}
