/**
 * A very small Socket.IO v4 client, spoken over the native WebSocket.
 *
 * ── WHY NOT `socket.io-client`? ─────────────────────────────────────────────
 * The web app does not depend on it, and adding a dependency mid-build — with
 * five other workers running installs against the same lockfile — is a merge
 * conflict waiting to happen for ~40KB of features this screen does not use
 * (long-polling fallback, binary attachments, multiplexed namespaces, acks).
 *
 * What the order tracker actually needs is: connect with a token, join one
 * room, receive two events, and reconnect sensibly. That is the protocol below,
 * about 150 lines of it, and it is the documented wire format rather than a
 * guess:
 *
 *   Engine.IO v4 packet = one leading digit
 *     0 open · 1 close · 2 ping · 3 pong · 4 message
 *   Socket.IO v5 packet = second digit, inside a `4` message
 *     0 connect · 1 disconnect · 2 event · 3 ack · 4 connect_error
 *
 *   server → "0{\"sid\":…,\"pingInterval\":25000,\"pingTimeout\":20000}"
 *   client → "40{\"token\":\"…\"}"           namespace connect, with auth
 *   server → "40{\"sid\":\"…\"}"              connected
 *   client → "42[\"order:subscribe\",{…}]"   emit
 *   server → "42[\"order.status_changed\",{…}]"
 *   server → "2"  →  client → "3"            heartbeat
 *
 * Swapping in the official client later means deleting this file and keeping
 * `useSocket`'s public shape — nothing outside it knows this exists.
 *
 * ── THE TOKEN ───────────────────────────────────────────────────────────────
 * `auth()` is called fresh on EVERY connect attempt, never captured once. The
 * access token is 15 minutes old at most and lives in memory; a reconnect an
 * hour into a session must present the current one, not the one from page load.
 */

export type SocketPhase = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface LiteSocketOptions {
  /** socket origin, no path — e.g. http://localhost:4000 */
  url: string;
  /** default '/socket.io' */
  path?: string;
  /** evaluated per attempt, so a rotated access token is picked up */
  auth: () => Record<string, unknown>;
  onPhase: (phase: SocketPhase, detail: string | null) => void;
  onEvent: (name: string, payload: unknown) => void;
  /** backoff ceiling; default 30s */
  maxDelayMs?: number;
}

const BASE_DELAY_MS = 1_000;

function toWebSocketUrl(origin: string, path: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${path.replace(/\/$/, '')}/`;
  url.searchParams.set('EIO', '4');
  url.searchParams.set('transport', 'websocket');
  return url.toString();
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export class LiteSocket {
  private readonly options: LiteSocketOptions;
  private ws: WebSocket | null = null;
  private phase: SocketPhase = 'idle';
  private attempt = 0;
  private retryTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private heartbeatMs = 45_000;
  /** queued until the namespace connect is acknowledged */
  private pending: string[] = [];
  private closedByUs = false;

  constructor(options: LiteSocketOptions) {
    this.options = options;
  }

  get currentPhase(): SocketPhase {
    return this.phase;
  }

  connect(): void {
    this.closedByUs = false;
    this.open();
  }

  /** Emit a Socket.IO event. Queued while reconnecting, flushed on connect. */
  emit(name: string, payload?: unknown): void {
    const frame = `42${JSON.stringify(payload === undefined ? [name] : [name, payload])}`;
    if (this.phase === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
    } else {
      this.pending.push(frame);
    }
  }

  /** Force an immediate retry — used when the tab becomes visible again. */
  retryNow(): void {
    if (this.closedByUs) return;
    if (this.phase === 'connected' || this.phase === 'connecting') return;
    this.clearRetry();
    this.attempt = 0;
    this.open();
  }

  close(): void {
    this.closedByUs = true;
    this.clearRetry();
    this.clearHeartbeat();
    if (this.ws) {
      // `41` is a clean Socket.IO namespace disconnect; the server drops the
      // room membership immediately rather than waiting for a ping timeout.
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send('41');
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
    this.setPhase('closed', null);
  }

  /* ───────────────────────────── internals ──────────────────────────────── */

  private setPhase(phase: SocketPhase, detail: string | null): void {
    if (this.phase === phase && detail === null) return;
    this.phase = phase;
    this.options.onPhase(phase, detail);
  }

  private open(): void {
    if (this.closedByUs) return;
    this.clearRetry();

    this.setPhase(this.attempt === 0 ? 'connecting' : 'reconnecting', null);

    let socket: WebSocket;
    try {
      socket = new WebSocket(toWebSocketUrl(this.options.url, this.options.path ?? '/socket.io'));
    } catch {
      this.scheduleRetry('The socket URL is not reachable.');
      return;
    }
    this.ws = socket;

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') this.handleFrame(event.data);
    };
    socket.onerror = () => {
      // The close handler runs right after and owns the retry; an error alone
      // carries no usable detail in browsers, by design.
    };
    socket.onclose = () => {
      this.clearHeartbeat();
      if (this.ws === socket) this.ws = null;
      if (this.closedByUs) return;
      this.scheduleRetry(null);
    };
  }

  private handleFrame(frame: string): void {
    const engine = frame.charAt(0);

    /* open — read the heartbeat settings, then connect the namespace */
    if (engine === '0') {
      const handshake = safeParse(frame.slice(1));
      if (handshake !== null && typeof handshake === 'object') {
        const record = handshake as Record<string, unknown>;
        const interval = record['pingInterval'];
        const timeout = record['pingTimeout'];
        if (typeof interval === 'number' && typeof timeout === 'number') {
          this.heartbeatMs = interval + timeout;
        }
      }
      this.armHeartbeat();
      // The auth payload rides on the namespace CONNECT packet. The gateway
      // verifies it in handleConnection and disconnects immediately if it is
      // invalid — no unauthenticated socket ever exists (plan §6.3).
      this.ws?.send(`40${JSON.stringify(this.options.auth())}`);
      return;
    }

    /* server heartbeat */
    if (engine === '2') {
      this.armHeartbeat();
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('3');
      return;
    }

    if (engine !== '4') return;

    const kind = frame.charAt(1);
    const body = frame.slice(2);

    /* namespace connected */
    if (kind === '0') {
      this.attempt = 0;
      this.setPhase('connected', null);
      const queued = this.pending;
      this.pending = [];
      for (const message of queued) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(message);
      }
      return;
    }

    /* server-side disconnect */
    if (kind === '1') {
      this.ws?.close();
      return;
    }

    /* an event */
    if (kind === '2') {
      // An ack id may sit between the packet type and the array: `42<id>[...]`.
      const start = body.indexOf('[');
      if (start < 0) return;
      const parsed = safeParse(body.slice(start));
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      const [name, payload] = parsed;
      if (typeof name !== 'string') return;
      this.options.onEvent(name, payload);
      return;
    }

    /* connect_error — a rejected token, or a room the user may not join */
    if (kind === '4') {
      const parsed = safeParse(body);
      const message =
        parsed !== null && typeof parsed === 'object'
          ? ((parsed as Record<string, unknown>)['message'] as string | undefined)
          : undefined;
      this.setPhase('reconnecting', message ?? 'The server refused the connection.');
      this.ws?.close();
    }
  }

  /**
   * If the server's heartbeat stops arriving the connection is dead even though
   * the browser has not noticed — a laptop lid closing, a captive portal, a
   * dropped mobile hand-off. Without this the UI shows "live" over a socket
   * that will never speak again, which is the exact dishonesty this screen is
   * supposed to avoid.
   */
  private armHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = window.setTimeout(() => {
      this.ws?.close();
    }, this.heartbeatMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Exponential backoff with jitter: 1s, 2s, 4s … capped, ±25%. */
  private scheduleRetry(detail: string | null): void {
    if (this.closedByUs) return;
    this.setPhase('reconnecting', detail);

    const ceiling = this.options.maxDelayMs ?? 30_000;
    const raw = Math.min(ceiling, BASE_DELAY_MS * 2 ** this.attempt);
    // Jitter stops every client in a region reconnecting on the same tick and
    // knocking the gateway over a second time.
    const delay = Math.round(raw * (0.75 + Math.random() * 0.5));
    this.attempt += 1;

    this.retryTimer = window.setTimeout(() => {
      this.open();
    }, delay);
  }
}
