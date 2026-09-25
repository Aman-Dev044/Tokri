import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import {
  AdminRoomEvent,
  OrderRoomEvent,
  RealtimeEventMap,
  UserRoomEvent,
  VendorRoomEvent,
} from './realtime.events';
import {
  ADMIN_ROOM,
  ORDER_ROOM,
  USER_ROOM,
  VENDOR_ROOM,
} from './rooms/rooms';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE EMIT SURFACE
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every other module emits through this and NEVER injects the gateway.
 *
 * That is not tidiness. The gateway injects models and services in order
 * to authorise a subscription; if the orders service injected the gateway
 * back, the module graph would contain a cycle and Nest would hand one of
 * them an `undefined` dependency at runtime — the classic "it works in
 * dev and explodes once you add one more import" failure. A plain
 * injectable with a late-bound `Server` reference has no such edge.
 *
 * ── TWO RULES FOR CALLERS ───────────────────────────────────────────────
 *
 * 1. EMIT AFTER THE TRANSACTION COMMITS, NEVER INSIDE IT. An emit inside
 *    `session.withTransaction()` is delivered even when the transaction
 *    then aborts — the customer's app shows a status the database does
 *    not have, and a refresh takes it away again. Collect the payload
 *    inside, emit outside.
 *
 * 2. Nothing here throws. A broken socket layer must never fail the HTTP
 *    request that produced the event: the order is placed, the money
 *    moved, and a missed notification is the cheapest possible casualty.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  /** Called once by the gateway in `afterInit`. */
  bind(server: Server): void {
    this.server = server;
  }

  /** False before the gateway has initialised — true in a unit test. */
  get isReady(): boolean {
    return this.server !== null;
  }

  // ── The four rooms (§6.3) ─────────────────────────────────────────

  /** The customer, the vendor, the assigned rider and admins. */
  emitToOrder<E extends OrderRoomEvent>(
    orderId: string,
    event: E,
    payload: RealtimeEventMap[E],
  ): void {
    this.emit(ORDER_ROOM(orderId), event, payload);
  }

  /** One user, every device they have open. */
  emitToUser<E extends UserRoomEvent>(
    userId: string,
    event: E,
    payload: RealtimeEventMap[E],
  ): void {
    this.emit(USER_ROOM(userId), event, payload);
  }

  /** A store's owner and their staff. */
  emitToVendor<E extends VendorRoomEvent>(
    vendorId: string,
    event: E,
    payload: RealtimeEventMap[E],
  ): void {
    this.emit(VENDOR_ROOM(vendorId), event, payload);
  }

  /** Everyone on the ops console. */
  emitToAdmin<E extends AdminRoomEvent>(
    event: E,
    payload: RealtimeEventMap[E],
  ): void {
    this.emit(ADMIN_ROOM, event, payload);
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (!this.server) {
      // Normal in unit tests and during the first milliseconds of boot.
      this.logger.debug(`Dropped ${event} → ${room}: gateway not ready`);
      return;
    }

    try {
      this.server.to(room).emit(event, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit ${event} to ${room}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
