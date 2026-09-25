import { OrderStatus } from '../../../common/constants/order-status.enum';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE OPERATIONS CLOCK
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every number the ADMIN console shows in red is computed here. It is a
 * pure module on purpose: no database, no Nest, no `Date.now()` captured
 * at import time. The board, the summary tile, the stuck list and the
 * unit tests all call the SAME functions, so "breached" can never mean
 * one thing on the board and another in the count above it.
 *
 * `now` is always an explicit argument. A helper that reached for the
 * wall clock itself could not be tested at a boundary, and a boundary is
 * the only interesting part of an SLA.
 */

export type SlaState = 'ok' | 'warning' | 'breached';

/** Warning band opens at 80% of the target. */
export const SLA_WARNING_RATIO = 0.8;

export interface Sla {
  targetMinutes: number;
  elapsedMinutes: number;
  state: SlaState;
}

/**
 * Whole minutes between two instants, floored, never negative.
 *
 * Floored rather than rounded so "29 minutes" never appears on a 30
 * minute SLA that has in fact already expired — rounding up an elapsed
 * time is the one direction in which this may not err.
 *
 * Clamped at zero because a clock skew between the app server and the
 * database can legitimately produce a document timestamped a second in
 * the future, and "-0 minutes in status" is a bug report, not an
 * incident.
 */
export function minutesBetween(from: Date | number, to: Date | number): number {
  const fromMs = from instanceof Date ? from.getTime() : from;
  const toMs = to instanceof Date ? to.getTime() : to;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return 0;
  return Math.max(0, Math.floor((toMs - fromMs) / 60_000));
}

/**
 * Where an order sits against its promise.
 *
 *   elapsed <  80% of target          → ok
 *   80% ≤ elapsed ≤ 100% of target    → warning
 *   elapsed >  100% of target         → breached
 *
 * The bands are half-open in that direction deliberately: an order at
 * EXACTLY the target has not yet broken the promise, it has just used all
 * of it. Calling that a breach would report a breach on every order that
 * arrives precisely on time.
 *
 * A non-positive target means the SLA is unconfigured; nothing can be
 * late against a promise of zero minutes, so it reports `ok` rather than
 * painting the entire board red.
 */
export function slaState(
  elapsedMinutes: number,
  targetMinutes: number,
): SlaState {
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) return 'ok';
  if (elapsedMinutes > targetMinutes) return 'breached';
  if (elapsedMinutes >= targetMinutes * SLA_WARNING_RATIO) return 'warning';
  return 'ok';
}

/** The `sla` block on every OpsOrderCard. Measured from `placedAt`. */
export function buildSla(
  placedAt: Date | number,
  now: Date | number,
  targetMinutes: number,
): Sla {
  const elapsedMinutes = minutesBetween(placedAt, now);
  return {
    targetMinutes,
    elapsedMinutes,
    state: slaState(elapsedMinutes, targetMinutes),
  };
}

// ────────────────────────────────────────────────────────────────────────
//  Lanes
// ────────────────────────────────────────────────────────────────────────

export type OpsLane =
  | 'new'
  | 'preparing'
  | 'ready'
  | 'assigned'
  | 'in_transit';

export interface LaneSpec {
  lane: OpsLane;
  label: string;
  statuses: readonly OrderStatus[];
}

/**
 * The five columns of the live board, in the order work flows through
 * them. PICKED_UP shares a lane with ASSIGNED because from the console's
 * point of view they are the same problem — a rider holds the order and
 * has not started driving.
 */
export const OPS_LANES: readonly LaneSpec[] = [
  { lane: 'new', label: 'New', statuses: [OrderStatus.PLACED] },
  {
    lane: 'preparing',
    label: 'Preparing',
    statuses: [OrderStatus.ACCEPTED, OrderStatus.PACKING],
  },
  {
    lane: 'ready',
    label: 'Ready for pickup',
    statuses: [OrderStatus.READY_FOR_PICKUP],
  },
  {
    lane: 'assigned',
    label: 'Assigned',
    statuses: [OrderStatus.ASSIGNED, OrderStatus.PICKED_UP],
  },
  {
    lane: 'in_transit',
    label: 'In transit',
    statuses: [OrderStatus.OUT_FOR_DELIVERY],
  },
];

/** At most this many cards per lane travel over the wire. */
export const LANE_CARD_CAP = 50;

export const laneFor = (status: OrderStatus): OpsLane | null =>
  OPS_LANES.find((spec) => spec.statuses.includes(status))?.lane ?? null;

// ────────────────────────────────────────────────────────────────────────
//  Stuck thresholds
// ────────────────────────────────────────────────────────────────────────

/**
 * How long an order may sit in one status before it is a problem someone
 * has to touch, in minutes.
 *
 * A status absent from this map is either terminal or has no meaningful
 * ceiling (PICKED_UP resolves into OUT_FOR_DELIVERY within a minute or
 * two by construction, and DELIVERY_FAILED is already on the needs-action
 * list in its own right).
 */
export const STUCK_THRESHOLD_MINUTES: Readonly<
  Partial<Record<OrderStatus, number>>
> = {
  [OrderStatus.PLACED]: 10,
  [OrderStatus.ACCEPTED]: 25,
  [OrderStatus.PACKING]: 25,
  [OrderStatus.READY_FOR_PICKUP]: 15,
  [OrderStatus.ASSIGNED]: 15,
  [OrderStatus.OUT_FOR_DELIVERY]: 45,
};

export const STUCK_STATUSES: readonly OrderStatus[] = Object.keys(
  STUCK_THRESHOLD_MINUTES,
) as OrderStatus[];

export const stuckThresholdFor = (status: OrderStatus): number | null =>
  STUCK_THRESHOLD_MINUTES[status] ?? null;

/**
 * Is this order stuck?
 *
 * Two conditions, and the second is what `stuckOrderGraceMinutes` buys:
 *
 *  1. it has been in its CURRENT status longer than that status allows;
 *  2. the ORDER as a whole is at least `graceMinutes` old.
 *
 * The grace is a floor on the order's age, not extra slack on top of each
 * threshold — so raising it quietens the whole queue during a known
 * incident without silently redefining what "PLACED > 10 minutes" means.
 * At the default of 10 it is inert, because no threshold is lower.
 */
export function isStuck(
  status: OrderStatus,
  minutesInStatus: number,
  ageMinutes: number,
  graceMinutes: number,
): boolean {
  const threshold = stuckThresholdFor(status);
  if (threshold === null) return false;
  return minutesInStatus > threshold && ageMinutes >= graceMinutes;
}

export interface StuckExplanation {
  reason: string;
  suggestedAction: string;
}

/**
 * Why it is stuck, and what the operator should do about it.
 *
 * The console shows both verbatim. "Stuck" alone is a colour; this is the
 * difference between a dashboard and a work queue.
 */
const STUCK_EXPLANATION: Readonly<
  Partial<Record<OrderStatus, StuckExplanation>>
> = {
  [OrderStatus.PLACED]: {
    reason: 'The vendor has not accepted this order yet.',
    suggestedAction:
      'Call the store. If they cannot fulfil it, cancel and tell the customer now rather than in twenty minutes.',
  },
  [OrderStatus.ACCEPTED]: {
    reason: 'Accepted, but the vendor has not started packing.',
    suggestedAction: 'Chase the store on packing.',
  },
  [OrderStatus.PACKING]: {
    reason: 'Packing has run long.',
    suggestedAction:
      'Chase the store, and check whether a line is out of stock and needs dropping.',
  },
  [OrderStatus.READY_FOR_PICKUP]: {
    reason: 'Packed and waiting, with no rider assigned.',
    suggestedAction: 'Assign a rider from the dispatch monitor.',
  },
  [OrderStatus.ASSIGNED]: {
    reason: 'A rider holds this order but has not picked it up.',
    suggestedAction:
      'Call the rider. If they are not moving, unassign and re-dispatch.',
  },
  [OrderStatus.OUT_FOR_DELIVERY]: {
    reason: 'Out for delivery for longer than a drop should take.',
    suggestedAction:
      'Call the rider, confirm the address, and warn the customer.',
  },
};

const FALLBACK_EXPLANATION: StuckExplanation = {
  reason: 'This order has been in the same status longer than expected.',
  suggestedAction: 'Review the order and move it on.',
};

export const explainStuck = (status: OrderStatus): StuckExplanation =>
  STUCK_EXPLANATION[status] ?? FALLBACK_EXPLANATION;

// ────────────────────────────────────────────────────────────────────────
//  Geometry
// ────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in km, rounded to two decimals.
 *
 * Used only where MongoDB has NOT already computed it: `$geoNear` returns
 * a real distance for the nearest-rider search, but the "how far is this
 * rider from their drop" column compares two points we already hold in
 * memory, and a second round trip to the database for one subtraction
 * would be absurd.
 *
 * Arguments are (lng, lat) pairs, matching GeoJSON — never (lat, lng).
 */
export function haversineKm(
  a: readonly [number, number] | null,
  b: readonly [number, number] | null,
): number | null {
  if (!a || !b) return null;
  const [lngA, latA] = a;
  const [lngB, latB] = b;
  if (![lngA, latA, lngB, latB].every((n) => Number.isFinite(n))) return null;

  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) *
      Math.cos(toRadians(latB)) *
      Math.sin(dLng / 2) ** 2;

  return (
    Math.round(EARTH_RADIUS_KM * 2 * Math.asin(Math.sqrt(h)) * 100) / 100
  );
}

/** Midnight UTC of the day containing `now`. The ops "today" boundary. */
export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
