'use client';

/**
 * The live connection behind order tracking.
 *
 * ── WHAT IT GUARANTEES ──────────────────────────────────────────────────────
 *   · connects with the in-memory access token, evaluated fresh per attempt
 *   · re-subscribes to the order room on EVERY reconnect — a socket that comes
 *     back without rejoining the room is worse than one that stays down,
 *     because the banner says "live" and nothing ever arrives
 *   · exponential backoff with jitter, and an immediate retry when the tab
 *     becomes visible again
 *   · reports its own state honestly: `live` / `reconnecting` / `offline`,
 *     with "last seen 2m ago" whenever the newest data is not fresh
 *
 * ── HONESTY ABOUT STALENESS ─────────────────────────────────────────────────
 * This hook never fabricates a position, never extrapolates one, and never
 * holds the last one at full confidence. `lastEventAt` is exposed so the screen
 * can say exactly how old what you are looking at is. A tracking screen that
 * shows a confident scooter over a dead socket is lying to someone waiting at
 * a door.
 *
 * ── ROOMS ───────────────────────────────────────────────────────────────────
 * Subscription is `order:subscribe {orderId}` and the server verifies the order
 * against the DB before joining (plan §6.3). Changing the id in devtools gets
 * you a `forbidden`, which arrives here as a connect_error and is shown as
 * such — the client is not the authority and does not pretend to be.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SOCKET_URL } from '@/config/env';
import { getAccessToken } from '@/lib/api-client';
import { LiteSocket, type SocketPhase } from '@/lib/shop/socket-io-lite';
import { isDict } from '@/lib/shop/types';

/* ─────────────────────────── event payloads ─────────────────────────────── */
/* Shapes from plan §6.3. Read defensively: the gateway is being built in
   parallel, and a socket payload that does not match must not crash a render. */

export interface OrderStatusChanged {
  orderId: string;
  from: string | null;
  to: string;
  at: string;
  actorRole: string | null;
}

export interface DeliveryLocationUpdated {
  orderId: string;
  lat: number;
  lng: number;
  at: string;
  etaMinutes: number | null;
}

function readStatusChanged(payload: unknown): OrderStatusChanged | null {
  if (!isDict(payload)) return null;
  const to = payload['to'];
  const orderId = payload['orderId'];
  if (typeof to !== 'string' || typeof orderId !== 'string') return null;
  return {
    orderId,
    from: typeof payload['from'] === 'string' ? payload['from'] : null,
    to,
    at: typeof payload['at'] === 'string' ? payload['at'] : new Date().toISOString(),
    actorRole: typeof payload['actorRole'] === 'string' ? payload['actorRole'] : null,
  };
}

function readLocationUpdated(payload: unknown): DeliveryLocationUpdated | null {
  if (!isDict(payload)) return null;
  const lat = payload['lat'];
  const lng = payload['lng'];
  const orderId = payload['orderId'];
  if (typeof lat !== 'number' || typeof lng !== 'number' || typeof orderId !== 'string') {
    return null;
  }
  return {
    orderId,
    lat,
    lng,
    // `at` is the rider's clock, and it is the whole basis of the staleness
    // check. If the server omits it we fall back to arrival time and say so
    // nowhere — which is why the server SHOULD always send it.
    at: typeof payload['at'] === 'string' ? payload['at'] : new Date().toISOString(),
    etaMinutes: typeof payload['etaMinutes'] === 'number' ? payload['etaMinutes'] : null,
  };
}

/* ──────────────────────────────── hook ──────────────────────────────────── */

export type ConnectionState =
  | 'disabled' // nothing to subscribe to
  | 'signed-out' // no access token in memory yet
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'offline'; // the browser itself is offline

export interface UseSocketOptions {
  /** false → never opens a socket. Used for terminal orders. */
  enabled?: boolean;
  /** the room to join, re-joined on every reconnect */
  orderId?: string | null;
  onOrderStatus?: (payload: OrderStatusChanged) => void;
  onRiderLocation?: (payload: DeliveryLocationUpdated) => void;
  /** everything else — notification.created, payment.updated, order.accepted */
  onEvent?: (name: string, payload: unknown) => void;
}

export interface SocketConnection {
  state: ConnectionState;
  /** a server-supplied reason, when there is one */
  detail: string | null;
  /** epoch ms of the newest event of ANY kind */
  lastEventAt: number | null;
  lastConnectedAt: number | null;
  /** force an immediate reconnect attempt */
  reconnect: () => void;
}

export function useSocket(options: UseSocketOptions = {}): SocketConnection {
  const { enabled = true, orderId = null, onOrderStatus, onRiderLocation, onEvent } = options;

  const [state, setState] = useState<ConnectionState>('connecting');
  const [detail, setDetail] = useState<string | null>(null);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const [lastConnectedAt, setLastConnectedAt] = useState<number | null>(null);

  const socketRef = useRef<LiteSocket | null>(null);

  /* Handlers change identity every render; a ref keeps the socket from being
     torn down and rebuilt each time the parent re-renders. */
  const handlers = useRef({ onOrderStatus, onRiderLocation, onEvent });
  handlers.current = { onOrderStatus, onRiderLocation, onEvent };

  const orderIdRef = useRef(orderId);
  orderIdRef.current = orderId;

  const active = enabled && orderId !== null;

  useEffect(() => {
    if (!active) {
      setState('disabled');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState('offline');
    }

    let socket: LiteSocket | null = null;
    let tokenPoll: number | null = null;
    let disposed = false;

    const start = () => {
      if (disposed) return;
      socket = new LiteSocket({
        url: SOCKET_URL,
        // Fresh on every attempt — see the file header.
        auth: () => {
          const token = getAccessToken();
          return token === null ? {} : { token };
        },
        onPhase: (phase: SocketPhase, reason) => {
          if (disposed) return;
          setDetail(reason);
          if (phase === 'connected') {
            setState('live');
            setLastConnectedAt(Date.now());
            // ★ RE-SUBSCRIBE. This runs on the first connect AND on every
            //    reconnect, which is the entire point of doing it here rather
            //    than once after `connect()`.
            const id = orderIdRef.current;
            if (id !== null) socket?.emit('order:subscribe', { orderId: id });
          } else if (phase === 'connecting') {
            setState('connecting');
          } else if (phase === 'reconnecting') {
            setState(
              typeof navigator !== 'undefined' && navigator.onLine === false
                ? 'offline'
                : 'reconnecting',
            );
          }
        },
        onEvent: (name, payload) => {
          if (disposed) return;
          setLastEventAt(Date.now());

          if (name === 'order.status_changed') {
            const parsed = readStatusChanged(payload);
            if (parsed !== null) handlers.current.onOrderStatus?.(parsed);
            return;
          }
          if (name === 'delivery.location_updated') {
            const parsed = readLocationUpdated(payload);
            if (parsed !== null) handlers.current.onRiderLocation?.(parsed);
            return;
          }
          handlers.current.onEvent?.(name, payload);
        },
      });
      socketRef.current = socket;
      socket.connect();
    };

    /* The access token lives in memory and a reload starts with none: the
       session restore is in flight when this mounts. Connecting without it
       would hand the gateway an empty auth object and earn an instant
       disconnect, so wait — briefly, and visibly. */
    if (getAccessToken() === null) {
      setState('signed-out');
      let waited = 0;
      tokenPoll = window.setInterval(() => {
        waited += 400;
        if (getAccessToken() !== null) {
          if (tokenPoll !== null) window.clearInterval(tokenPoll);
          tokenPoll = null;
          start();
        } else if (waited >= 12_000) {
          if (tokenPoll !== null) window.clearInterval(tokenPoll);
          tokenPoll = null;
          // Give up gracefully; the page still renders everything it fetched.
          setDetail('Not signed in — live updates are paused.');
        }
      }, 400);
    } else {
      start();
    }

    /* A backgrounded tab gets its timers throttled and its socket quietly
       killed. Coming back should feel instant, not "wait for the next
       backoff tick". */
    const onVisible = () => {
      if (document.visibilityState === 'visible') socketRef.current?.retryNow();
    };
    const onOnline = () => {
      socketRef.current?.retryNow();
    };
    const onOffline = () => {
      setState('offline');
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      disposed = true;
      if (tokenPoll !== null) window.clearInterval(tokenPoll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      socket?.close();
      socketRef.current = null;
    };
  }, [active, orderId]);

  const reconnect = useCallback(() => {
    socketRef.current?.retryNow();
  }, []);

  return { state, detail, lastEventAt, lastConnectedAt, reconnect };
}
