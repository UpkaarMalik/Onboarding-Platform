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
}: {
  stages: { key: string; label: string }[];
  currentKey: string;
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

  const fillPercent = stages.length > 1 ? (animatedIndex / (stages.length - 1)) * 100 : 0;

  return (
    <div className="journey-track">
      <div className="journey-line">
        <div className="journey-line-fill" style={{ width: `${fillPercent}%` }} />
        <div className="journey-marker" style={{ left: `${fillPercent}%` }} />
      </div>
      <div className="journey-nodes">
        {stages.map((s, i) => (
          <div
            key={s.key}
            className={`journey-node ${i < animatedIndex ? 'done' : ''} ${i === animatedIndex ? 'current' : ''}`}
          >
            <span className="journey-dot">{i < animatedIndex ? '✓' : i + 1}</span>
            <span className="journey-label">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
