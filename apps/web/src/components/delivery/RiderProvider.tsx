'use client';

/**
 * The rider's whole world, in one provider.
 *
 * The profile, availability, the offer queue, the live job, the socket and the
 * fixture flags all live here because every one of them is read by more than
 * one screen and they MUST agree. A shell that says "online" over a page that
 * says "offline" is the bug this exists to prevent.
 *
 * ── THE PROFILE IS THE SOURCE OF AVAILABILITY ───────────────────────────────
 * `GET /delivery/me` and `PATCH /delivery/availability` both return the WHOLE
 * `RiderProfile`, so this provider never has to assume what a toggle did. The
 * API refuses to take a rider carrying an order offline (409) and is never
 * "available" while held — reading the answer rather than the request is the
 * only way the toggle can be honest about that.
 *
 * It is also where today's deliveries and earnings come from (`profile.today`).
 * The earnings endpoint has no concept of "today"; it is a window statement.
 *
 * ── LIVE FIRST, FIXTURE ONLY WHEN THE NETWORK IS GONE ───────────────────────
 * A fixture stands in ONLY for `ApiError.isNetworkError` — the API genuinely
 * unreachable. A 400 or a 404 is a bug and is shown as an error; papering over
 * one with sample data is how a broken contract survives a review.
 *
 * `GET /delivery/orders/active` answering 200-with-no-body, or 404, both mean
 * "no job right now". `fetchActiveOrder` turns both into `null` and the screen
 * shows the calm waiting state. With the demo data wiped, that is the NORMAL
 * screen today, not a fault.
 *
 * ── OFFLINE CACHE ───────────────────────────────────────────────────────────
 * The live job is mirrored into `sessionStorage` so the app still shows the
 * current delivery when the network drops mid-ride. Deliberately
 * `sessionStorage`, not `localStorage`: the job carries a customer's name,
 * phone and address, and that should not outlive the tab. It is cleared the
 * moment the job ends. The OTP is never part of it — the app never holds one.
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
  fetchActiveOrder,
  fetchOffers,
  fetchProfile,
  normaliseActiveOrder,
  rejectOffer,
  setAvailability as patchAvailability,
  DELIVERY_PATHS,
} from '@/lib/delivery/api';
import { SAMPLE_ACTIVE_ORDER, sampleOffers } from '@/lib/delivery/fixtures';
import { getRiderSocket, type SocketState } from '@/lib/delivery/socket';
import { useNetworkOnline } from '@/lib/delivery/tracking';
import type { ActiveOrder, Offer, RiderProfile } from '@/lib/delivery/types';

const CACHE_KEY = 'mandi.rider.activeJob.v2';

/** Socket down ⇒ the offer queue is polled instead. Slow on purpose. */
const OFFER_POLL_MS = 15_000;
const JOB_POLL_MS = 20_000;

export interface RiderContextValue {
  /** null until `/delivery/me` answers, or when it failed. */
  profile: RiderProfile | null;
  /** true while the availability PATCH is in flight — the toggle locks. */
  availabilityPending: boolean;
  /** Resolves; rejects with a rider-readable Error the caller renders. */
  setOnline: (next: boolean) => Promise<void>;

  offers: Offer[];
  offersAreSample: boolean;

  activeOrder: ActiveOrder | null;
  jobIsSample: boolean;
  /** true when `activeOrder` came from the session cache, not the network. */
  jobFromCache: boolean;

  loading: boolean;
  connection: SocketState;
  networkOnline: boolean;

  /** Endpoints currently answering with fixtures — listed in the banner. */
  sampleEndpoints: string[];
  /** Set when a read failed with a STATUS. A bug, shown as one. */
  loadError: string | null;

  refresh: () => void;
  reconnect: () => void;
  accept: (offer: Offer) => Promise<'accepted' | 'gone' | 'failed'>;
  decline: (offer: Offer) => Promise<void>;
  /** Drop an offer locally when its countdown reaches zero. */
  expire: (assignmentId: string) => void;
  /** Push a fresh job in after a transition, without waiting for a poll. */
  setActiveOrder: (job: ActiveOrder | null) => void;
}

const RiderContext = createContext<RiderContextValue | null>(null);

/* ------------------------------------------------------------------ */
/* Session cache                                                       */
/* ------------------------------------------------------------------ */

function readCachedJob(): ActiveOrder | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    return normaliseActiveOrder(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeCachedJob(job: ActiveOrder | null): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    if (job === null) sessionStorage.removeItem(CACHE_KEY);
    else sessionStorage.setItem(CACHE_KEY, JSON.stringify(job));
  } catch {
    // Private mode, or a full quota. The app works without the cache; it just
    // shows an empty shell when offline instead of the job.
  }
}

/** Idempotency-Key. Riders double-tap; the API must not care. */
function idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isNetworkFailure(cause: unknown): boolean {
  return cause instanceof ApiError && cause.isNetworkError;
}

function describe(cause: unknown, endpoint: string): string {
  if (cause instanceof ApiError) return `${endpoint} · ${cause.status} · ${cause.friendlyMessage}`;
  return `${endpoint} · something went wrong`;
}

/* ------------------------------------------------------------------ */

export function RiderProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const networkOnline = useNetworkOnline();

  const [profile, setProfile] = useState<RiderProfile | null>(null);
  const [availabilityPending, setAvailabilityPending] = useState(false);

  const [offers, setOffers] = useState<Offer[]>([]);
  const [offersAreSample, setOffersAreSample] = useState(false);

  const [activeOrder, setActiveOrderState] = useState<ActiveOrder | null>(null);
  const [jobIsSample, setJobIsSample] = useState(false);
  const [jobFromCache, setJobFromCache] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [connection, setConnection] = useState<SocketState>({
    phase: 'idle',
    detail: null,
    attempts: 0,
  });

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Read inside the availability callback without making the profile a
  // dependency of it — a new identity on every poll would rebuild the toggle's
  // handler between a rider's finger going down and coming up.
  const profileRef = useRef<RiderProfile | null>(profile);
  profileRef.current = profile;

  const setActiveOrder = useCallback((job: ActiveOrder | null) => {
    setActiveOrderState(job);
    setJobIsSample(false);
    setJobFromCache(false);
    writeCachedJob(job);
  }, []);

  /* ---- hydrate from the session cache before the first fetch lands ---- */
  useEffect(() => {
    const cached = readCachedJob();
    if (cached !== null) {
      setActiveOrderState(cached);
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
      const [profileResult, jobResult, offersResult] = await Promise.allSettled([
        fetchProfile(controller.signal),
        fetchActiveOrder(controller.signal),
        fetchOffers(controller.signal),
      ]);
      if (!live) return;

      const problems: string[] = [];

      if (profileResult.status === 'fulfilled') {
        setProfile(profileResult.value);
      } else if (!isNetworkFailure(profileResult.reason)) {
        problems.push(describe(profileResult.reason, DELIVERY_PATHS.me));
      }

      if (jobResult.status === 'fulfilled') {
        // `null` is a real answer: no job right now. It is NOT a failure and
        // must never raise the sample banner.
        setActiveOrderState(jobResult.value);
        setJobIsSample(false);
        setJobFromCache(false);
        writeCachedJob(jobResult.value);
      } else if (isNetworkFailure(jobResult.reason)) {
        const cached = readCachedJob();
        if (cached !== null) {
          setActiveOrderState(cached);
          setJobFromCache(true);
          setJobIsSample(false);
        } else {
          setActiveOrderState(SAMPLE_ACTIVE_ORDER);
          setJobIsSample(true);
          setJobFromCache(false);
        }
      } else {
        problems.push(describe(jobResult.reason, DELIVERY_PATHS.activeOrder));
      }

      if (offersResult.status === 'fulfilled') {
        setOffers(offersResult.value);
        setOffersAreSample(false);
      } else if (isNetworkFailure(offersResult.reason)) {
        setOffers(sampleOffers());
        setOffersAreSample(true);
      } else {
        setOffers([]);
        setOffersAreSample(false);
        problems.push(describe(offersResult.reason, DELIVERY_PATHS.offers));
      }

      setLoadError(problems.length === 0 ? null : problems.join(' · '));
      setLoading(false);
    })();

    return () => {
      live = false;
      controller.abort();
    };
  }, [isAuthenticated, nonce]);

  /* ---- socket -------------------------------------------------------- */

  useEffect(() => {
    if (!isAuthenticated) return;
    const socket = getRiderSocket();
    const offState = socket.onState(setConnection);

    // `delivery.assigned` is a DOORBELL, not data. The gateway sends a label
    // and a coordinate per waypoint and nothing else — no address, no item
    // count, no COD — so building an offer card from it would render a job
    // with three blanks on it. Re-read the offers instead; it is one small
    // request and it is the only thing that can fill the card.
    const offAssigned = socket.on('delivery.assigned', () => {
      refresh();
    });

    const offStatus = socket.on('order.status_changed', () => {
      // The event carries from/to, but the rider's own job has far more on it
      // (items, OTP attempts) than the event does. Re-read rather than patch a
      // status onto a stale object.
      refresh();
    });

    socket.start();
    return () => {
      offState();
      offAssigned();
      offStatus();
      // Left RUNNING on unmount: navigating between rider screens must not
      // tear down the connection an offer is about to arrive on. `stop()` is
      // called when the rider goes offline.
    };
  }, [isAuthenticated, refresh]);

  /* ---- join the order room for the live job --------------------------- */

  const liveOrderId = jobIsSample ? null : (activeOrder?.orderId ?? null);

  useEffect(() => {
    if (!isAuthenticated || liveOrderId === null) return;
    const socket = getRiderSocket();
    socket.subscribeOrder(liveOrderId);
    return () => socket.unsubscribeOrder(liveOrderId);
  }, [isAuthenticated, liveOrderId]);

  /* ---- polling, because the socket may not be up yet ------------------ */

  const isOnline = profile?.isOnline ?? false;
  const hasJob = activeOrder !== null;

  useEffect(() => {
    if (!isAuthenticated) return;
    if (connection.phase === 'live') return;
    if (!isOnline && !hasJob) return;

    const id = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') refresh();
      },
      hasJob ? JOB_POLL_MS : OFFER_POLL_MS,
    );
    return () => window.clearInterval(id);
  }, [isAuthenticated, connection.phase, isOnline, hasJob, refresh]);

  /* ---- availability --------------------------------------------------- */

  const setOnline = useCallback(async (next: boolean) => {
    setAvailabilityPending(true);
    const previous = profileRef.current;
    // Optimistic: the toggle is the rider's single most important control and
    // it must feel instant. Rolled back on failure, never left lying.
    if (previous !== null) {
      setProfile({ ...previous, isOnline: next, isAvailable: next });
    }
    try {
      // The API answers with the real profile — including refusing to mark a
      // held rider available. Trust that over what we asked for.
      const updated = await patchAvailability({ isOnline: next, isAvailable: next });
      if (updated !== null) setProfile(updated);
      if (next) getRiderSocket().start();
      else getRiderSocket().stop();
    } catch (cause) {
      setProfile(previous);
      if (cause instanceof ApiError && cause.status === 409) {
        // The one refusal a rider needs spelled out: you are carrying a job.
        throw new Error(
          'You are carrying a delivery. Finish it or report a problem before going offline.',
        );
      }
      throw new Error(
        next
          ? 'Could not go online. Check your connection and try again.'
          : 'Could not go offline. You may still receive offers.',
      );
    } finally {
      setAvailabilityPending(false);
    }
  }, []);

  /* ---- offer actions -------------------------------------------------- */

  const expire = useCallback((assignmentId: string) => {
    setOffers((prev) => prev.filter((offer) => offer.id !== assignmentId));
  }, []);

  const accept = useCallback(
    async (offer: Offer): Promise<'accepted' | 'gone' | 'failed'> => {
      try {
        // Accept answers with the full active order — the job just taken.
        const job = await acceptOffer(offer.id, idempotencyKey());
        expire(offer.id);
        if (job !== null) setActiveOrder(job);
        refresh();
        return 'accepted';
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          (cause.status === 409 || cause.status === 410 || cause.status === 404)
        ) {
          // Someone else took it, or it timed out server-side. Not an error
          // the rider did anything about — say so and move on.
          expire(offer.id);
          return 'gone';
        }
        return 'failed';
      }
    },
    [expire, refresh, setActiveOrder],
  );

  const decline = useCallback(
    async (offer: Offer) => {
      // The card goes immediately either way: a rider who tapped Decline is
      // already looking away, and the assignment engine re-offers it to the
      // next partner regardless of whether our POST lands.
      expire(offer.id);
      try {
        // Reject answers with the remaining offers — take them verbatim.
        const remaining = await rejectOffer(offer.id, idempotencyKey());
        setOffers(remaining);
        setOffersAreSample(false);
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
      profile,
      availabilityPending,
      setOnline,
      offers,
      offersAreSample,
      activeOrder,
      jobIsSample,
      jobFromCache,
      loading,
      connection,
      networkOnline,
      sampleEndpoints,
      loadError,
      refresh,
      reconnect,
      accept,
      decline,
      expire,
      setActiveOrder,
    }),
    [
      profile,
      availabilityPending,
      setOnline,
      offers,
      offersAreSample,
      activeOrder,
      jobIsSample,
      jobFromCache,
      loading,
      connection,
      networkOnline,
      sampleEndpoints,
      loadError,
      refresh,
      reconnect,
      accept,
      decline,
      expire,
      setActiveOrder,
    ],
  );

  return <RiderContext.Provider value={value}>{children}</RiderContext.Provider>;
}

export function useRider(): RiderContextValue {
  const ctx = useContext(RiderContext);
  if (ctx === null) throw new Error('useRider must be used inside <RiderProvider>');
  return ctx;
}
