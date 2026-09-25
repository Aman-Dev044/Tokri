'use client';

/**
 * "Last updated 4s ago" — and whether that is still true.
 *
 * ── WHY A LIVE SCREEN NEEDS THIS ────────────────────────────────────────────
 * A polling board that silently stops polling looks exactly like a quiet
 * evening. The operator keeps reading a frozen page and makes decisions on it.
 * That is the single worst failure mode an ops console has, and it is invisible
 * unless the page says out loud how old what you are looking at is.
 *
 * So every live surface here shows its own age, and goes STALE — visibly, with
 * a word, not just a colour — once the age passes what the poll interval makes
 * plausible.
 *
 * ── HYDRATION ───────────────────────────────────────────────────────────────
 * `Date.now()` on the server is not `Date.now()` in the browser. Nothing here
 * reads the clock during render: `updatedAt` starts `null` and is set in an
 * effect, and callers render a neutral dash for that one frame.
 */

import { useEffect, useState } from 'react';

export interface Freshness {
  /** epoch ms of the last settle, or `null` before the first one */
  updatedAt: number | null;
  /** whole seconds since then, or `null` before the first settle */
  secondsAgo: number | null;
  /** the data is older than the poll interval can explain */
  stale: boolean;
  /** false while the tab is in the background — polling is paused, by design */
  visible: boolean;
}

/**
 * @param marker  a value whose IDENTITY changes on every successful fetch.
 *                Pass the response object itself: `useAdminQuery` replaces it
 *                on each settle, so a new reference means new data arrived.
 *                `null`/`undefined` is treated as "nothing yet".
 * @param staleAfterMs  how long before the data is called stale. Give it room
 *                      for one missed poll plus a slow request — roughly
 *                      `2.5 × refreshMs`.
 */
export function useFreshness(marker: unknown, staleAfterMs: number): Freshness {
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);

  // A new `marker` reference is the signal that a fetch landed.
  useEffect(() => {
    if (marker === null || marker === undefined) return;
    const at = Date.now();
    setUpdatedAt(at);
    setNow(at);
  }, [marker]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    // One second is the finest granularity this ever shows. It runs while the
    // tab is hidden too — deliberately, so the age is already correct (and
    // already reads "stale") the moment someone switches back.
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const age = updatedAt === null || now === null ? null : Math.max(0, now - updatedAt);

  return {
    updatedAt,
    secondsAgo: age === null ? null : Math.floor(age / 1000),
    // A backgrounded tab is not stale data, it is paused polling, and the two
    // want different words on screen.
    stale: age !== null && visible && age > staleAfterMs,
    visible,
  };
}
