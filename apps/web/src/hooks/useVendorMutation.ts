'use client';

/**
 * The one way a vendor screen writes.
 *
 * Accept an order, reject it, adjust stock, open the shop. Every button in this
 * panel goes through here, so four things are true in one place:
 *
 *   1. the in-memory access token is attached (never a stored one);
 *   2. an RFC 7807 problem becomes a typed `ApiError` the UI can read;
 *   3. a successful write INVALIDATES the queries it affected, so the board is
 *      correct a moment later without a manual refetch;
 *   4. `loading` is real, so a <ConfirmDialog> can stay open and disabled over
 *      a request that might still fail.
 *
 * ── PATH PARAMS ─────────────────────────────────────────────────────────────
 *   const accept = useVendorMutation<{ etaMinutes?: number }, VendorOrder>(
 *     '/vendor/orders/:id/accept', 'PATCH',
 *   );
 *   await accept.mutate({ etaMinutes: 25 }, { params: { id } });
 *
 * One hook instance serves a whole board instead of one per card.
 *
 * ── THIS IS NOT AUTHORISATION ───────────────────────────────────────────────
 * Hiding a button is a courtesy. `RolesGuard` + `VendorScopeGuard` (plan §4.2)
 * are what stop the request, and they run whether or not this file did
 * anything. A vendor cannot reach another vendor's order by editing an id in
 * the URL, because the server checks — not because this hook does.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { invalidateVendor } from './useVendorQuery';

export type VendorMutationMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface VendorMutateOptions<TRes> {
  /** values substituted into `:name` placeholders in the path */
  params?: Record<string, string>;
  /** query-string values, for endpoints that take one on a write */
  query?: Record<string, string | number | boolean>;
  /** harmless and useful on any retryable write (plan §6.1) */
  idempotencyKey?: string;
  /** path prefixes to refetch on success — defaults to the mutation's own base */
  invalidate?: readonly string[];
  onSuccess?: (result: TRes) => void;
  onError?: (error: ApiError) => void;
}

export interface VendorMutationResult<TBody, TRes> {
  /** resolves with the response, or `null` when the request failed */
  mutate: (body?: TBody, options?: VendorMutateOptions<TRes>) => Promise<TRes | null>;
  loading: boolean;
  error: ApiError | null;
  data: TRes | null;
  reset: () => void;
}

function fillPath(template: string, params: Record<string, string> | undefined): string {
  if (!params) return template;
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`useVendorMutation: missing path param ":${key}" for ${template}`);
    }
    return encodeURIComponent(value);
  });
}

/** `/vendor/orders/:id/accept` -> `/vendor/orders`. */
function defaultInvalidation(template: string): string {
  const segments = template.split('/').filter(Boolean);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(':')) break;
    out.push(segment);
  }
  return `/${out.join('/')}`;
}

export function useVendorMutation<TBody, TRes>(
  path: string,
  method: VendorMutationMethod,
): VendorMutationResult<TBody, TRes> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<TRes | null>(null);

  // A card can unmount while its PATCH is in flight — accepting an order moves
  // it out of the New lane. Setting state after that is a leak and a warning.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setData(null);
    setLoading(false);
  }, []);

  const mutate = useCallback(
    async (body?: TBody, options: VendorMutateOptions<TRes> = {}): Promise<TRes | null> => {
      setLoading(true);
      setError(null);

      const url = fillPath(path, options.params);

      try {
        const result = await apiFetch<TRes>(url, {
          method,
          body: method === 'DELETE' ? undefined : body,
          query: options.query,
          idempotencyKey: options.idempotencyKey,
        });

        if (mounted.current) {
          setData(result);
          setLoading(false);
        }

        invalidateVendor(options.invalidate ?? [defaultInvalidation(path)]);
        options.onSuccess?.(result);
        return result;
      } catch (cause) {
        const apiError =
          cause instanceof ApiError ? cause : new ApiError('Unexpected failure', 0, {}, true);
        if (mounted.current) {
          setError(apiError);
          setLoading(false);
        }
        options.onError?.(apiError);
        return null;
      }
    },
    [path, method],
  );

  return { mutate, loading, error, data, reset };
}
