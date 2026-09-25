'use client';

/**
 * "Now", but only after hydration.
 *
 * Anything derived from the clock — is this coupon live, has this window
 * closed — differs between the server render and the first client render, and
 * React treats that as a hydration mismatch. So the clock is read in an effect
 * and `null` is returned until then; callers render a neutral placeholder for
 * that one frame rather than guessing.
 *
 * `tickMs` re-reads the clock on an interval for the handful of places where a
 * page left open should not quietly go stale. Zero (the default) reads once.
 */

import { useEffect, useState } from 'react';

export function useNow(tickMs = 0): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (tickMs <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);

  return now;
}

/** Today as `YYYY-MM-DD`, in the viewer's own timezone. */
export function isoDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
