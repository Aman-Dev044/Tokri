import { Role } from '../common/constants/roles.enum';
import {
  OrderStatus,
  PaymentStatus,
} from '../common/constants/order-status.enum';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE SOCKET.IO CONTRACT (§6.3)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The seven events, their payload shapes and the room each one is emitted
 * to. Three frontends code against this file, so it is deliberately the
 * ONLY place an event name is written down: a typo in a string literal is
 * a silent no-op at runtime, whereas a typo in `RealtimeEvent` does not
 * compile.
 *
 * Every timestamp crosses the wire as an ISO-8601 string, never a `Date`.
 * Socket.IO serialises a Date to a string anyway; declaring it as one
 * means the browser's type and the server's type agree.
 *
 * Every money field is INTEGER PAISE.
 */

// ── Payloads ────────────────────────────────────────────────────────────

export interface OrderCreatedPayload {
  orderId: string;
  orderNo: string;
  itemCount: number;
  /** Grand total, integer paise. */
  total: number;
  placedAt: string;
}

export interface OrderAcceptedPayload {
  orderId: string;
  status: OrderStatus;
  etaMinutes: number | null;
  acceptedAt: string;
}

export interface OrderStatusChangedPayload {
  orderId: string;
  from: OrderStatus | null;
  to: OrderStatus;
  at: string;
  /**
   * `'system'` when the platform itself drove the transition — an offer
   * accepted through the assignment engine, or an order returned to the
   * pool because its rider went dark. A UI that attributes those to a
   * person is lying about who did it.
   */
  actorRole: Role | 'system';
}

export interface AssignmentWaypoint {
  /** Store name for the pickup, street line for the drop. */
  label: string;
  lat: number;
  lng: number;
}

export interface DeliveryAssignedPayload {
  assignmentId: string;
  orderId: string;
  orderNo: string;
  pickup: AssignmentWaypoint;
  drop: AssignmentWaypoint;
  /** Rider payout, integer paise. */
  payout: number;
  distanceKm: number;
  /** The offer dies at this instant — 45 seconds after it was made. */
  expiresAt: string;
}

export interface DeliveryLocationUpdatedPayload {
  orderId: string;
  lat: number;
  lng: number;
  at: string;
  etaMinutes: number | null;
}

export interface PaymentUpdatedPayload {
  orderId: string;
  status: PaymentStatus;
  /** Integer paise. */
  amount: number;
  at: string;
}

export interface NotificationCreatedPayload {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

// ── The map ─────────────────────────────────────────────────────────────

export interface RealtimeEventMap {
  'order.created': OrderCreatedPayload;
  'order.accepted': OrderAcceptedPayload;
  'order.status_changed': OrderStatusChangedPayload;
  'delivery.assigned': DeliveryAssignedPayload;
  'delivery.location_updated': DeliveryLocationUpdatedPayload;
  'payment.updated': PaymentUpdatedPayload;
  'notification.created': NotificationCreatedPayload;
}

export type RealtimeEvent = keyof RealtimeEventMap;

/**
 * Which events each room may carry.
 *
 * These unions are the §6.3 table expressed as types. `emitToOrder` will
 * not compile with `order.created` because an order room is subscribed by
 * the customer — and `order.created` is the vendor's new-work bell.
 */
export type OrderRoomEvent =
  | 'order.accepted'
  | 'order.status_changed'
  | 'delivery.location_updated'
  | 'payment.updated';

export type UserRoomEvent = 'delivery.assigned' | 'notification.created';

export type VendorRoomEvent = 'order.created' | 'notification.created';

export type AdminRoomEvent = 'payment.updated' | 'notification.created';

// ── Client → server messages ────────────────────────────────────────────

/** The only three messages a client may send. Everything else is ignored. */
export const CLIENT_MESSAGES = {
  ORDER_SUBSCRIBE: 'order:subscribe',
  ORDER_UNSUBSCRIBE: 'order:unsubscribe',
  RIDER_HEARTBEAT: 'rider:heartbeat',
} as const;

/** Rider heartbeat cadence, in milliseconds (§8.5). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Two consecutive misses, plus five seconds of slack for a slow network.
 * Past this a rider is treated as gone.
 */
export const HEARTBEAT_GRACE_MS = HEARTBEAT_INTERVAL_MS * 2 + 5_000;
