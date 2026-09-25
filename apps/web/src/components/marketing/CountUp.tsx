'use client';

import { useEffect, useState } from 'react';

/**
 * A figure that counts up once, on mount.
 *
 * ── WHY IT STARTS AT THE FINAL VALUE ────────────────────────────────────────
 * State is seeded with the target, not with zero. That is what the server
 * renders, what a crawler reads and what someone with JavaScript disabled
 * keeps — the page is correct and readable at rest, and the animation is an
 * enhancement layered on top of a finished number rather than the only way to
 * ever see it. The effect drops it to zero and climbs back, which costs one
 * frame and buys an honest no-JS fallback.
 *
 * Tabular figures come from the caller's `.mk-num` / mono class: without them
 * the digits change width as they climb and the whole tile jitters.
 */

export interface CountUpProps {
  /** the real figure — never a made-up one */
  to: number;
  /** turns the running value into what is shown (currency, padding, units) */
  format?: (value: number) => string;
  durationMs?: number;
  className?: string;
}

export function CountUp({ to, format, durationMs = 1200, className }: CountUpProps) {
  const [value, setValue] = useState(to);

  useEffect(() => {
    // Someone who asked for less motion gets the figure, instantly.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(to);
      return;
    }

    let frame = 0;
    const started = performance.now();

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      // Cubic ease-out: fast off the mark, settles rather than stops dead.
      setValue(to * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame = window.requestAnimationFrame(tick);
    };

    setValue(0);
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [to, durationMs]);

  const render = format ?? ((n: number) => String(Math.round(n)));

  return <span className={className}>{render(value)}</span>;
}
