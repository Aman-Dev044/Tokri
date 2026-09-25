import { Role } from './roles.enum';

/**
 * The order state machine (§5.3).
 *
 * The backend is the only authority. Any transition not on the map below
 * is rejected with 409 — a client that asks for one is either out of date
 * or malicious, and neither should be able to move money.
 */
export enum OrderStatus {
  PLACED = 'PLACED',
  ACCEPTED = 'ACCEPTED',
  PACKING = 'PACKING',
  READY_FOR_PICKUP = 'READY_FOR_PICKUP',
  ASSIGNED = 'ASSIGNED',
  PICKED_UP = 'PICKED_UP',
  OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

/** Single source of truth, imported by the services AND by the tests. */
export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    [OrderStatus.PLACED]: [
      OrderStatus.ACCEPTED,
      OrderStatus.REJECTED,
      OrderStatus.CANCELLED,
    ],
    [OrderStatus.ACCEPTED]: [OrderStatus.PACKING, OrderStatus.CANCELLED],
    [OrderStatus.PACKING]: [
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.CANCELLED,
    ],
    [OrderStatus.READY_FOR_PICKUP]: [
      OrderStatus.ASSIGNED,
      OrderStatus.CANCELLED,
    ],
    // A partner who drops the job returns the order to the pool.
    [OrderStatus.ASSIGNED]: [
      OrderStatus.PICKED_UP,
      OrderStatus.READY_FOR_PICKUP,
    ],
    [OrderStatus.PICKED_UP]: [OrderStatus.OUT_FOR_DELIVERY],
    [OrderStatus.OUT_FOR_DELIVERY]: [
      OrderStatus.DELIVERED,
      OrderStatus.DELIVERY_FAILED,
    ],
    [OrderStatus.DELIVERY_FAILED]: [
      OrderStatus.ASSIGNED,
      OrderStatus.CANCELLED,
    ],
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.REJECTED]: [],
    [OrderStatus.CANCELLED]: [],
  };

/** Who may drive a given transition. Absent ⇒ platform roles only. */
export const ALLOWED_ACTOR: Readonly<Record<string, readonly Role[]>> = {
  'PLACED→ACCEPTED': [Role.VENDOR],
  'PLACED→REJECTED': [Role.VENDOR],
  'READY_FOR_PICKUP→ASSIGNED': [Role.VENDOR, Role.ADMIN],
  'ASSIGNED→PICKED_UP': [Role.DELIVERY],
  'OUT_FOR_DELIVERY→DELIVERED': [Role.DELIVERY],
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.REJECTED,
  OrderStatus.CANCELLED,
];

/** Orders that never completed — the numerator of the cancellation rate. */
export const FAILED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
];

/** Still moving through the pipeline. Drives the "live orders" tile. */
export const IN_FLIGHT_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.ACCEPTED,
  OrderStatus.PACKING,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.ASSIGNED,
  OrderStatus.PICKED_UP,
  OrderStatus.OUT_FOR_DELIVERY,
];

export const canTransition = (
  from: OrderStatus,
  to: OrderStatus,
): boolean => TRANSITIONS[from].includes(to);

export enum PaymentMethod {
  ONLINE = 'online',
  COD = 'cod',
}

export enum PaymentStatus {
  PENDING = 'pending',
  AUTHORIZED = 'authorized',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  PARTIALLY_REFUNDED = 'partially_refunded',
}
