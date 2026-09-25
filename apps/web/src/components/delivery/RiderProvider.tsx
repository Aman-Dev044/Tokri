'use client';

/**
 * The rider's whole world, in one provider.
 *
 * Availability, the offer queue, the live job, the socket and the fixture
 * flags all live here because every one of them is read by more than one
 * screen and they MUST agree. A shell that says "online" over a page that says
 * "offline" is the bug this exists to prevent.
 *
 * ── LIVE FIRST, FIXTURE SECOND, NEVER SILENT ────────────────────────────────
 * Every read calls the real endpoint from `lib/delivery/api.ts`. When one
 * fails, a clearly-labelled fixture stands in AND `isSample` flips, which puts
 * `<FixtureBanner>` on screen. A rider must never be able to mistake sample
 * data for a real job: the fixture addresses literally start with "SAMPLE
 * DATA" for the case where a screenshot outlives the banner.
 *
 * Writes NEVER fall back. Accepting a sample offer does nothing but tell the
 * rider the API is unreachable.
 *
 * ── OFFLINE CACHE ───────────────────────────────────────────────────────────
 * The live job is mirrored into `sessionStorage` so the app still shows the
 * current delivery when the network drops mid-ride (that is the point of the
 * service worker shell). Deliberately `sessionStorage`, not `localStorage`:
 * the job carries a customer's name, phone and address, and that should not
 * outlive the tab. It is cleared the moment the job ends. The OTP is never
 * part of it — the app never holds an OTP at all.
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
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  acceptOffer,
  fetchActiveJob,
  fetchOffers,
  normaliseActiveJob,
  normaliseOffer,
  rejectOffer,
  setAvailability as patchAvailability,
  DELIVERY_PATHS,
} from '@/lib/delivery/api';
import { SAMPLE_ACTIVE_JOB, sampleOffers } from '@/lib/delivery/fixtures';
import { getRiderSocket, type SocketState } from '@/lib/delivery/socket';
import { useNetworkOnline } from '@/lib/delivery/tracking';
import type { ActiveJob, Availability, Offer } from '@/lib/delivery/types';

const CACHE_KEY = 'mandi.rider.activeJob.v1';

/** Socket down ⇒ the offer queue is polled instead. Slow on purpose. */
const OFFER_POLL_MS = 15_000;
const JOB_POLL_MS = 20_000;

export interface RiderContextValue {
  availability: Availability;
  /** true while the availability PATCH is in flight — the toggle locks. */
  availabilityPending: boolean;
  setOnline: (next: boolean) => Promise<void>;

  offers: Offer[];
  offersAreSample: boolean;

  activeJob: ActiveJob | null;
  jobIsSample: boolean;
  /** true when `activeJob` came from the session cache, not the network. */
  jobFromCache: boolean;

  loading: boolean;
  connection: SocketState;
  networkOnline: boolean;

  /** Endpoints currently answering with fixtures — listed in the banner. */
  sampleEndpoints: string[];

  refresh: () => void;
  reconnect: () => void;
  accept: (offer: Offer) => Promise<'accepted' | 'gone' | 'failed'>;
  decline: (offer: Offer) => Promise<void>;
  /** Drop an offer locally when its countdown reaches zero. */
  expire: (assignmentId: string) => void;
  /** Push a fresh job in after a transition, without waiting for a poll. */
  setActiveJob: (job: ActiveJob | null) => void;
}

const RiderContext = createContext<RiderContextValue | null>(null);

/* ------------------------------------------------------------------ */
/* Session cache                                                       */
/* ------------------------------------------------------------------ */

function readCachedJob(): ActiveJob | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    return normaliseActiveJob(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedJob(job: ActiveJob | null): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (job === null) sessionStorage.removeItem(CACHE_KEY);
    else sessionStorage.setItem(CACHE_KEY, JSON.stringify(job));
  } catch {
    // Private mode, or a full quota. The app works without the cache; it just
    // shows an empty shell when offline instead of the job.
  }
}

/** Idempotency-Key (plan §6.1). Riders double-tap; the API must not care. */
function idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ */

export function RiderProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const networkOnline = useNetworkOnline();

  const [availability, setAvailabilityState] = useState<Availability>({
    isOnline: false,
    isAvailable: false,
  });
  const [availabilityPending, setAvailabilityPending] = useState(false);

  const [offers, setOffers] = useState<Offer[]>([]);
  const [offersAreSample, setOffersAreSample] = useState(false);

  const [activeJob, setActiveJobState] = useState<ActiveJob | null>(null);
  const [jobIsSample, setJobIsSample] = useState(false);
  const [jobFromCache, setJobFromCache] = useState(false);

  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [connection, setConnection] = useState<SocketState>({
    phase: 'idle',
    detail: null,
    attempts: 0,
  });

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Read inside the socket handler without making it a dependency — a handler
  // that re-subscribes every time the flag flips would miss the offer arriving
  // in between.
  const offersAreSampleRef = useRef(offersAreSample);
  offersAreSampleRef.current = offersAreSample;

  const setActiveJob = useCallback((job: ActiveJob | null) => {
    setActiveJobState(job);
    setJobIsSample(false);
    setJobFromCache(false);
    writeCachedJob(job);
  }, []);

  /* ---- hydrate from the session cache before the first fetch lands ---- */
  useEffect(() => {
    const cached = readCachedJob();
    if (cached !== null) {
      setActiveJobState(cached);
      setJobFromCache(true);
    }
  }, []);

  /* ---- reads --------------------------------------------------------- */

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let live = true;
    setLoading(true);

    void (async () => {
      const results = await Promise.allSettled([
        fetchActiveJob(controller.signal),
        fetchOffers(controller.signal),
      ]);
      if (!live) return;

      const [jobResult, offersResult] = results;

      if (jobResult.status === 'fulfilled') {
        setActiveJobState(jobResult.value);
        setJobIsSample(false);
        setJobFromCache(false);
        writeCachedJob(jobResult.value);
      } else if (!(jobResult.reason instanceof ApiError && jobResult.reason.status === 404)) {
        // A 404 on the ACTIVE endpoint is a legitimate "no job", not a missing
        // API — so it must not raise the sample banner. Anything else does.
        const cached = readCachedJob();
        if (cached !== null) {
          setActiveJobState(cached);
          setJobFromCache(true);
          setJobIsSample(false);
        } else {
          setActiveJobState(SAMPLE_ACTIVE_JOB);
          setJobIsSample(true);
          setJobFromCache(false);
        }
      } else {
        setActiveJobState(null);
        setJobIsSample(false);
        setJobFromCache(false);
        writeCachedJob(null);
      }

      if (offersResult.status === 'fulfilled') {
        setOffers(offersResult.value);
        setOffersAreSample(false);
      } else {
        setOffers(sampleOffers());
        setOffersAreSample(true);
      }

      setLoading(false);
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [isAuthenticated, nonce]);

  /* ---- socket (plan §6.3) -------------------------------------------- */

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getRiderSocket();
    const offState = socket.onState(setConnection);

    const offAssigned = socket.on('delivery.assigned', (payload) => {
      const offer = normaliseOffer(payload);
      if (offer === null) return;
      // A live offer replaces any fixture instantly — the banner drops with it.
      setOffers((prev) => {
        const withoutSamples = offersAreSampleRef.current ? [] : prev;
        const deduped = withoutSamples.filter(
          (o) => o.assignmentId !== offer.assignmentId,
        );
        return [offer, ...deduped];
      });
      setOffersAreSample(false);
    });

    const offStatus = socket.on('order.status_changed', () => {
      // The payload carries from/to, but the rider's own job has more on it
      // (items, attempts remaining) than the event does. Re-read rather than
      // patch a status onto a stale object.
      refresh();
    });

    socket.start();
    return () => {
      offState();
      offAssigned();
      offStatus();
      // Left RUNNING on unmount: navigating between rider screens must not
      // tear down the connection an offer is about to arrive on. `stop()` is
      // called by the shell when the rider goes offline.
    };
  }, [isAuthenticated, refresh]);

  /* ---- join the order room for the live job --------------------------- */

  useEffect(() => {
    if (!isAuthenticated || activeJob === null || jobIsSample) return;
    const socket = getRiderSocket();
    socket.subscribeOrder(activeJob.orderId);
    const orderId = activeJob.orderId;
    return () => socket.unsubscribeOrder(orderId);
  }, [isAuthenticated, activeJob, jobIsSample]);

  /* ---- polling, because the socket may not be up yet ------------------ */

  useEffect(() => {
    if (!isAuthenticated) return;
    if (connection.phase === 'live') return;
    if (!availability.isOnline && activeJob === null) return;

    const id = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') refresh();
      },
      activeJob === null ? OFFER_POLL_MS : JOB_POLL_MS,
    );
    return () => window.clearInterval(id);
  }, [isAuthenticated, connection.phase, availability.isOnline, activeJob, refresh]);

  /* ---- availability --------------------------------------------------- */

  const setOnline = useCallback(async (next: boolean) => {
    setAvailabilityPending(true);
    // Optimistic: the toggle is the rider's single most important control and
    // it must feel instant. Rolled back on failure, never left lying.
    const previous = availability;
    const optimistic: Availability = { isOnline: next, isAvailable: next };
    setAvailabilityState(optimistic);
    try {
      await patchAvailability(optimistic);
      if (next) getRiderSocket().start();
      else getRiderSocket().stop();
    } catch {
      setAvailabilityState(previous);
      throw new Error(
        next
          ? 'Could not go online. Check your connection and try again.'
          : 'Could not go offline. You may still receive offers.',
      );
    } finally {
      setAvailabilityPending(false);
    }
  }, [availability]);

  /* ---- offer actions -------------------------------------------------- */

  const expire = useCallback((assignmentId: string) => {
    setOffers((prev) => prev.filter((o) => o.assignmentId !== assignmentId));
  }, []);

  const accept = useCallback(
    async (offer: Offer): Promise<'accepted' | 'gone' | 'failed'> => {
      try {
        await acceptOffer(offer.assignmentId, idempotencyKey());
        expire(offer.assignmentId);
        refresh();
        return 'accepted';
      } catch (cause) {
        if (cause instanceof ApiError && (cause.status === 409 || cause.status === 410)) {
          // Someone else took it, or it timed out server-side. Not an error the
          // rider did anything about — say so and move on.
          expire(offer.assignmentId);
          return 'gone';
        }
        return 'failed';
      }
    },
    [expire, refresh],
  );

  const decline = useCallback(
    async (offer: Offer) => {
      // The card goes immediately either way: a rider who tapped Decline is
      // already looking away, and the assignment engine re-offers it to the
      // next partner regardless of whether our POST lands.
      expire(offer.assignmentId);
      try {
        await rejectOffer(offer.assignmentId, idempotencyKey());
      } catch {
        // Nothing to tell the rider. The 45s TTL expires it server-side.
      }
    },
    [expire],
  );

  const reconnect = useCallback(() => {
    getRiderSocket().retryNow();
    refresh();
  }, [refresh]);

  const sampleEndpoints = useMemo(() => {
    const list: string[] = [];
    if (offersAreSample) list.push(DELIVERY_PATHS.offers);
    if (jobIsSample) list.push(DELIVERY_PATHS.activeOrder);
    return list;
  }, [offersAreSample, jobIsSample]);

  const value = useMemo<RiderContextValue>(
    () => ({
      availability,
      availabilityPending,
      setOnline,
      offers,
      offersAreSample,
      activeJob,
      jobIsSample,
      jobFromCache,
      loading,
      connection,
      networkOnline,
      sampleEndpoints,
      refresh,
      reconnect,
      accept,
      decline,
      expire,
      setActiveJob,
    }),
    [
      availability,
      availabilityPending,
      setOnline,
      offers,
      offersAreSample,
      activeJob,
      jobIsSample,
      jobFromCache,
      loading,
      connection,
      networkOnline,
      sampleEndpoints,
      refresh,
      reconnect,
      accept,
      decline,
      expire,
      setActiveJob,
    ],
  );

  return <RiderContext.Provider value={value}>{children}</RiderContext.Provider>;
}

export function useRider(): RiderContextValue {
  const ctx = useContext(RiderContext);
  if (ctx === null) throw new Error('useRider must be used inside <RiderProvider>');
  return ctx;
}
