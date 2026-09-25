/**
 * Order board logic — lanes, ageing, and the partial-fulfilment arithmetic.
 *
 * Pure functions, no React, so the money maths can be reasoned about (and
 * later tested) without mounting a screen.
 */

import type { AisleKey } from '@mandi/design-system';
import type { OrderItem, OrderPricing, OrderStatus, VendorOrder } from './types';

/* ================================================================== */
/* Lanes                                                               */
/* ================================================================== */

export type LaneKey = 'new' | 'preparing' | 'ready';

export interface LaneDef {
  key: LaneKey;
  title: string;
  /** what the vendor is supposed to DO with this column */
  hint: string;
  statuses: readonly OrderStatus[];
}

/**
 * Three lanes, and only three.
 *
 * Everything past `ASSIGNED` belongs to the rider and the customer, not to the
 * shop — putting it on this board would fill the screen a vendor works from
 * with rows they cannot act on. Delivered and rejected orders live in the
 * history list underneath.
 */
export const LANES: readonly LaneDef[] = [
  {
    key: 'new',
    title: 'New',
    hint: 'Waiting for you to accept or reject',
    statuses: ['PLACED'],
  },
  {
    key: 'preparing',
    title: 'Preparing',
    hint: 'Accepted — being picked and packed',
    statuses: ['ACCEPTED', 'PACKING'],
  },
  {
    key: 'ready',
    title: 'Ready',
    hint: 'Packed and waiting for a rider',
    statuses: ['READY_FOR_PICKUP', 'ASSIGNED'],
  },
];

/** Statuses that are finished as far as the shop is concerned. */
export const CLOSED_STATUSES: readonly OrderStatus[] = [
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'REJECTED',
  'CANCELLED',
];

export function laneOf(status: OrderStatus): LaneKey | null {
  const lane = LANES.find((candidate) => candidate.statuses.includes(status));
  return lane ? lane.key : null;
}

export function groupByLane(orders: readonly VendorOrder[]): Record<LaneKey, VendorOrder[]> {
  const out: Record<LaneKey, VendorOrder[]> = { new: [], preparing: [], ready: [] };
  for (const order of orders) {
    const lane = laneOf(order.status);
    if (lane) out[lane].push(order);
  }
  // Oldest first inside a lane. The card that has been waiting longest is the
  // one that is about to become a complaint, so it belongs at the top.
  //
  // `placedAt` is nullable on the wire, and `Date.parse(null)` is NaN — a NaN
  // comparator does not merely mis-sort, it makes the sort non-deterministic.
  // An order with no timestamp is treated as infinitely old and pinned to the
  // top, where a human will notice it.
  for (const key of Object.keys(out) as LaneKey[]) {
    out[key].sort((a, b) => placedMs(a) - placedMs(b));
  }
  return out;
}

/* ================================================================== */
/* Ageing                                                              */
/* ================================================================== */

/**
 * Whole minutes since the order was placed.
 *
 * `now` is injected rather than read from the clock so nothing here is
 * non-deterministic during render — the same reason `<RelativeTime/>` pins its
 * first paint. Callers pass `null` until after mount and render a dash.
 */
export function minutesWaiting(order: VendorOrder, now: number | null): number | null {
  if (now === null) return null;
  if (order.placedAt === null) return null;
  const placed = Date.parse(order.placedAt);
  if (Number.isNaN(placed)) return null;
  return Math.max(0, Math.floor((now - placed) / 60_000));
}

/** Epoch ms for sorting. A missing timestamp sorts oldest, never NaN. */
function placedMs(order: VendorOrder): number {
  if (order.placedAt === null) return 0;
  const parsed = Date.parse(order.placedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export type Urgency = 'calm' | 'warn' | 'late';

/**
 * How late is late.
 *
 * An unaccepted order is judged hard — every minute before acceptance is a
 * minute the customer is staring at "waiting for the shop". Once it is
 * accepted the clock is about the promise made, so the thresholds relax.
 */
export function urgencyOf(status: OrderStatus, minutes: number | null): Urgency {
  if (minutes === null) return 'calm';
  if (status === 'PLACED') {
    if (minutes >= 8) return 'late';
    if (minutes >= 4) return 'warn';
    return 'calm';
  }
  if (minutes >= 30) return 'late';
  if (minutes >= 18) return 'warn';
  return 'calm';
}

/* ================================================================== */
/* ★ Colour — the ONE chromatic move on this surface                   */
/* ================================================================== */

/**
 * Order status -> aisle hue.
 *
 * Plan §2.4 gives the vendor panel exactly one use of the chromatic-aisle
 * palette: **as order-status encoding, never as decoration.** So the eight
 * produce hues are spent here and nowhere else in the panel — a card's left
 * rule and its lane header carry the hue of the state the order is in, which
 * is what lets a shop owner read the board's shape from across the counter
 * before reading a single word.
 *
 * The hue never travels alone: every card also carries the status word and a
 * `<StatusPill>` glyph (plan §2.6).
 */
export const STATUS_AISLE: Record<OrderStatus, AisleKey> = {
  PLACED: 'fruits', // tomato — the one that needs you now
  ACCEPTED: 'bakery', // crust
  PACKING: 'dairy', // butter
  READY_FOR_PICKUP: 'vegetables', // leaf
  ASSIGNED: 'beverages', // deep water
  PICKED_UP: 'beverages',
  OUT_FOR_DELIVERY: 'frozen', // frost
  DELIVERED: 'vegetables',
  DELIVERY_FAILED: 'fruits',
  REJECTED: 'snacks', // berry
  CANCELLED: 'staples', // husk
};

export const LANE_AISLE: Record<LaneKey, AisleKey> = {
  new: 'fruits',
  preparing: 'dairy',
  ready: 'vegetables',
};

/* ================================================================== */
/* ★ Partial fulfilment                                                */
/* ================================================================== */

export interface FulfilmentPreview {
  /** lines still going in the bag */
  keptCount: number;
  droppedCount: number;
  /** INTEGER PAISE */
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorPayout: number;
  /**
   * What goes back to the customer: the original grand total minus the new
   * one. Zero when nothing was unticked. Never negative.
   */
  refundDelta: number;
}

/**
 * Recompute an order after lines have been unticked.
 *
 * ── THIS IS A PREVIEW, NOT THE TRUTH ────────────────────────────────────────
 * The server recomputes the same numbers inside the transaction that writes the
 * status, and its answer is the one that reaches the ledger. This exists so the
 * vendor can SEE the refund before they confirm it, rather than discovering it
 * in a settlement three days later. If the two ever disagree, the server wins
 * and the screen is the bug.
 *
 * ── THE CHOICES BEHIND THE ARITHMETIC ───────────────────────────────────────
 *   · Discount and taxes scale with the subtotal. A ₹50-off coupon on an order
 *     that lost half its lines cannot keep taking ₹50 off — that would hand the
 *     customer a bigger discount for the shop's own shortage.
 *   · The delivery fee does NOT scale. The rider still rides.
 *   · Commission is charged on the NEW subtotal, at the SNAPSHOT rate carried
 *     on the order (plan §5.1). Today's rate is irrelevant to an order placed
 *     last Tuesday.
 *   · Every step rounds to whole paise, because money here is an integer and a
 *     float that is "close enough" is how a settlement ends up off by three.
 */
export function previewFulfilment(
  items: readonly OrderItem[],
  pricing: OrderPricing,
  keptProductIds: ReadonlySet<string>,
): FulfilmentPreview {
  const kept = items.filter((item) => keptProductIds.has(item.productId));
  const itemsSubtotal = kept.reduce((sum, item) => sum + item.lineTotal, 0);

  const originalSubtotal = pricing.itemsSubtotal;
  const ratio = originalSubtotal > 0 ? itemsSubtotal / originalSubtotal : 0;

  const discount = Math.round(pricing.discount * ratio);
  const taxes = Math.round(pricing.taxes * ratio);
  // Nothing left in the bag means nothing to deliver.
  const deliveryFee = itemsSubtotal === 0 ? 0 : pricing.deliveryFee;

  const grandTotal = Math.max(0, itemsSubtotal - discount + deliveryFee + taxes);
  const commissionAmount = Math.round((itemsSubtotal * pricing.commissionPct) / 100);

  return {
    keptCount: kept.length,
    droppedCount: items.length - kept.length,
    itemsSubtotal,
    discount,
    deliveryFee,
    taxes,
    grandTotal,
    commissionPct: pricing.commissionPct,
    commissionAmount,
    vendorPayout: itemsSubtotal - commissionAmount,
    refundDelta: Math.max(0, pricing.grandTotal - grandTotal),
  };
}

/* ================================================================== */
/* Rejection reasons                                                   */
/* ================================================================== */

/**
 * A reason is REQUIRED on rejection (plan §6.2: `{ reason }`).
 *
 * The presets exist so the common case is one click, and the free-text box
 * exists because the fifth reason is always something nobody listed. The
 * server validates the field either way — this list is convenience, not
 * validation.
 */
export const REJECT_REASONS: readonly string[] = [
  'Out of stock on one or more items',
  'Shop is closing / closed',
  'Too far outside the delivery area',
  'No delivery partner available',
  'Suspected fraudulent order',
];

/** The transitions the accept/advance buttons offer, in board order. */
export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  ACCEPTED: 'PACKING',
  PACKING: 'READY_FOR_PICKUP',
};
