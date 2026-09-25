'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from './useReducedMotion';

/**
 * ★ The KPI count-up, done without lying about what the page says.
 *
 * ── WHY THIS RETURNS A REF INSTEAD OF A NUMBER ──────────────────────────────
 * The obvious implementation holds the animated number in state and renders it.
 * That has two real problems:
 *
 *   1. The server renders `0` and the client's first paint renders `0`, so for
 *      a beat every KPI on the page says zero. A dashboard that says "₹0" while
 *      it animates is a dashboard that is briefly WRONG, and someone will
 *      screenshot it.
 *   2. It re-renders the whole tile ~60 times a second for a cosmetic effect.
 *
 * So React renders the FINAL value — correct in the HTML, correct on first
 * paint, correct with JavaScript disabled — and this hook takes the DOM node
 * and rewrites its text during the ramp, landing exactly back on the string
 * React already put there. The animation is a decoration over a correct page,
 * not the thing the page depends on to be correct.
 *
 * ── REDUCED MOTION ──────────────────────────────────────────────────────────
 * Skipped entirely. The rendered value is already right, so there is nothing
 * to do and nothing to clean up.
 */

export interface CountUpOptions {
  /** ms; the brief's --t-move doubled, because a number needs longer to read */
  durationMs?: number;
  /** stagger, so a row of eight tiles arrives as a wave and not a slam */
  delayMs?: number;
  /** how the animated number becomes the string in the DOM */
  format: (value: number) => string;
}

export function useCountUp(
  value: number,
  { durationMs = 640, delayMs = 0, format }: CountUpOptions,
): React.RefObject<HTMLSpanElement | null> {
  const ref = useRef<HTMLSpanElement | null>(null);
  const reduced = useReducedMotion();

  // `format` is almost always an inline arrow. Holding it in a ref keeps it out
  // of the effect's dependencies, so the count-up does not restart on every
  // parent render.
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const node = ref.current;
    if (!node || reduced || !Number.isFinite(value)) return;

    let frame = 0;
    let start = 0;
    const final = formatRef.current(value);

    // ease-out cubic: fast enough to read as a response, slow enough at the end
    // that the final digits settle rather than snap.
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);

    const step = (now: number) => {
      if (start === 0) start = now;
      const elapsed = now - start - delayMs;

      if (elapsed < 0) {
        frame = requestAnimationFrame(step);
        return;
      }
      const progress = Math.min(1, elapsed / durationMs);
      node.textContent = formatRef.current(value * ease(progress));

      if (progress < 1) {
        frame = requestAnimationFrame(step);
      } else {
        // Land on React's own string, character for character. Re-deriving it
        // from `value * 1` could round differently and leave the DOM one paisa
        // away from what the component believes it rendered.
        node.textContent = final;
      }
    };

    node.textContent = formatRef.current(0);
    frame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame);
      // Whatever interrupted us, the truth goes back in the DOM.
      node.textContent = final;
    };
  }, [value, durationMs, delayMs, reduced]);

  return ref;
}
