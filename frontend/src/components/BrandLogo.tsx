import type { CSSProperties } from 'react';
import { MARK_BOOMERANG_PATH, MARK_NAVY, MARK_ORANGE, MARK_RADIUS } from '../lib/andMark';

/**
 * The AndBoard logotype — the mark and the wordmark, in one place.
 *
 * Both used to be written out inline on the login page. They now appear
 * in the topnav and on the laptop's screen as well, and a logo copied
 * into three files is a logo that drifts, so this is the one copy. The
 * class names stay props: each site has its own sizing rules and the
 * login page's are load-bearing.
 */

/** The boomerang on its disc — the SAME artwork the roadmap mark uses, from
 *  lib/andMark. It used to be a separate hand-traced copy with its own
 *  near-miss colours (#14304f / #ef9b3c), so the logo in the topnav and the
 *  mark sailing the trail were two different drawings of one logo.
 *
 *  The viewBox is the artwork's measured extent, not a round number: the disc
 *  is centred on (0,0) with radius MARK_RADIUS, and the boomerang overhangs
 *  it to the left and drops past it at the lower right, so the box has to
 *  reach -25.9 on x and 22.6 on y to hold the whole mark. */
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
      viewBox="-27.5 -22.2 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="0" cy="0" r={MARK_RADIUS} fill={MARK_NAVY} />
      <path d={MARK_BOOMERANG_PATH} fill={MARK_ORANGE} />
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
