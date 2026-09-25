/**
 * Order status → the five stamps on the Journey Ribbon.
 *
 * The backend state machine (plan §5.3) has eleven states. A customer does not
 * want eleven. They want the five moments that change what they should do:
 *
 *     accepted → packed → picked up → on the way → at your door
 *
 * plus the one that already happened ("order placed"), so the ribbon starts
 * somewhere rather than empty. `PACKING` and `READY_FOR_PICKUP` are the same
 * moment to a customer; so are `ASSIGNED` and `PICKED_UP`.
 *
 * Everything here is pure. The ribbon component in the design system knows
 * nothing about Mandi's order states — it draws whatever list it is handed,
 * which is what lets the rider panel reuse it with a different vocabulary.
 */

import type { JourneyMilestone, JourneyState } from '@mandi/design-system/journey-ribbon';
import type { OrderStatus, StatusChange } from './types';

/**
 * The only three things the ribbon needs.
 *
 * Deliberately NOT `Order`: `GET /orders/:id/track` returns a `TrackView`,
 * which carries a status and a status history but no items, pricing or
 * address. Typing this on the whole order forced the track screen to fake one.
 */
export interface JourneySource {
  status: OrderStatus;
  statusHistory: readonly StatusChange[];
  placedAt: string | null;
}

/** How far along the ribbon each backend state sits. */
const RANK: Record<OrderStatus, number> = {
  PLACED: 0,
  ACCEPTED: 1,
  PACKING: 2,
  READY_FOR_PICKUP: 2,
  ASSIGNED: 3,
  PICKED_UP: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
  DELIVERY_FAILED: 4,
  REJECTED: 1,
  CANCELLED: 0,
};

interface Step {
  key: string;
  label: string;
  caption: string;
  /** the backend states that stamp this step */
  stamps: readonly OrderStatus[];
}

const STEPS: readonly Step[] = [
  {
    key: 'placed',
    label: 'Order placed',
    caption: 'Sent to the store. You can cancel free until they accept it.',
    stamps: ['PLACED'],
  },
  {
    key: 'accepted',
    label: 'Accepted',
    caption: 'The store has your order and is starting on it.',
    stamps: ['ACCEPTED'],
  },
  {
    key: 'packed',
    label: 'Packed',
    caption: 'Weighed, bagged and waiting at the counter.',
    stamps: ['PACKING', 'READY_FOR_PICKUP'],
  },
  {
    key: 'picked-up',
    label: 'Picked up',
    caption: 'A rider has collected your bags.',
    stamps: ['ASSIGNED', 'PICKED_UP'],
  },
  {
    key: 'on-the-way',
    label: 'On the way',
    caption: 'Moving towards your address now.',
    stamps: ['OUT_FOR_DELIVERY'],
  },
  {
    key: 'at-your-door',
    label: 'At your door',
    caption: 'Hand over the 4-digit code to complete the delivery.',
    stamps: ['DELIVERED'],
  },
];

function firstTimeFor(source: JourneySource, stamps: readonly OrderStatus[]): string | null {
  for (const event of source.statusHistory) {
    if (stamps.includes(event.to)) return event.at === '' ? null : event.at;
  }
  // The first step has no transition row when the history starts at PLACED.
  if (stamps.includes('PLACED')) return source.placedAt;
  return null;
}

export interface Journey {
  milestones: JourneyMilestone[];
  progress: number;
  cancelled: boolean;
  /** true for DELIVERY_FAILED — the ribbon shows a failed stamp, not a dead end */
  failed: boolean;
}

export function buildJourney(source: JourneySource): Journey {
  const rank = RANK[source.status];
  const cancelled = source.status === 'CANCELLED' || source.status === 'REJECTED';
  const failed = source.status === 'DELIVERY_FAILED';

  const milestones: JourneyMilestone[] = STEPS.map((step, index) => {
    let state: JourneyState;
    if (cancelled) {
      state = index < rank ? 'done' : 'pending';
    } else if (failed && index === 4) {
      state = 'failed';
    } else if (index < rank) {
      state = 'done';
    } else if (index === rank) {
      state = source.status === 'DELIVERED' ? 'done' : 'current';
    } else {
      state = 'pending';
    }

    return {
      key: step.key,
      label: step.label,
      caption: state === 'pending' ? step.caption : step.caption,
      at: firstTimeFor(source, step.stamps),
      state,
    };
  });

  const denominator = STEPS.length - 1;
  const progress = cancelled ? 0 : Math.max(0, Math.min(1, rank / denominator));

  return { milestones, progress, cancelled, failed };
}

/** Plain-English one-liner for a list row or a document title. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: 'Placed',
  ACCEPTED: 'Accepted',
  PACKING: 'Being packed',
  READY_FOR_PICKUP: 'Ready for pickup',
  ASSIGNED: 'Rider assigned',
  PICKED_UP: 'Picked up',
  OUT_FOR_DELIVERY: 'On the way',
  DELIVERED: 'Delivered',
  DELIVERY_FAILED: 'Delivery failed',
  REJECTED: 'Rejected by store',
  CANCELLED: 'Cancelled',
};

/** Which orders are still moving — those get the live socket subscription. */
export function isLiveOrder(status: OrderStatus): boolean {
  return (
    status !== 'DELIVERED' &&
    status !== 'CANCELLED' &&
    status !== 'REJECTED'
  );
}
