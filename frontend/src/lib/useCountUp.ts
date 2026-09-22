import { useEffect, useRef, useState } from 'react';

/**
 * A number that travels to its target instead of jumping there.
 *
 * The registry centre runs its value through NumberFlow, whose rolling
 * digits never engaged here — it mounts, holds the right number, and snaps
 * to it. Rather than keep digging through a third-party shadow DOM, this
 * counts between the two values, which is the effect asked for and is ours
 * to reason about.
 *
 * The displayed value is mirrored into a ref from inside the animation loop
 * rather than from a second effect. An effect watching the displayed value
 * ran on every frame and raced the loop that was producing it, which left
 * the count stranded on whichever number it reached first.
 *
 * Eased so the change starts quickly and settles, and it always lands
 * exactly on `target`. `prefers-reduced-motion` goes straight there.
 */
export function useCountUp(target: number, ms = 420): number {
  const [shown, setShown] = useState(target);
  // What is on screen right now, and so where the next run starts from.
  const shownRef = useRef(target);

  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shownRef.current = target;
      setShown(target);
      return;
    }

    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const eased = 1 - (1 - t) ** 3; // easeOutCubic
      const value = t === 1 ? target : Math.round(from + (target - from) * eased);
      shownRef.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);

  return shown;
}
