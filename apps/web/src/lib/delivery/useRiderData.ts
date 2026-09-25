'use client';

/**
 * History and earnings — live endpoint first, LABELLED fixture second.
 *
 * Same contract as everywhere else on this surface: the hook calls the real
 * path, and when it fails it returns sample rows AND flips `isSample`, which
 * the page turns into a banner. There is no third option where a number
 * appears without a provenance.
 *
 * Neither endpoint is in plan §6.2's DELIVERY block yet (see the note on
 * `DELIVERY_PATHS`), so today both of these are expected to 404 and both
 * screens are expected to show the banner. That is the honest state of the
 * build, not a bug to paper over.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchEarnings, fetchHistory, DELIVERY_PATHS } from './api';
import { SAMPLE_EARNINGS, SAMPLE_HISTORY } from './fixtures';
import type { EarningsSummary, HistoryEntry } from './types';

export interface Sourced<T> {
  value: T;
  loading: boolean;
  /** true ⇒ `value` is a fixture and MUST be shown behind a banner. */
  isSample: boolean;
  /** The path that failed, for the banner's small print. */
  endpoint: string;
  refetch: () => void;
}

function useSourced<T>(
  endpoint: string,
  load: (signal: AbortSignal) => Promise<T>,
  fixture: T,
): Sourced<T> {
  const [value, setValue] = useState<T>(fixture);
  const [loading, setLoading] = useState(true);
  const [isSample, setIsSample] = useState(false);
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
      } catch {
        if (!live || controller.signal.aborted) return;
        setValue(fixture);
        setIsSample(true);
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
    // `load` and `fixture` are module-stable per call site; re-running on their
    // identity would refetch on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  return { value, loading, isSample, endpoint, refetch };
}

export function useRiderHistory(): Sourced<HistoryEntry[]> {
  return useSourced(DELIVERY_PATHS.history, fetchHistory, SAMPLE_HISTORY);
}

export function useRiderEarnings(): Sourced<EarningsSummary> {
  return useSourced(DELIVERY_PATHS.earnings, fetchEarnings, SAMPLE_EARNINGS);
}
