import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Puts every new page at the top.
 *
 * React Router changes the route without touching the scroll position, so
 * arriving somewhere from halfway down the page you were on dropped you
 * halfway down the new one — most visibly clicking the laptop at the
 * bottom of the home rail and landing on Mac Tools already scrolled past
 * the machine.
 *
 * Only on a PUSH (a link, a nav click). Back and forward are left alone:
 * the browser restores where you were, which is the whole point of going
 * back. An in-page #hash is left alone too, so anchor links still work.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'POP') return;
    if (hash) return;
    // `instant`, not the CSS-driven smooth scroll some pages opt into: a
    // page change should already be at the top when it paints, not glide
    // there afterwards.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, hash, navigationType]);

  return null;
}
