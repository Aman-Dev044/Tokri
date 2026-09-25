/**
 * Realtime for the rider surface (plan §6.3).
 *
 * ── WHY THIS IS HAND-ROLLED, AND WHEN TO DELETE IT ──────────────────────────
 * `socket.io-client` is NOT a dependency of `@mandi/web`. Adding one while six
 * workers share a lockfile is how a build breaks for everybody at once, so
 * this file speaks the Socket.IO v4 protocol directly over the browser's own
 * `WebSocket`. It implements exactly the subset this app needs:
 *
 *   engine.io   OPEN (`0{…}`) · PING (`2`) → PONG (`3`) · CLOSE (`1`)
 *   socket.io   CONNECT (`40{auth}`) · CONNECT_ERROR (`44{…}`) · EVENT (`42[…]`)
 *
 * It deliberately does NOT implement: HTTP long-polling fallback, binary
 * attachments, ACKs, multiple namespaces, or the `41` disconnect packet's
 * finer semantics. If any of those become necessary, add `socket.io-client`
 * and delete this file — `RiderSocket`'s public surface is small on purpose so
 * that swap is a one-file change.
 *
 * ── WHAT IT GUARANTEES ──────────────────────────────────────────────────────
 *   · the JWT rides in the CONNECT packet, exactly where `io(url, { auth })`
 *     puts it, so the gateway's `handleConnection` check is unchanged
 *   · reconnect with exponential backoff + jitter, capped, never a tight loop
 *   · every room subscription is REPLAYED on reconnect — a rider who rode
 *     through a tunnel mid-delivery must not come back deaf to their own order
 *   · rooms are still assigned by the SERVER (§6.3). `order:subscribe` is a
 *     request the gateway verifies against the DB; changing an id here gets
 *     you a `WsException`, not another rider's order.
 *
 * Nothing in this file is security. The gateway disconnects an invalid token.
 */

import { SOCKET_URL } from '@/config/env';
import { getAccessToken } from '@/lib/api-client';

export type SocketPhase = 'idle' | 'connecting' | 'live' | 'retrying' | 'failed';

export interface SocketState {
  phase: SocketPhase;
  /** Populated on a failure the rider might be able to act on. */
  detail: string | null;
  /** How many consecutive attempts have failed. Resets on a live connection. */
  attempts: number;
}

type EventHandler = (payload: unknown) => void;
type StateHandler = (state: SocketState) => void;

/* engine.io packet type prefixes */
const ENGINE_OPEN = '0';
const ENGINE_CLOSE = '1';
const ENGINE_PING = '2';
const ENGINE_PONG = '3';
const ENGINE_MESSAGE = '4';

/* socket.io packet type suffixes (after the engine `4`) */
const SIO_CONNECT = '0';
const SIO_EVENT = '2';
const SIO_CONNECT_ERROR = '4';

const BASE_DELAY_MS = 800;
const MAX_DELAY_MS = 30_000;

function endpoint(): string {
  const base = SOCKET_URL.endsWith('/') ? SOCKET_URL.slice(0, -1) : SOCKET_URL;
  const ws = base.replace(/^http/, 'ws');
  return `${ws}/socket.io/?EIO=4&transport=websocket`;
}

/**
 * Exponential backoff with full jitter. Without the jitter, every rider whose
 * connection dropped when the gateway restarted reconnects in the same
 * millisecond and knocks it over again.
 */
function delayFor(attempt: number): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(attempt, 6));
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

export class RiderSocket {
  private ws: WebSocket | null = null;
  private timer: number | null = null;
  private pingTimeout: number | null = null;
  private attempts = 0;
  private stopped = true;
  private state: SocketState = { phase: 'idle', detail: null, attempts: 0 };

  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly stateHandlers = new Set<StateHandler>();
  /** Order ids to re-subscribe to after every reconnect. */
  private readonly rooms = new Set<string>();

  /* -------------------------------------------------------------- */
  /* Public surface                                                  */
  /* -------------------------------------------------------------- */

  getState(): SocketState {
    return this.state;
  }

  onState(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  on(event: string, handler: EventHandler): () => void {
    const set = this.handlers.get(event) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler);
    };
  }

  /** Ask the gateway for an order room. It verifies ownership; we cannot. */
  subscribeOrder(orderId: string): void {
    if (orderId === '') return;
    this.rooms.add(orderId);
    this.emit('order:subscribe', { orderId });
  }

  unsubscribeOrder(orderId: string): void {
    this.rooms.delete(orderId);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempts = 0;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.clearPingTimeout();
    const socket = this.ws;
    this.ws = null;
    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'client stop');
    }
    this.setState({ phase: 'idle', detail: null, attempts: 0 });
  }

  /** Force a fresh attempt now — wired to the "Reconnect" button. */
  retryNow(): void {
    this.clearTimer();
    this.attempts = 0;
    if (this.stopped) {
      this.start();
      return;
    }
    this.closeCurrent();
    this.open();
  }

  /* -------------------------------------------------------------- */
  /* Internals                                                       */
  /* -------------------------------------------------------------- */

  private setState(next: SocketState): void {
    this.state = next;
    for (const handler of this.stateHandlers) handler(next);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private clearPingTimeout(): void {
    if (this.pingTimeout !== null) {
      window.clearTimeout(this.pingTimeout);
      this.pingTimeout = null;
    }
  }

  private closeCurrent(): void {
    const socket = this.ws;
    this.ws = null;
    if (socket === null) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closing. Nothing to do and nothing worth reporting.
    }
  }

  private open(): void {
    if (this.stopped) return;
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;

    // No token yet ⇒ the gateway would disconnect us immediately. Wait for the
    // session rather than burning an attempt (and a backoff step) on it.
    if (getAccessToken() === null) {
      this.setState({
        phase: 'retrying',
        detail: 'Waiting for your session.',
        attempts: this.attempts,
      });
      this.scheduleRetry();
      return;
    }

    this.setState({ phase: 'connecting', detail: null, attempts: this.attempts });

    let socket: WebSocket;
    try {
      socket = new WebSocket(endpoint());
    } catch {
      this.onFailure('Could not open a connection.');
      return;
    }
    this.ws = socket;

    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') this.handlePacket(event.data);
    };
    socket.onerror = () => {
      // The browser deliberately hides the reason. `onclose` follows.
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.clearPingTimeout();
      this.onFailure('Connection lost.');
    };
  }

  private handlePacket(raw: string): void {
    const kind = raw.charAt(0);

    if (kind === ENGINE_OPEN) {
      // Engine handshake done. Now the socket.io CONNECT, carrying the JWT in
      // exactly the place `io(url, { auth: { token } })` would put it.
      const token = getAccessToken();
      this.send(`${ENGINE_MESSAGE}${SIO_CONNECT}${JSON.stringify({ token })}`);
      this.armPingTimeout(raw);
      return;
    }

    if (kind === ENGINE_PING) {
      this.send(ENGINE_PONG);
      this.armPingTimeout(null);
      return;
    }

    if (kind === ENGINE_CLOSE) {
      this.closeCurrent();
      this.onFailure('The server closed the connection.');
      return;
    }

    if (kind !== ENGINE_MESSAGE) return;

    const sio = raw.charAt(1);
    const body = raw.slice(2);

    if (sio === SIO_CONNECT) {
      this.attempts = 0;
      this.setState({ phase: 'live', detail: null, attempts: 0 });
      // Replay every room. This is the whole reason `rooms` exists.
      for (const orderId of this.rooms) this.emit('order:subscribe', { orderId });
      return;
    }

    if (sio === SIO_CONNECT_ERROR) {
      // Almost always an expired or missing JWT. Reconnecting will not help
      // until AuthProvider refreshes, which it does on its own schedule.
      this.closeCurrent();
      this.onFailure('Sign-in expired. Reopening the app will fix it.');
      return;
    }

    if (sio !== SIO_EVENT) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) return;
    const [name, payload] = parsed;
    if (typeof name !== 'string') return;

    for (const handler of this.handlers.get(name) ?? []) handler(payload);
  }

  /**
   * The server pings on an interval it declares in the OPEN packet. If one
   * never arrives, the socket is a zombie: TCP is up, nothing is flowing, and
   * the rider sees a green dot over a dead connection. Tear it down instead.
   */
  private armPingTimeout(openPacket: string | null): void {
    this.clearPingTimeout();
    let window_ms = 45_000;
    if (openPacket !== null) {
      try {
        const info: unknown = JSON.parse(openPacket.slice(1));
        const b = typeof info === 'object' && info !== null ? (info as Record<string, unknown>) : {};
        const interval = b['pingInterval'];
        const timeout = b['pingTimeout'];
        if (typeof interval === 'number' && typeof timeout === 'number') {
          window_ms = interval + timeout;
        }
      } catch {
        // Keep the default. A malformed OPEN is the server's problem.
      }
    }
    this.pingTimeout = window.setTimeout(() => {
      this.closeCurrent();
      this.onFailure('No response from the server.');
    }, window_ms);
  }

  private emit(event: string, payload: unknown): void {
    this.send(`${ENGINE_MESSAGE}${SIO_EVENT}${JSON.stringify([event, payload])}`);
  }

  private send(frame: string): void {
    const socket = this.ws;
    if (socket === null || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(frame);
    } catch {
      // The close handler will pick this up.
    }
  }

  private onFailure(detail: string): void {
    if (this.stopped) return;
    this.attempts += 1;
    this.setState({ phase: 'retrying', detail, attempts: this.attempts });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.open();
    }, delayFor(this.attempts));
  }
}

/**
 * One socket per tab. Two rider tabs each get their own, which is correct —
 * the gateway rooms are per-connection and both should receive an offer.
 */
let shared: RiderSocket | null = null;

export function getRiderSocket(): RiderSocket {
  shared ??= new RiderSocket();
  return shared;
}
