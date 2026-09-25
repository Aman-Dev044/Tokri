'use client';

/**
 * Location tracking and the screen wake lock — and an honest account of what
 * a browser will and will not do (plan §8.7, challenge #16).
 *
 * ── THE RULES, NON-NEGOTIABLE ───────────────────────────────────────────────
 * 1. Tracking runs ONLY while the order is `OUT_FOR_DELIVERY`. Not while
 *    riding to the store, not while online and idle, never in the background
 *    of a rider's own time. `active` goes false ⇒ the watch is cleared in the
 *    same tick. Following a rider who is not on a delivery is surveillance,
 *    and it is also a battery and a bandwidth bill.
 * 2. One POST every 10 seconds (§6.2), never per fix. `watchPosition` fires as
 *    often as the GPS feels like it; a POST per fix would be dozens a minute.
 * 3. Fixes BATCH between flushes. A rider through an underpass comes back with
 *    several queued fixes, and the route shape is worth more than the newest
 *    point alone.
 * 4. The UI is told when the last fix left the DEVICE, and says so — "sent 40s
 *    ago" — instead of drawing a live dot over a stale position.
 *
 * ── WHAT A BROWSER PWA GENUINELY CANNOT DO ──────────────────────────────────
 *   · No background location. Once the phone is locked or the tab is
 *     backgrounded, the OS suspends timers and geolocation within seconds to
 *     minutes. Nothing in this file can change that; it can only NOTICE it and
 *     tell the rider. The wake lock buys a screen that stays on, not a process
 *     that stays alive.
 *   · No guaranteed delivery of a queued fix. There is no background sync here
 *     and a killed tab loses its queue.
 *   · No reliable push while closed.
 *
 * A native shell (React Native) fixes all three, and the backend does not
 * change when it arrives: same REST, same sockets.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { postLocation, type LocationFix } from './api';

/** Plan §6.2: "← every 10s". */
const FLUSH_MS = 10_000;

/**
 * If no fix arrives for this long while tracking is on, the browser has almost
 * certainly throttled or suspended us. Say so plainly.
 */
const STALE_FIX_MS = 45_000;

/** Never send an unbounded backlog after a long tunnel. */
const MAX_QUEUE = 20;

export type TrackingPermission = 'unknown' | 'granted' | 'denied' | 'prompt';

export interface TrackingState {
  /** false ⇒ this device has no geolocation at all. */
  supported: boolean;
  /** true ⇒ the watch is running right now. */
  running: boolean;
  permission: TrackingPermission;
  /** epoch ms of the newest fix the DEVICE produced. */
  lastFixAt: number | null;
  /** epoch ms of the last fix successfully accepted by the API. */
  lastSentAt: number | null;
  /** Fixes waiting for the next flush. */
  queued: number;
  /**
   * true when fixes have stopped arriving while tracking is on — the browser
   * has suspended us. This is surfaced to the rider verbatim.
   */
  suspended: boolean;
  /** Human-readable problem, or null. */
  error: string | null;
}

const IDLE_STATE: TrackingState = {
  supported: true,
  running: false,
  permission: 'unknown',
  lastFixAt: null,
  lastSentAt: null,
  queued: 0,
  suspended: false,
  error: null,
};

function messageFor(code: number): string {
  switch (code) {
    case 1:
      return 'Location permission is off. Turn it on in your browser settings — the customer cannot see you without it.';
    case 2:
      return 'No GPS signal right now.';
    case 3:
      return 'Location is taking too long.';
    default:
      return 'Location is not working.';
  }
}

/**
 * Start / stop location tracking for one order.
 *
 * `active` must be `status === 'OUT_FOR_DELIVERY'` and nothing else.
 */
export function useLocationTracking(active: boolean): TrackingState {
  const [state, setState] = useState<TrackingState>(IDLE_STATE);

  // Refs, not state: a fix arriving every second must not re-render the tree.
  const queue = useRef<LocationFix[]>([]);
  const watchId = useRef<number | null>(null);
  const flushTimer = useRef<number | null>(null);
  const sending = useRef(false);

  const patch = useCallback((next: Partial<TrackingState>) => {
    setState((prev) => ({ ...prev, ...next }));
  }, []);

  const flush = useCallback(async () => {
    if (sending.current) return;
    const batch = queue.current;
    if (batch.length === 0) return;

    sending.current = true;
    // Take the queue optimistically; on failure the fixes go back in front of
    // whatever arrived while the request was in flight.
    queue.current = [];
    try {
      await postLocation(batch);
      const newest = batch[batch.length - 1];
      patch({
        lastSentAt: newest === undefined ? null : Date.parse(newest.at),
        queued: queue.current.length,
        error: null,
      });
    } catch {
      const merged = [...batch, ...queue.current].slice(-MAX_QUEUE);
      queue.current = merged;
      patch({
        queued: merged.length,
        // Not an alarm: a failed ping on a moving scooter is ordinary. The
        // rider sees the stale "sent Ns ago" badge, which is the honest signal.
        error: null,
      });
    } finally {
      sending.current = false;
    }
  }, [patch]);

  useEffect(() => {
    if (!active) {
      // RULE 1. Everything stops, immediately, in this same tick.
      if (watchId.current !== null && typeof navigator !== 'undefined') {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
      if (flushTimer.current !== null) {
        window.clearInterval(flushTimer.current);
        flushTimer.current = null;
      }
      queue.current = [];
      setState(IDLE_STATE);
      return;
    }

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState({ ...IDLE_STATE, supported: false, error: 'This device cannot share its location.' });
      return;
    }

    patch({ running: true, supported: true, error: null });

    // `permissions` is not universal; a missing answer stays 'unknown' rather
    // than being guessed into 'granted'.
    if ('permissions' in navigator) {
      void navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          const value = status.state;
          patch({
            permission:
              value === 'granted' ? 'granted' : value === 'denied' ? 'denied' : 'prompt',
          });
        })
        .catch(() => {
          /* leave it 'unknown' */
        });
    }

    const id = navigator.geolocation.watchPosition(
      (position) => {
        const fix: LocationFix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          at: new Date(position.timestamp).toISOString(),
          ...(Number.isFinite(position.coords.accuracy)
            ? { accuracy: Math.round(position.coords.accuracy) }
            : {}),
        };
        const next = [...queue.current, fix].slice(-MAX_QUEUE);
        queue.current = next;
        patch({
          lastFixAt: position.timestamp,
          queued: next.length,
          suspended: false,
          permission: 'granted',
          error: null,
        });
      },
      (err) => {
        patch({
          permission: err.code === 1 ? 'denied' : 'prompt',
          error: messageFor(err.code),
        });
      },
      {
        enableHighAccuracy: true,
        // Never hand back a fix older than the flush window — a cached
        // position from five minutes ago is worse than no position.
        maximumAge: 8_000,
        timeout: 20_000,
      },
    );
    watchId.current = id;

    flushTimer.current = window.setInterval(() => {
      void flush();
    }, FLUSH_MS);

    return () => {
      navigator.geolocation.clearWatch(id);
      watchId.current = null;
      if (flushTimer.current !== null) {
        window.clearInterval(flushTimer.current);
        flushTimer.current = null;
      }
    };
  }, [active, flush, patch]);

  /* Suspension detector — the honest bit (plan §8.7 #16). */
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setState((prev) => {
        if (!prev.running) return prev;
        const reference = prev.lastFixAt;
        const stale = reference !== null && Date.now() - reference > STALE_FIX_MS;
        return stale === prev.suspended ? prev : { ...prev, suspended: stale };
      });
    }, 5_000);
    return () => window.clearInterval(id);
  }, [active]);

  return state;
}

/* ------------------------------------------------------------------ */
/* Wake lock                                                           */
/* ------------------------------------------------------------------ */

/**
 * Minimal shape of the Screen Wake Lock API.
 *
 * Declared locally and feature-detected because it is absent on iOS Safari
 * before 16.4 and on every desktop Firefox to date. `navigator.wakeLock` is
 * therefore read through a cast rather than assumed onto the global type — an
 * assumption that would compile fine and throw on a real rider's phone.
 */
interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { wakeLock?: WakeLockLike };
  return nav.wakeLock ?? null;
}

export interface WakeLockState {
  supported: boolean;
  held: boolean;
}

/**
 * Hold the screen awake while a job is active.
 *
 * A rider puts the phone in a mount and looks at it every thirty seconds; a
 * screen that sleeps between glances means a re-unlock at every turn. The lock
 * is dropped the moment the job ends, and re-acquired when the tab becomes
 * visible again — the browser releases it on every tab switch, by design.
 *
 * This keeps the SCREEN on. It does not keep the app running in the
 * background, and nothing in a browser can.
 */
export function useWakeLock(active: boolean): WakeLockState {
  const [state, setState] = useState<WakeLockState>({ supported: true, held: false });
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const api = wakeLockApi();
    if (api === null) {
      setState({ supported: false, held: false });
      return;
    }
    if (!active) {
      setState({ supported: true, held: false });
      return;
    }

    let cancelled = false;

    const acquire = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      void api
        .request('screen')
        .then((lock) => {
          if (cancelled) {
            void lock.release();
            return;
          }
          sentinel.current = lock;
          setState({ supported: true, held: true });
          lock.addEventListener('release', () => {
            if (!cancelled) setState({ supported: true, held: false });
          });
        })
        .catch(() => {
          // Denied, or the document is not visible. Not worth a message: the
          // screen timing out is a nuisance, not a failure of the delivery.
          setState({ supported: true, held: false });
        });
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      const lock = sentinel.current;
      sentinel.current = null;
      if (lock !== null && !lock.released) void lock.release();
    };
  }, [active]);

  return state;
}

/* ------------------------------------------------------------------ */
/* Online / offline                                                    */
/* ------------------------------------------------------------------ */

/**
 * `navigator.onLine` — true does NOT mean the API is reachable, only that the
 * OS thinks there is a network. It is used here for the one thing it is good
 * at: telling a rider in a basement that the phone itself knows it is offline.
 */
export function useNetworkOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const read = () => setOnline(navigator.onLine);
    read();
    window.addEventListener('online', read);
    window.addEventListener('offline', read);
    return () => {
      window.removeEventListener('online', read);
      window.removeEventListener('offline', read);
    };
  }, []);

  return online;
}

/** A 1Hz clock for the "sent 40s ago" badges and the offer countdown. */
export function useTicker(active: boolean, intervalMs = 1_000): number {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  return now;
}
