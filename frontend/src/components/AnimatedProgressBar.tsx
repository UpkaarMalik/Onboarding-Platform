import { useEffect, useState, type CSSProperties } from 'react';

/** Any progress bar in the app — starts at 0 on every mount and
 *  animates up to the real value a beat later, rather than snapping
 *  straight to it, so reloading a page you're already 80% through
 *  still shows the climb instead of just the destination. */
export default function AnimatedProgressBar({
  percent,
  thin,
  style,
  showIndicator,
}: {
  percent: number;
  thin?: boolean;
  style?: CSSProperties;
  showIndicator?: boolean;
}) {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    setAnimated(0);
    const t = setTimeout(() => setAnimated(percent), 80);
    return () => clearTimeout(t);
  }, [percent]);

  return (
    <div className={`progress-bar-outer ${thin ? 'thin' : ''}`} style={style}>
      <div className="progress-bar-inner" style={{ width: `${animated}%` }}>
        {showIndicator && animated > 0 && animated < 100 && (
          <span className="progress-pulse-dot" />
        )}
      </div>
    </div>
  );
}
