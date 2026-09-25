'use client';

import { useEffect, useState } from 'react';

/**
 * Trails `value` by `ms`, resetting the timer on every change.
 *
 * Used on every search box in the console: the input stays instant (controlled
 * by its own state, so typing never feels laggy) while the value that reaches
 * `useAdminQuery` settles. Without it, "Ganesh" is six requests, five of which
 * are already stale by the time they land.
 *
 * The cleanup is the whole hook. Leaving the previous timeout alive is how a
 * debounce quietly becomes a throttle-then-burst.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    if (ms <= 0) {
      setDebounced(value);
      return;
    }
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);

  return debounced;
}
