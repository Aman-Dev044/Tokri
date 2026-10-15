import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WsException,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import { Model, Types } from 'mongoose';
import { createClient, RedisClientType } from 'redis';

/**
 * Ten attempts with capped exponential backoff, then stop trying.
 *
 * node-redis's default is to retry forever. For a dependency that is
 * merely slow to start that is right; for one that is absent it is an
 * infinite error loop that hides every other line in the log. After ~30
 * seconds of failures this is not a blip, it is a missing service, and
 * the API has already degraded cleanly to single-replica realtime.
 *
 * Returning an Error (rather than a delay) is how node-redis is told to
 * give up.
 */
const RECONNECT_STRATEGY = (retries: number): number | Error =>
  retries > 10
    ? new Error('Redis unreachable after 10 attempts — giving up.')
    : Math.min(1000 * 2 ** retries, 8000);
import type { Server, Socket } from 'socket.io';

import { Public } from '../../common/decorators/public.decorator';
import { Role } from '../../common/constants/roles.enum';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../database/schemas/delivery-partner.schema';
import { CLIENT_MESSAGES } from '../realtime.events';
import { RealtimeService } from '../realtime.service';
import { RiderPresenceRegistry } from '../rider-presence.registry';
import { SocketUser, WsAuthService } from '../middleware/ws-auth.service';
import {
  ORDER_ROOM,
  ORDER_ROOM_PREFIX,
  OrderAccessRecord,
  autoJoinRooms,
  mayViewOrder,
} from '../rooms/rooms';

/**
 * Origins allowed to open a socket.
 *
 * Module-level and mutable because the `cors` option in the decorator is
 * evaluated when the class is DEFINED — long before Nest can inject
 * `ConfigService`. `afterInit` fills it from the same CORS_ORIGINS
 * allowlist the HTTP server uses, and until it does the callback denies
 * every browser origin. The list fails CLOSED, never open.
 */
let allowedOrigins: readonly string[] = [];

/** One socket may watch this many orders. A tracking screen needs one. */
const MAX_ORDER_ROOMS_PER_SOCKET = 25;

interface OrderSubscribePayload {
  orderId?: unknown;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE GATEWAY (§6.3)
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── Why @Public() and @SkipThrottle() sit on this class ─────────────────
 * Nest binds APP_GUARD enhancers to WEBSOCKET handlers as well as HTTP
 * ones. That chain cannot function here, and a half-running guard chain
 * is worse than none:
 *
 *   • `JwtAuthGuard` delegates to passport-jwt, which reads
 *     `request.headers.authorization`. In a WS context the "request" is
 *     the socket.io `Socket`, which has no `.headers` at all — the token
 *     arrives in `socket.handshake`. The guard cannot see the credential
 *     this connection actually presented.
 *   • `ThrottlerGuard` reads `req.ips` / `req.ip` and writes rate-limit
 *     RESPONSE HEADERS. A socket has neither.
 *
 * So the HTTP chain is switched off for this class and replaced by
 * something STRICTER: `handleConnection` authenticates the handshake
 * itself and disconnects on any failure, so an unauthenticated socket
 * never exists long enough to send a message. Every handler below runs
 * with an already-verified `socket.data.user` — more than an HTTP route
 * can say before its own guards have run.
 *
 * This adds no PUBLIC ROUTE. A gateway has no HTTP path and is not a
 * controller, so it appears neither in the route table nor in the
 * `public-routes.spec.ts` inventory. `realtime-rooms.spec.ts` asserts the
 * replacement: no token and an invalid token are both disconnected.
 *
 * ── Rooms are assigned by the SERVER ────────────────────────────────────
 * The client never names a room. It is joined to its own user room, its
 * vendor room and (for platform roles) the admin room on connect, and the
 * ONE room it may ask for — an order room — is granted only after the
 * order document itself says so. Changing an id in the payload earns a
 * `forbidden`, which is the single rule §6.3 exists to state.
 */
@Public()
@SkipThrottle()
@WebSocketGateway({
  cors: {
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // A native mobile client sends no Origin header.
      if (!requestOrigin) return callback(null, true);
      return callback(null, allowedOrigins.includes(requestOrigin));
    },
    credentials: true,
  },
  // Long-poll first, then upgrade. The handshake must land on the same
  // replica as the upgrade — that is what Nginx `ip_hash` is for (§8.6).
  transports: ['polling', 'websocket'],
})
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);

  /**
   * Errors suppressed since each client last became ready. Reset on
   * 'ready', so the count reported is the length of ONE outage.
   */
  private readonly redisErrorCounts = new Map<'pub' | 'sub', number>();

  /** Held so shutdown can close them; null when Redis is not wired. */
  private redisClients: { pub: RedisClientType; sub: RedisClientType } | null =
    null;

  constructor(
    private readonly auth: WsAuthService,
    private readonly realtime: RealtimeService,
    private readonly presence: RiderPresenceRegistry,
    private readonly config: ConfigService,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Lifecycle
  // ──────────────────────────────────────────────────────────────────

  afterInit(server: Server): void {
    allowedOrigins = this.config.getOrThrow<string[]>('cors.origins');

    // Hand the emit surface its server. Every other module emits through
    // RealtimeService and never sees this class — which is what keeps the
    // module graph acyclic.
    this.realtime.bind(server);

    void this.attachRedisAdapter(server);
  }

  /**
   * THE REDIS ADAPTER (§8.6) — wired on day one, not when scaling hurts.
   *
   * Without it two API replicas each keep their own set of rooms: a
   * vendor connected to replica A never receives an event emitted from
   * replica B. It works perfectly on one laptop and fails the moment
   * there are two containers, which is the worst possible time to learn
   * about it.
   *
   * An unreachable Redis degrades to single-replica behaviour with a LOUD
   * error rather than a dead API: the socket layer is not worth refusing
   * to serve HTTP over.
   *
   * "Loud" means ONCE, though. node-redis retries forever by default and
   * every attempt emits an 'error', so a Redis that is merely absent used
   * to write hundreds of identical ERROR lines a minute — which is the
   * same as writing none, because nobody can read the log any more.
   */
  private async attachRedisAdapter(server: Server): Promise<void> {
    if (this.config.getOrThrow<string>('env') === 'test') {
      // The integration suite runs without a Redis container.
      return;
    }

    const url = this.config.getOrThrow<string>('redis.url');

    try {
      const pub: RedisClientType = createClient({
        url,
        socket: { reconnectStrategy: RECONNECT_STRATEGY },
      });
      const sub: RedisClientType = pub.duplicate();

      // Without these a dropped connection surfaces as an unhandled
      // 'error' event, which takes the whole process down. They are
      // deliberately de-duplicating: see `logRedisError`.
      pub.on('error', (error: Error) => this.logRedisError('pub', error));
      sub.on('error', (error: Error) => this.logRedisError('sub', error));
      pub.on('ready', () => this.logRedisRecovered('pub'));
      sub.on('ready', () => this.logRedisRecovered('sub'));

      await Promise.all([pub.connect(), sub.connect()]);
      server.adapter(createAdapter(pub, sub));
      this.redisClients = { pub, sub };

      this.logger.log('Socket.IO Redis adapter attached');
    } catch (error) {
      this.logger.error(
        'Socket.IO Redis adapter NOT attached — realtime events will not ' +
          'cross API replicas. ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /**
   * One ERROR per outage, not one per retry.
   *
   * The first failure is logged in full, because it is news. Everything
   * after it is the same fact repeating, so it is counted silently and
   * reported once, on recovery — which also tells whoever reads the log
   * how long the outage actually lasted.
   *
   * `error.message` is often empty for a refused connection, so the
   * error's `code` (ECONNREFUSED, ENOTFOUND) is preferred: "Redis pub
   * unavailable" with no reason is not worth printing.
   */
  private logRedisError(role: 'pub' | 'sub', error: Error): void {
    const suppressed = this.redisErrorCounts.get(role) ?? 0;
    this.redisErrorCounts.set(role, suppressed + 1);

    if (suppressed > 0) return;

    const code = (error as NodeJS.ErrnoException).code;
    const reason = error.message || code || 'unknown error';
    this.logger.error(
      `Redis ${role} unavailable (${reason}). Realtime events will not ` +
        'cross API replicas until it returns. Further errors from this ' +
        'client are suppressed until it reconnects.',
    );
  }

  private logRedisRecovered(role: 'pub' | 'sub'): void {
    const suppressed = this.redisErrorCounts.get(role) ?? 0;
    if (suppressed === 0) return;
    this.redisErrorCounts.set(role, 0);
    this.logger.log(
      `Redis ${role} reconnected after ${suppressed} failed ` +
        `attempt${suppressed === 1 ? '' : 's'}.`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.redisClients) return;
    const { pub, sub } = this.redisClients;
    this.redisClients = null;
    await Promise.allSettled([pub.quit(), sub.quit()]);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Connection
  // ──────────────────────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    const user = await this.auth.authenticate(client);

    if (!user) {
      // No reason is given: "expired" versus "forged" versus "suspended"
      // is an oracle. The client reconnects with a fresh access token, or
      // it does not connect at all.
      client.emit('auth_error', { message: 'unauthorized' });
      client.disconnect(true);
      return;
    }

    client.data.user = user;

    // ── Server-assigned rooms. The client is never asked. ──
    for (const room of autoJoinRooms(user)) {
      await client.join(room);
    }

    if (user.role === Role.DELIVERY) {
      this.presence.connect(user.sub, client.id);
    }

    this.logger.debug(`Socket ${client.id} connected as ${user.role}`);
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user as SocketUser | undefined;
    if (!user) return;

    if (user.role === Role.DELIVERY) {
      this.presence.disconnect(user.sub, client.id);
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  Messages
  // ──────────────────────────────────────────────────────────────────

  /**
   * The only room a client may ask for — and only for an order the
   * database agrees is theirs.
   *
   * §6.3, verbatim: "A client must never be allowed to subscribe to
   * another vendor, order or customer room simply by changing an
   * identifier."
   */
  @SubscribeMessage(CLIENT_MESSAGES.ORDER_SUBSCRIBE)
  async subscribeToOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: OrderSubscribePayload,
  ): Promise<{ ok: true; room: string }> {
    const user = client.data.user as SocketUser | undefined;
    // Defence in depth: handleConnection already disconnected anyone
    // without an identity, so this can only fire if that ever regresses.
    if (!user) throw new WsException('unauthorized');

    const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
    // A malformed id reads as `not_found`, exactly like an id that does
    // not exist — the two must be indistinguishable, or the difference
    // itself becomes an enumeration signal.
    if (!Types.ObjectId.isValid(orderId)) throw new WsException('not_found');

    if (countOrderRooms(client) >= MAX_ORDER_ROOMS_PER_SOCKET) {
      throw new WsException('too_many_subscriptions');
    }

    const order = await this.orders
      .findById(orderId)
      .select('customerId vendorId deliveryPartnerId')
      .lean<OrderAccessRecord | null>()
      .exec();

    if (!order) throw new WsException('not_found');

    const partnerId =
      user.role === Role.DELIVERY ? await this.partnerIdOf(user.sub) : null;

    if (!mayViewOrder(order, user, partnerId)) {
      // The one line this whole file exists for.
      throw new WsException('forbidden');
    }

    const room = ORDER_ROOM(orderId);
    await client.join(room);
    return { ok: true, room };
  }

  @SubscribeMessage(CLIENT_MESSAGES.ORDER_UNSUBSCRIBE)
  async unsubscribeFromOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: OrderSubscribePayload,
  ): Promise<{ ok: true }> {
    const orderId = typeof body?.orderId === 'string' ? body.orderId : '';
    // Leaving a room the caller is not in is a no-op, so this needs no
    // authorisation check of its own.
    if (Types.ObjectId.isValid(orderId)) {
      await client.leave(ORDER_ROOM(orderId));
    }
    return { ok: true };
  }

  /**
   * The rider heartbeat (§8.5) — every 30 seconds.
   *
   * Two consecutive misses and `RiderHeartbeatService` takes the order
   * back. The socket merely records that the rider is still there; the
   * consequences live in the delivery module, which is why this writes to
   * a registry instead of calling into it.
   */
  @SubscribeMessage(CLIENT_MESSAGES.RIDER_HEARTBEAT)
  heartbeat(@ConnectedSocket() client: Socket): { ok: true; at: string } {
    const user = client.data.user as SocketUser | undefined;
    if (!user) throw new WsException('unauthorized');
    if (user.role !== Role.DELIVERY) throw new WsException('forbidden');

    this.presence.touch(user.sub);
    return { ok: true, at: new Date().toISOString() };
  }

  /** The rider's DeliveryPartner id, resolved from their user id. */
  private async partnerIdOf(userId: string): Promise<Types.ObjectId | null> {
    const partner = await this.partners
      .findOne({ userId: new Types.ObjectId(userId) })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();

    return partner?._id ?? null;
  }
}

const countOrderRooms = (client: Socket): number => {
  let count = 0;
  for (const room of client.rooms) {
    if (room.startsWith(ORDER_ROOM_PREFIX)) count += 1;
  }
  return count;
};
