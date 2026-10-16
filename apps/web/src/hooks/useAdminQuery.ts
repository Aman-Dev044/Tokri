'use client';

/**
 * The one way an admin screen reads data.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *   · GETs through `api-client`, so the Authorization header comes from the
 *     in-memory access token and never from storage (plan §4.3).
 *   · Aborts the in-flight request when the params change or the component
 *     unmounts, so a fast-typing search box cannot land its results out of
 *     order (the classic "stale response overwrites fresh" bug).
 *   · Re-runs when `invalidateAdmin()` fires for a matching path prefix, which
 *     is how a mutation refreshes the list it just changed.
 *   · On a NETWORK failure, falls back to a LABELLED fixture — see below.
 *
 * ── THE FIXTURE FALLBACK, AND WHERE ITS LINE IS ──────────────────────
 * This console was built while its endpoints were still landing, so without
 * a fallback every screen would have been an error state and none of it
 * reviewable. When the API is UNREACHABLE and `resolveFixture` knows the
 * path, the hook returns sample data with `isFixture: true`.
 *
 * It stands in for an API that did not answer, NEVER for one that answered
 * with a refusal. A 4xx or 5xx is a bug in the request this hook just made,
 * and painting a plausible marketplace over it hides the one thing that
 * needs fixing — which is exactly what happened to the SUPER_ADMIN overview
 * for weeks.
 *
 * `isFixture` is not advisory. `<AdminPage>` renders an amber "sample data —
 * API not reachable" banner whenever any query on the page reports it, and the
 * KPI tiles mark themselves too. A fixture number must never be readable as a
 * real one.
 *
 * If there is no fixture for the path, the real error is surfaced instead. A
 * missing fixture has to look like a missing endpoint.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { resolveFixture, type QueryParams } from '@/lib/admin/fixtures';

/* ------------------------------------------------------------------ */
/* Invalidation bus                                                    */
/* ------------------------------------------------------------------ */

type Listener = (prefix: string) => void;
const listeners = new Set<Listener>();

/**
 * Tell every live query whose path starts with one of these prefixes to refetch.
 * Called by `useAdminMutation` after a successful write.
 */
export function invalidateAdmin(prefixes: string | readonly string[]): void {
  const list = typeof prefixes === 'string' ? [prefixes] : prefixes;
  for (const prefix of list) {
    for (const listener of listeners) listener(prefix);
  }
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export interface AdminQueryOptions {
  /** skip the request entirely — for a detail query with no id yet */
  enabled?: boolean;
  /**
   * Poll interval in ms. Used by the orders board for its "live-ish" refresh.
   * Polling pauses while the tab is hidden; a backgrounded console hammering
   * the API for nobody's benefit is just cost.
   */
  refreshMs?: number;
}

export interface AdminQueryResult<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** true when `data` came from `lib/admin/fixtures` and is NOT real */
  isFixture: boolean;
  /** true after the first settle — lets a table keep old rows while refetching */
  hasLoadedOnce: boolean;
  refetch: () => void;
}

export function useAdminQuery<T>(
  path: string,
  params?: QueryParams,
  options: AdminQueryOptions = {},
): AdminQueryResult<T> {
  const { enabled = true, refreshMs } = options;

  // Params arrive as a fresh object literal on every render. Serialising them
  // gives the effect a primitive dependency, so the request fires when the
  // VALUES change rather than on every parent re-render.
  const paramsKey = useMemo(() => JSON.stringify(params ?? {}), [params]);
  const stableParams = useMemo(() => (params ?? {}) as QueryParams, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [isFixture, setIsFixture] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
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
      } catch (cause) {
        if (!live || controller.signal.aborted) return;

        const apiError =
          cause instanceof ApiError
            ? cause
            : new ApiError('Unexpected failure', 0, {}, true);

        // ONLY a genuine network failure earns sample data. A 4xx or 5xx is
        // the API answering — a refusal, not an absence — and standing a
        // plausible marketplace over it hides the very thing that needs
        // fixing. `useVendorQuery` and `useShopQuery` have always drawn this
        // line; this hook did not, and that is precisely how the SUPER_ADMIN
        // overview shipped sending `?days=30` to a DTO that takes
        // `?from=&to=`: all six requests 400'd forever, the fixture answered
        // every one of them, and the console displayed a complete invented
        // marketplace — crores of GMV, thousands of orders — behind an amber
        // banner nobody reads twice on a dashboard that looks correct.
        //
        // Every admin fixture stands in for an endpoint that genuinely
        // exists, so nothing legitimately depends on the old behaviour.
        const fixture = apiError.isNetworkError
          ? resolveFixture(path, stableParams)
          : null;
        if (fixture !== null) {
          // Sample data. `isFixture` forces the amber banner; see the file
          // header. Never let this path go quiet.
          setData(fixture as T);
          setError(null);
          setIsFixture(true);
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

  return { data, error, loading, isFixture, hasLoadedOnce, refetch };
}
