'use client';

/**
 * ★ THE NEW-ORDER WATCH.
 *
 * One poll, shared by the whole panel. It lives above the shell so the top bar,
 * the rail badge and the orders board all read the SAME answer — two
 * independent polls is how a badge ends up saying 3 over a board showing 4.
 *
 * ── WHAT COUNTS AS "NEW" ────────────────────────────────────────────────────
 * An order id this session has not seen before, in the `PLACED` list. The first
 * settle SEEDS the seen-set without alerting: opening the panel to four
 * unaccepted orders and getting four chimes at once is how a vendor turns the
 * sound off permanently in the first minute.
 *
 * ── THE ALERT PULSES ONCE, THEN HOLDS ───────────────────────────────────────
 * `freshIds` marks the cards that just arrived. The CSS pulse runs a single
 * time; the flag itself expires after 90 seconds so that an order nobody
 * acknowledged stops claiming to be new while still sitting there, ageing, in
 * the New lane where it belongs. A permanently pulsing screen is unusable on an
 * eight-hour shift.
 *
 * ── WHEN THE API IS NOT THERE ───────────────────────────────────────────────
 * On a genuine NETWORK failure — and only then — `useVendorQuery` falls back
 * to a labelled fixture, so this provider reports a fixture-backed pending
 * count. `isFixture` travels with it and every screen that shows the number
 * also shows the amber banner. The chime is suppressed for fixture data: a
 * sample order must never make a real sound in a real shop.
 *
 * A 4xx is NOT a fixture case. If this query starts failing with a 400 the
 * badge goes to zero and stays there, which is the correct and visible
 * behaviour for a broken request — a fabricated count over a broken poll would
 * have a vendor watching a number that cannot change.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useVendorQuery } from '@/hooks';
import { playNewOrderChime, readSoundPreference, writeSoundPreference } from '@/lib/vendor/alert';
import type { Paged, VendorOrder } from '@/lib/vendor/types';

/** The board's live-ish cadence. Fast enough to matter, slow enough to be free. */
export const ORDER_POLL_MS = 15_000;

/** How long a card keeps its "just arrived" mark. */
const FRESH_MS = 90_000;

export interface VendorAlertState {
  /** unaccepted orders, oldest first */
  pending: VendorOrder[];
  pendingCount: number;
  /** ids that arrived during this session and are still marked new */
  freshIds: ReadonlySet<string>;
  /** clear the banner and the fresh marks */
  acknowledge: () => void;
  soundOn: boolean;
  toggleSound: () => void;
  /** true when the browser refused to play — the banner then says so */
  soundBlocked: boolean;
  isFixture: boolean;
  /** identity changes on every successful poll — feed to `useFreshness` */
  marker: object | null;
  loading: boolean;
}

const FALLBACK: VendorAlertState = {
  pending: [],
  pendingCount: 0,
  freshIds: new Set<string>(),
  acknowledge: () => undefined,
  soundOn: false,
  toggleSound: () => undefined,
  soundBlocked: false,
  isFixture: false,
  marker: null,
  loading: true,
};

const VendorAlertContext = createContext<VendorAlertState | null>(null);

export function VendorAlertProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  /** off until the session is known — polling with no token is 401 noise */
  enabled?: boolean;
}) {
  // `status` is a single enum value — exactly what this poll needs. `sort` is
  // checked against the service's own allowlist, and `placedAt` is on it.
  const query = useVendorQuery<Paged<VendorOrder>>(
    '/vendor/orders',
    { status: 'PLACED', limit: 50, sort: 'placedAt' },
    { refreshMs: ORDER_POLL_MS, enabled },
  );

  const [soundOn, setSoundOn] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set<string>());

  const seen = useRef<Set<string> | null>(null);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  /* ---- the stored preference ---- */
  useEffect(() => {
    setSoundOn(readSoundPreference());
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((previous) => {
      const next = !previous;
      writeSoundPreference(next);
      if (next) {
        // The toggle IS the user gesture that unlocks audio. Playing the chime
        // here doubles as a confirmation that it actually works on this device.
        const ok = playNewOrderChime();
        setSoundBlocked(!ok);
      } else {
        setSoundBlocked(false);
      }
      return next;
    });
  }, []);

  /* ---- arrival detection ---- */
  const rows = useMemo(() => query.data?.data ?? [], [query.data]);
  const isFixture = query.isFixture;

  useEffect(() => {
    if (query.loading && seen.current === null) return;
    if (query.data === null) return;

    const ids = rows.map((order) => order.id);

    if (seen.current === null) {
      // First settle: remember what was already here, alert on none of it.
      seen.current = new Set(ids);
      return;
    }

    const arrived = ids.filter((id) => !seen.current?.has(id));
    for (const id of ids) seen.current.add(id);
    if (arrived.length === 0) return;

    setFreshIds((previous) => {
      const next = new Set(previous);
      for (const id of arrived) next.add(id);
      return next;
    });

    // Sample data must never make a real sound in a real shop.
    if (soundRef.current && !isFixture) {
      const ok = playNewOrderChime();
      setSoundBlocked(!ok);
    }
  }, [rows, query.data, query.loading, isFixture]);

  /* ---- fresh marks expire ---- */
  useEffect(() => {
    if (freshIds.size === 0) return;
    const id = window.setTimeout(() => setFreshIds(new Set<string>()), FRESH_MS);
    return () => window.clearTimeout(id);
  }, [freshIds]);

  const acknowledge = useCallback(() => setFreshIds(new Set<string>()), []);

  const value = useMemo<VendorAlertState>(
    () => ({
      pending: rows,
      pendingCount: query.data?.meta.total ?? rows.length,
      freshIds,
      acknowledge,
      soundOn,
      toggleSound,
      soundBlocked,
      isFixture,
      marker: query.marker,
      loading: query.loading && !query.hasLoadedOnce,
    }),
    [
      rows,
      query.data,
      query.marker,
      query.loading,
      query.hasLoadedOnce,
      freshIds,
      acknowledge,
      soundOn,
      toggleSound,
      soundBlocked,
      isFixture,
    ],
  );

  return <VendorAlertContext.Provider value={value}>{children}</VendorAlertContext.Provider>;
}

export function useVendorAlerts(): VendorAlertState {
  return useContext(VendorAlertContext) ?? FALLBACK;
}
