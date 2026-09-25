'use client';

/**
 * The one way an admin screen writes.
 *
 * Approve a vendor, cancel an order, suspend an admin. Everything a button in
 * this console does goes through here, so four things are true in one place:
 *
 *   1. the in-memory access token is attached (never a stored one);
 *   2. an RFC 7807 problem becomes a typed `ApiError` the UI can read;
 *   3. a successful write INVALIDATES the queries it affected, so the list the
 *      user is looking at is correct a moment later without a manual refetch;
 *   4. `loading` is real, so a <ConfirmDialog> can stay open and disabled
 *      rather than closing optimistically over a request that then fails.
 *
 * ── PATH PARAMS ─────────────────────────────────────────────────────────────
 * The path is declared once with placeholders and filled in per call:
 *
 *   const approve = useAdminMutation<{ status: string }, Vendor>(
 *     '/admin/vendors/:id/status', 'PATCH',
 *   );
 *   await approve.mutate({ status: 'approved' }, { params: { id } });
 *
 * That keeps one hook instance for a whole table instead of one per row.
 *
 * ── THIS IS NOT AUTHORISATION ───────────────────────────────────────────────
 * Hiding a destructive button from a plain ADMIN is a courtesy. The API's
 * RolesGuard is what actually stops the request (plan §4.2). Anyone can call
 * these endpoints with curl.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiFetch } from '@/lib/api-client';
import { invalidateAdmin } from './useAdminQuery';

export type AdminMutationMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface AdminMutateOptions<TRes> {
  /** values substituted into `:name` placeholders in the path */
  params?: Record<string, string>;
  /** query-string values, for endpoints that take one on a write */
  query?: Record<string, string | number | boolean>;
  /** required by checkout/payment; harmless and useful on any retryable write */
  idempotencyKey?: string;
  /** path prefixes to refetch on success — defaults to the mutation's own base */
  invalidate?: readonly string[];
  onSuccess?: (result: TRes) => void;
  onError?: (error: ApiError) => void;
}

export interface AdminMutationResult<TBody, TRes> {
  /** resolves with the response, or `null` when the request failed */
  mutate: (body?: TBody, options?: AdminMutateOptions<TRes>) => Promise<TRes | null>;
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
      throw new Error(`useAdminMutation: missing path param ":${key}" for ${template}`);
    }
    return encodeURIComponent(value);
  });
}

/**
 * `/admin/vendors/:id/status` -> `/admin/vendors`. The default invalidation
 * target: the collection the mutated resource belongs to.
 */
function defaultInvalidation(template: string): string {
  const segments = template.split('/').filter(Boolean);
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(':')) break;
    out.push(segment);
  }
  return `/${out.join('/')}`;
}

export function useAdminMutation<TBody, TRes>(
  path: string,
  method: AdminMutationMethod,
): AdminMutationResult<TBody, TRes> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [data, setData] = useState<TRes | null>(null);

  // A component can unmount while a DELETE is in flight (the row it lived in
  // disappears). Setting state after that is a React warning and a memory leak.
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
    async (body?: TBody, options: AdminMutateOptions<TRes> = {}): Promise<TRes | null> => {
      setLoading(true);
      setError(null);

      const url = fillPath(path, options.params);

      try {
        // apiFetch rather than the `api.post/patch/...` sugar: one call site for
        // four verbs, with no union gymnastics over which of them takes a body.
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

        invalidateAdmin(options.invalidate ?? [defaultInvalidation(path)]);
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
