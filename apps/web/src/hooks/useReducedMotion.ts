'use client';

import { useEffect, useState } from 'react';

/**
 * Whether this user has asked for less motion.
 *
 * CSS handles the declarative half of the motion brief inside
 * `@media (prefers-reduced-motion: reduce)` blocks. This hook covers the half
 * CSS cannot reach: a JS-driven count-up, a rAF chart tween. Those must be
 * skipped outright — landing on the final value immediately — not merely sped
 * up (plan §2.5).
 *
 * Starts `false` so the server render and the first client render agree; the
 * real value lands in an effect. That is deliberate: the one frame of
 * disagreement is invisible, whereas a hydration mismatch is a console error
 * and a re-render of the whole subtree.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * Generic media-query subscription. The sidebar uses it to decide whether it is
 * a rail or a drawer, which must be a real query and not a CSS-only guess —
 * the drawer traps focus and the rail must not.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
