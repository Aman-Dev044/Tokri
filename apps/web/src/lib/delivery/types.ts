/**
 * The rider surface's data shapes.
 *
 * These mirror the DELIVERY block of plan §6.2 and the two socket payloads in
 * §6.3 that a rider cares about (`delivery.assigned`, `order.status_changed`).
 *
 * Worker C is building those endpoints in parallel, so every one of them may
 * 404 today. That is handled in `api.ts` + `useRider*` by falling back to a
 * LABELLED fixture — never by inventing a shape here that the API does not
 * promise. Where a field is not yet guaranteed by §6.2 it is optional, and the
 * UI renders an honest blank rather than a plausible number.
 *
 * MONEY IS INTEGER PAISE, everywhere, always (plan §8.7 #13). A float rupee
 * that has been through two divisions is a reconciliation bug waiting to
 * happen. Format at the edge with `formatPaise`, never store the string.
 */

/** §5.3 — the backend is the only authority on transitions. */
export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PACKING'
  | 'READY_FOR_PICKUP'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * The four screens of a job, in order. This is a VIEW of `OrderStatus`, not a
 * second state machine — `stepForStatus()` is the only mapping and it is
 * one-way. The rider app never decides a status; it asks the API to move one.
 */
export type JobStep = 'GO_TO_STORE' | 'AT_STORE' | 'TO_CUSTOMER' | 'DELIVER';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A pickup or a drop. `point` is null when the address was never geocoded. */
export interface Place {
  /** Store name, or "Flat 402, Sunrise Apartments" — the big line. */
  label: string;
  /** The full address, shown large. Always present; the map is not. */
  address: string;
  point: GeoPoint | null;
  /** Rendered as a `tel:` link when present. */
  phone?: string;
  /** "Ring the bell twice", "Gate code 4411" — shown verbatim if sent. */
  note?: string;
}

export interface JobItem {
  id: string;
  name: string;
  qty: number;
  /** "kg", "pc", "L" — optional because the API may inline it into `name`. */
  unit?: string;
}

/**
 * An incoming assignment. Payload of the `delivery.assigned` socket event
 * (§6.3) plus the extra detail `GET /delivery/offers` returns.
 *
 * `payoutPaise` is on this type deliberately: plan §2.4 and the brief both say
 * the rider sees what the job pays BEFORE accepting it. An offer card that
 * cannot show a payout is a bug, not a layout choice.
 */
export interface Offer {
  assignmentId: string;
  orderId: string;
  orderNo?: string;
  pickup: Place;
  drop: Place;
  payoutPaise: number;
  /** Total trip distance in metres — store leg plus drop leg. */
  distanceMeters?: number;
  itemCount?: number;
  /** ISO 8601. The 45s countdown is `expiresAt - now`, never a local timer. */
  expiresAt: string;
  /** Paise to collect at the door, or null for a prepaid order. */
  codAmountPaise?: number | null;
}

/** `GET /delivery/orders/active`. */
export interface ActiveJob {
  orderId: string;
  orderNo?: string;
  status: OrderStatus;
  pickup: Place;
  drop: Place;
  items: JobItem[];
  payoutPaise: number;
  distanceMeters?: number;
  /** null / absent ⇒ prepaid. Any positive number ⇒ collect it at the door. */
  codAmountPaise?: number | null;
  customerName?: string;
  /** Shown as a `tel:` link. Never auto-dialled. */
  customerPhone?: string;
  /** Counts down from 5. The API enforces the lock; this only tells the rider. */
  otpAttemptsRemaining?: number;
  etaMinutes?: number;
  assignedAt?: string;
}

/** One finished job in `history/`. */
export interface HistoryEntry {
  orderId: string;
  orderNo?: string;
  /** ISO 8601. */
  completedAt: string;
  status: Extract<OrderStatus, 'DELIVERED' | 'DELIVERY_FAILED'>;
  payoutPaise: number;
  distanceMeters?: number;
  dropLabel: string;
  codCollectedPaise?: number | null;
}

export interface EarningsDay {
  /** YYYY-MM-DD, the rider's local calendar day as the API grouped it. */
  date: string;
  deliveries: number;
  payoutPaise: number;
  tipsPaise?: number;
  codCollectedPaise?: number;
  distanceMeters?: number;
}

export interface EarningsSummary {
  todayPaise: number;
  todayDeliveries: number;
  weekPaise: number;
  weekDeliveries: number;
  /** Earned but not yet settled. Weekly settlement job runs Monday 02:00. */
  unpaidPaise: number;
  /** ISO date of the next settlement run, when the API tells us. */
  nextPayoutAt?: string;
  days: EarningsDay[];
}

/** `PATCH /delivery/availability`. */
export interface Availability {
  isOnline: boolean;
  /** Online but mid-job ⇒ online && !available. The API owns this. */
  isAvailable: boolean;
}

/* ------------------------------------------------------------------ */
/* Socket payloads (§6.3)                                             */
/* ------------------------------------------------------------------ */

/** `delivery.assigned` → `user:{partnerId}`. */
export interface DeliveryAssignedEvent {
  assignmentId: string;
  orderId: string;
  pickup: Place;
  drop: Place;
  payout: number;
  expiresAt: string;
  orderNo?: string;
  itemCount?: number;
  distanceMeters?: number;
  codAmountPaise?: number | null;
}

/** `order.status_changed` → `order:{orderId}`. */
export interface OrderStatusChangedEvent {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
  at: string;
  actorRole: string;
}

/* ------------------------------------------------------------------ */
/* Status → step                                                       */
/* ------------------------------------------------------------------ */

/**
 * One screen per step (plan §2.4: "One action per screen").
 *
 * ASSIGNED          → ride to the store
 * (at the store)    → collect the items, confirm pickup
 * PICKED_UP         → start the run to the customer
 * OUT_FOR_DELIVERY  → OTP at the door
 *
 * ASSIGNED covers both of the first two: the API has no "arrived at store"
 * transition, so arrival is a local, non-destructive UI step. Nothing is
 * written until the rider confirms the pickup, which is the real transition.
 */
export function stepForStatus(status: OrderStatus, arrivedAtStore: boolean): JobStep {
  switch (status) {
    case 'ASSIGNED':
      return arrivedAtStore ? 'AT_STORE' : 'GO_TO_STORE';
    case 'PICKED_UP':
      return 'TO_CUSTOMER';
    case 'OUT_FOR_DELIVERY':
      return 'DELIVER';
    default:
      // READY_FOR_PICKUP, DELIVERED, CANCELLED … the caller handles these as
      // "no live job"; defaulting here keeps the return type total.
      return 'GO_TO_STORE';
  }
}

/** A job the rider can still act on. Anything else belongs in history. */
export function isLiveStatus(status: OrderStatus): boolean {
  return status === 'ASSIGNED' || status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY';
}

export const STEP_ORDER: readonly JobStep[] = [
  'GO_TO_STORE',
  'AT_STORE',
  'TO_CUSTOMER',
  'DELIVER',
] as const;

export const STEP_LABEL: Record<JobStep, string> = {
  GO_TO_STORE: 'Go to store',
  AT_STORE: 'Collect items',
  TO_CUSTOMER: 'Out for delivery',
  DELIVER: 'Deliver',
};
