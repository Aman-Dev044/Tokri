'use client';

/**
 * The one way a shop screen reads data.
 *
 * Sibling of `useAdminQuery`, with three differences that matter on the
 * customer surface:
 *
 *   1. `read` is REQUIRED. Every response passes through a reader from
 *      `lib/shop/types`, so a field the API renames degrades to a known-empty
 *      value instead of throwing inside a render.
 *   2. `anonymous` — the browse endpoints (`/stores`, `/products/:id`) are
 *      public (plan §4.2) and must work with no session at all. Sending a
 *      stale Authorization header to a public route just invites a 401 on a
 *      page that should have rendered.
 *   3. The fixture fallback comes from `lib/shop/fixtures` and is always
 *      surfaced through `isFixture`, which every screen turns into a visible
 *      banner. Sample data is never presented as real.
 *
 * ── ★ WHEN THE FIXTURE IS ALLOWED TO FIRE ───────────────────────────────────
 * ONLY on a genuine network failure — `ApiError.isNetworkError`: the API is
 * down, unreachable, CORS-blocked, or timed out. Nothing else.
 *
 * It used to fire on ANY thrown error, which quietly papered over the two
 * failures that matter most. The API runs `forbidNonWhitelisted: true`, so an
 * unknown query parameter is a hard 400 — a bug in THIS app, which a banner
 * full of sample tomatoes hides instead of reporting. And a 404 on a path means
 * the endpoint does not exist, which must look like a missing endpoint. Both
 * now surface as a real `ApiError` and a readable error state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api-client';
import { resolveShopFixture, type QueryParams } from '@/lib/shop/fixtures';

/* ------------------------------------------------------------------ */
/* Invalidation bus                                                    */
/* ------------------------------------------------------------------ */

type Listener = (prefix: string) => void;
const listeners = new Set<Listener>();

/** Refetch every live query whose path starts with one of these prefixes. */
export function invalidateShop(prefixes: string | readonly string[]): void {
  const list = typeof prefixes === 'string' ? [prefixes] : prefixes;
  for (const prefix of list) {
    for (const listener of listeners) listener(prefix);
  }
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export interface ShopQueryOptions<T> {
  /** turns `unknown` into the view model — required, on purpose */
  read: (raw: unknown) => T;
  /** skip the request entirely; for a detail query with no id yet */
  enabled?: boolean;
  /** do not send the Authorization header (public browse endpoints) */
  anonymous?: boolean;
  /** poll interval in ms; pauses while the tab is hidden */
  refreshMs?: number;
}

export interface ShopQueryResult<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** true when `data` came from `lib/shop/fixtures` and is NOT real */
  isFixture: boolean;
  hasLoadedOnce: boolean;
  refetch: () => void;
}

export function useShopQuery<T>(
  path: string | null,
  params: QueryParams | undefined,
  options: ShopQueryOptions<T>,
): ShopQueryResult<T> {
  const { read, enabled = true, anonymous = false, refreshMs } = options;

  const active = enabled && path !== null;

  // Params arrive as a fresh literal every render; serialising them gives the
  // effect a primitive dependency, so the request fires when the VALUES change.
  const paramsKey = useMemo(() => JSON.stringify(params ?? {}), [params]);
  const stableParams = useMemo(() => (params ?? {}) as QueryParams, [paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The reader is usually an inline arrow. Holding it in a ref keeps it out of
  // the effect's dependency list without pinning the first render's closure.
  const readRef = useRef(read);
  readRef.current = read;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(active);
  const [isFixture, setIsFixture] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!active || path === null) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let live = true;
    setLoading(true);

    void (async () => {
      try {
        const raw = await api.get<unknown>(path, {
          query: stableParams,
          anonymous,
          signal: controller.signal,
        });
        if (!live) return;
        setData(readRef.current(raw));
        setError(null);
        setIsFixture(false);
      } catch (cause) {
        if (!live || controller.signal.aborted) return;

        const apiError =
          cause instanceof ApiError ? cause : new ApiError('Unexpected failure', 0, {}, true);

        // ★ See the header: a fixture stands in for an UNREACHABLE API, never
        //   for one that answered with a refusal.
        const fixture = apiError.isNetworkError
          ? resolveShopFixture(path, stableParams)
          : null;

        if (fixture !== null) {
          setData(readRef.current(fixture));
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
  }, [path, stableParams, active, anonymous, nonce]);

  /* ---- invalidation ---- */
  useEffect(() => {
    if (!active || path === null) return;
    const listener: Listener = (prefix) => {
      if (path.startsWith(prefix)) refetch();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [path, active, refetch]);

  /* ---- polling, paused while the tab is hidden ---- */
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!active || !refreshMs || refreshMs <= 0) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refetchRef.current();
    }, refreshMs);
    return () => {
      window.clearInterval(id);
    };
  }, [active, refreshMs]);

  return { data, error, loading, isFixture, hasLoadedOnce, refetch };
}
