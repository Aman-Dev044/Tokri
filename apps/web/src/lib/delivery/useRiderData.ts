'use client';

/**
 * History and earnings — live endpoint first, error second, fixture last.
 *
 * ── THE THREE OUTCOMES, KEPT APART ──────────────────────────────────────────
 * The earlier version of this hook had two: "it worked" and "show samples".
 * That collapsed a 404 on a wrong path into the same state as a rider in a
 * basement, and the resulting banner made a broken URL look like a known
 * limitation for as long as anyone cared to ignore it.
 *
 *   ok       the API answered. Render it, even when it is empty — an empty
 *            history is the correct screen for a rider who has not ridden yet.
 *   error    the API answered with a status. That is a BUG or a real refusal;
 *            it is shown as an error with the status on it, never as data.
 *   sample   the API could not be reached at all (`isNetworkError`). Only
 *            here does a fixture appear, and always behind its banner.
 *
 * Both endpoints are live and verified: `GET /delivery/history?page&limit` and
 * `GET /delivery/earnings`. Neither is expected to fail today.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { fetchEarnings, fetchHistory, DELIVERY_PATHS } from './api';
import { SAMPLE_EARNINGS, SAMPLE_HISTORY } from './fixtures';
import type { DeliveryHistoryRow, EarningsSummary } from './types';

export interface Sourced<T> {
  value: T;
  loading: boolean;
  /** true ⇒ `value` is a fixture and MUST be shown behind a banner. */
  isSample: boolean;
  /** Set when the API answered with a status. Shown to the rider verbatim. */
  error: string | null;
  /** The path involved, for the banner's small print. */
  endpoint: string;
  refetch: () => void;
}

function useSourced<T>(
  endpoint: string,
  load: (signal: AbortSignal) => Promise<T>,
  empty: T,
  fixture: T,
): Sourced<T> {
  const [value, setValue] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [isSample, setIsSample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true);

    void (async () => {
      try {
        const result = await load(controller.signal);
        if (!live) return;
        setValue(result);
        setIsSample(false);
        setError(null);
      } catch (cause) {
        if (!live || controller.signal.aborted) return;
        const networkDown = cause instanceof ApiError && cause.isNetworkError;
        if (networkDown) {
          setValue(fixture);
          setIsSample(true);
          setError(null);
        } else {
          // A status came back. Keep the empty shape so nothing downstream
          // reads a field off a fixture it did not ask for, and say what
          // happened instead of inventing rows.
          setValue(empty);
          setIsSample(false);
          setError(
            cause instanceof ApiError
              ? `${cause.status} · ${cause.friendlyMessage}`
              : 'Something went wrong loading this.',
          );
        }
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
    // `load`, `empty` and `fixture` are module-stable per call site; re-running
    // on their identity would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  return { value, loading, isSample, error, endpoint, refetch };
}

const NO_HISTORY: DeliveryHistoryRow[] = [];

const NO_EARNINGS: EarningsSummary = {
  from: '',
  to: '',
  deliveries: 0,
  payoutPaise: 0,
  codCollectedPaise: 0,
  byDay: [],
};

export function useRiderHistory(): Sourced<DeliveryHistoryRow[]> {
  return useSourced(DELIVERY_PATHS.history, fetchHistory, NO_HISTORY, SAMPLE_HISTORY);
}

export function useRiderEarnings(): Sourced<EarningsSummary> {
  return useSourced(DELIVERY_PATHS.earnings, fetchEarnings, NO_EARNINGS, SAMPLE_EARNINGS);
}
