import type { CSSProperties } from 'react';

/**
 * The AndBoard logotype — the mark and the wordmark, in one place.
 *
 * Both used to be written out inline on the login page. They now appear
 * in the topnav and on the laptop's screen as well, and a logo copied
 * into three files is a logo that drifts, so this is the one copy. The
 * class names stay props: each site has its own sizing rules and the
 * login page's are load-bearing.
 */

/** The boomerang and its disc. Traced from the brand artwork, not drawn
 *  by hand: the disc belongs to the mark rather than sitting behind it,
 *  and the boomerang deliberately overhangs it on the left and the lower
 *  right. Re-trace against the asset rather than nudging these numbers.
 *
 *  The group scale keeps that enlarged footprint inside the viewBox; the
 *  disc sits down-right of the boomerang's centre so the notch between
 *  the wing and the tail closes inside the navy instead of running past
 *  its lower-right edge and showing the page through. */
export function BrandMark({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
    >
            {/* The disc sits down-right of the boomerang's centre so the
                notch between the wing and the tail closes inside the navy.
                At its old position the notch ran past the disc's lower-right
                edge and the last few units of it showed the page through.
                The group scale keeps the enlarged footprint in the viewBox. */}
            <g transform="scale(0.93)">
            <circle cx="79" cy="59" r="48" fill="#14304f" />
            <path
              d="M84.05 25.7 L87.01 25.62 L92.6 26.07 L95.22 26.55 L97.66 27.42 L100.53 29.28 L102.61 31.24 L104.45 33.47 L106.27 36.44 L108.02 39.93 L109.94 44.82 L111.23 49.01 L112.44 53.54 L113.99 60.87 L115.02 66.63 L116.96 80.25 L117.81 85.31 L117.77 85.89 L117.44 85.77 L108.66 77.16 L104.16 72.98 L99.19 68.63 L93.92 64.37 L87.19 59.71 L82.4 57.04 L79.45 54.46 L77.59 53.08 L75.67 51.97 L74.45 51.45 L70.61 50.93 L61.88 50.93 L56.3 51.28 L48.62 51.97 L38.49 53.14 L12.84 56.53 L3.94 57.56 L2.71 57.5 L1.49 57.15 L0.66 56.71 L0.1 55.99 L0 55.46 L0.1 54.77 L0.5 54.13 L0.97 53.72 L8.3 49.28 L13.88 46.25 L21.04 42.76 L26.8 40.2 L32.73 37.76 L39.72 35.16 L51.41 31.42 L55.77 30.22 L62.93 28.51 L70.08 27.11 L74.62 26.45 L79.16 25.97 Z M90.06 68.4 L90.5 68.63 L94.6 72.34 L99.46 77.11 L112.84 91.34 L113.72 91.73 L115.29 91.69 L116.68 91.24 L118.24 90.22 L118.41 90.2 L118.58 90.41 L119.52 96.48 L120 101.02 L120 106.43 L119.42 109.74 L119.01 110.77 L117.56 112.48 L116.16 113.53 L113.89 114.46 L111.62 114.8 L110.75 114.73 L109 114.3 L107.61 113.68 L106.56 112.89 L105.73 111.84 L103.88 106.95 L95.1 80.95 L91.98 72.92 L90.06 68.73 Z"
              fill="#ef9b3c"
            />
            </g>
          </svg>
  );
}

/** "AndBoard", with Board in the brand orange.
 *
 *  That orange measures 1.94:1 on cream. Fine here — WCAG 1.4.3 exempts
 *  text that is part of a logo and this is the logotype — but it is not
 *  a colour to reuse for anything that has to be read. */
export function BrandWord({
  className,
  brandClassName,
}: {
  className?: string;
  brandClassName?: string;
}) {
  return (
    <span className={className}>
      And<span className={brandClassName}>Board</span>
    </span>
  );
}
