'use client';

/**
 * The one way a vendor screen reads data.
 *
 * Deliberately a sibling of `useAdminQuery` rather than a wrapper around it:
 * the two surfaces have separate fixture catalogues and separate invalidation
 * buses, and sharing a bus would mean an inventory adjustment on `/vendor`
 * refetching half the admin console in a tab that happens to be open.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *   · GETs through `api-client`, so the Authorization header comes from the
 *     in-memory access token and never from storage (plan §4.3).
 *   · Aborts the in-flight request when params change or the component
 *     unmounts — a fast-typing product search cannot land results out of order.
 *   · Re-runs when `invalidateVendor()` fires for a matching path prefix.
 *   · Polls on `refreshMs`, PAUSED while the tab is hidden. The orders board
 *     runs at 15s; a backgrounded shop hammering the API helps nobody.
 *   · On failure, falls back to a LABELLED fixture.
 *
 * ── THE FIXTURE FALLBACK, AND WHY IT IS HONEST ──────────────────────────────
 * Worker A's `/vendor/*` endpoints land in parallel with this panel. Without a
 * fallback every screen would be an error state. When a request fails and
 * `resolveFixture` knows the path, this returns sample data with
 * `isFixture: true` — and that flag is not advisory: `<VendorPage>` renders the
 * amber "sample data" banner whenever any query on the page reports it, and
 * every KPI tile stamps itself. A fixture number must never be readable as a
 * real one.
 *
 * If there is no fixture for the path the real error surfaces instead, so a
 * missing endpoint looks like a missing endpoint.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { resolveFixture, type QueryParams } from '@/lib/vendor/fixtures';

/* ------------------------------------------------------------------ */
/* Invalidation bus                                                    */
/* ------------------------------------------------------------------ */

type Listener = (prefix: string) => void;
const listeners = new Set<Listener>();

/** Tell every live vendor query whose path starts with one of these to refetch. */
export function invalidateVendor(prefixes: string | readonly string[]): void {
  const list = typeof prefixes === 'string' ? [prefixes] : prefixes;
  for (const prefix of list) {
    for (const listener of listeners) listener(prefix);
  }
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export interface VendorQueryOptions {
  /** skip the request entirely — for a detail query with no id yet */
  enabled?: boolean;
  /** poll interval in ms; paused while the tab is hidden */
  refreshMs?: number;
}

export interface VendorQueryResult<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** true when `data` came from `lib/vendor/fixtures` and is NOT real */
  isFixture: boolean;
  /** true after the first settle — lets a board keep its cards while refetching */
  hasLoadedOnce: boolean;
  /**
   * Identity changes on every successful settle. Feed it to `useFreshness` to
   * get the "updated 4s ago / STALE" line every live screen here shows.
   */
  marker: object | null;
  refetch: () => void;
}

export function useVendorQuery<T>(
  path: string,
  params?: QueryParams,
  options: VendorQueryOptions = {},
): VendorQueryResult<T> {
  const { enabled = true, refreshMs } = options;

  // Params arrive as a fresh object literal on every render. Serialising gives
  // the effect a primitive dependency, so the request fires when the VALUES
  // change rather than on every parent re-render.
  const paramsKey = useMemo(() => JSON.stringify(params ?? {}), [params]);
  const stableParams = useMemo(() => (params ?? {}) as QueryParams, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [isFixture, setIsFixture] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [marker, setMarker] = useState<object | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let live = true;

    setLoading(true);

    void (async () => {
      try {
        const result = await api.get<T>(path, {
          query: stableParams,
          signal: controller.signal,
        });
        if (!live) return;
        setData(result);
        setError(null);
        setIsFixture(false);
        setMarker({});
      } catch (cause) {
        if (!live || controller.signal.aborted) return;

        const apiError =
          cause instanceof ApiError ? cause : new ApiError('Unexpected failure', 0, {}, true);

        const fixture = resolveFixture(path, stableParams);
        if (fixture !== null) {
          setData(fixture as T);
          setError(null);
          setIsFixture(true);
          setMarker({});
        } else {
          setData(null);
          setError(apiError);
          setIsFixture(false);
        }
      } finally {
        if (live) {
          setLoading(false);
          setHasLoadedOnce(true);
        }
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [path, stableParams, enabled, nonce]);

  /* ---- invalidation ---- */
  useEffect(() => {
    if (!enabled) return;
    const listener: Listener = (prefix) => {
      if (path.startsWith(prefix)) refetch();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [path, enabled, refetch]);

  /* ---- polling, paused while the tab is hidden ---- */
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!enabled || !refreshMs || refreshMs <= 0) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refetchRef.current();
    }, refreshMs);
    return () => window.clearInterval(id);
  }, [enabled, refreshMs]);

  return { data, error, loading, isFixture, hasLoadedOnce, marker, refetch };
}
