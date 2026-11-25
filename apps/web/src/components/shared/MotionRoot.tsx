'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Replays the page-enter fade on every client-side navigation.
 *
 * The first load is handled by CSS (`main { animation: tkr-fade-in }` in
 * forest.css). A client navigation keeps the same <main> element, so the CSS
 * animation never runs again — this does it with the Web Animations API.
 *
 * OPACITY ONLY, on purpose: a transform or filter on <main> would make it the
 * containing block for every fixed bar, sheet and toast inside it while the
 * animation runs. Renders nothing.
 */
export function MotionRoot() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('main').forEach((main) => {
      main.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 420,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      });
    });
  }, [pathname]);

  return null;
}
