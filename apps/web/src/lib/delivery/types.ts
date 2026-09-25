/**
 * The rider surface's data shapes — a MIRROR of the live API.
 *
 * Every interface below was checked against the running API on :4000 and
 * against `apps/api/src/modules/delivery/types.ts`, which is the contract.
 * Nothing here is invented: a field the API does not send is not declared, and
 * a field the API sends as `null` is declared `| null` rather than optional.
 *
 * The difference matters. An optional field lets `??` quietly substitute a
 * plausible number; a nullable one forces the screen to decide what "we do not
 * know" looks like. On this surface that decision is always the same — an
 * honest dash, never a guess.
 *
 * MONEY IS INTEGER PAISE, everywhere, always. Format at the edge with
 * `money()`; never divide by 100 in a screen.
 *
 * DISTANCE IS KILOMETRES (`distanceKm`), because that is what the API sends.
 * An earlier draft of this app assumed metres and rendered "2 m" for a 2.4 km
 * ride. There is no metres field anywhere on this surface any more.
 */

/* ------------------------------------------------------------------ */
/* Enums, spelled exactly as the API serialises them                   */
/* ------------------------------------------------------------------ */

/** `common/constants/order-status.enum.ts` — UPPER_SNAKE on the wire. */
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

/** `PaymentMethod` — lower case on the wire. */
export type PaymentMethod = 'online' | 'cod';

/** `PaymentStatus` — lower case on the wire. */
export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

/** `VehicleType` on the delivery-partner schema. */
export type VehicleType = 'bicycle' | 'scooter' | 'motorcycle' | 'ev_scooter';

/** `PartnerStatus` on the delivery-partner schema. */
export type PartnerStatus = 'active' | 'pending' | 'suspended';

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A pickup or a drop, exactly as the API sends it: FLAT.
 *
 * `lat`/`lng` sit on the waypoint itself — there is no nested `point`, no
 * GeoJSON `coordinates` array, and no `phone` or `note`. The customer's phone
 * lives on the order (`customerPhone`), not on the drop.
 *
 * Either coordinate may be null when the address was never geocoded, and the
 * two are independent on the wire. `pointOf()` is the only sanctioned way to
 * turn a waypoint into a map coordinate, because it refuses a half-pair.
 */
export interface Waypoint {
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

/** A map coordinate, or null. Never a half-pair. */
export function pointOf(waypoint: Waypoint | null | undefined): LatLng | null {
  if (waypoint === null || waypoint === undefined) return null;
  const { lat, lng } = waypoint;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** `{ data, meta }` — the envelope every list endpoint returns. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/* ------------------------------------------------------------------ */
/* GET /delivery/me  ·  PATCH /delivery/availability                   */
/* ------------------------------------------------------------------ */

export interface RiderTodayStats {
  deliveries: number;
  /** Integer paise earned from deliveries completed today. */
  earningsPaise: number;
  /** Minutes socket-connected today, measured from the live socket. */
  onlineMinutes: number;
}

/**
 * The rider's profile. Returned by BOTH `GET /delivery/me` and
 * `PATCH /delivery/availability` — the PATCH is not a 204, it hands back the
 * whole profile, which is why the toggle never has to guess what it just did.
 */
export interface RiderProfile {
  partnerId: string;
  userId: string;
  name: string;
  phone: string;
  /** null for the platform pool — a rider not tied to one vendor. */
  vendorId: string | null;
  vehicleType: VehicleType;
  status: PartnerStatus;
  isOnline: boolean;
  isAvailable: boolean;
  rating: number;
  completedCount: number;
  activeOrderId: string | null;
  currentLocation: LatLng | null;
  locationAt: string | null;
  socketConnected: boolean;
  today: RiderTodayStats;
}

/** The body `PATCH /delivery/availability` accepts. Exactly two booleans. */
export interface AvailabilityInput {
  isOnline: boolean;
  isAvailable: boolean;
}

/* ------------------------------------------------------------------ */
/* GET /delivery/offers                                                */
/* ------------------------------------------------------------------ */

/**
 * A live offer.
 *
 * `id` is the DeliveryAssignment id and is what `/offers/:id/accept` takes.
 * The app used to call this `assignmentId`; the API has always called it `id`,
 * and posting to `/offers/undefined/accept` was the result.
 */
export interface Offer {
  id: string;
  orderId: string;
  orderNo: string;
  attemptNo: number;
  offeredAt: string;
  expiresAt: string;
  /** Milliseconds left at the moment the API answered. Server-authored. */
  expiresInMs: number;
  pickup: Waypoint;
  drop: Waypoint;
  distanceKm: number | null;
  itemCount: number;
  /** Cash to collect at the door, integer paise. 0 for a prepaid order. */
  codAmountPaise: number;
  payoutPaise: number;
}

/* ------------------------------------------------------------------ */
/* GET /delivery/orders/active                                         */
/* ------------------------------------------------------------------ */

/**
 * One line on the packing list.
 *
 * There is NO id here — the API sends name, qty, unit and image only. React
 * keys are the array index, which is correct for a list that never reorders.
 */
export interface ActiveOrderItem {
  name: string;
  qty: number;
  unit: string;
  image: string | null;
}

/**
 * OTP attempt state, NESTED under `otp` on the active order.
 *
 * The app used to read a flat `otpAttemptsRemaining`, which was always
 * undefined, so the "attempts left" line never appeared and the lock arrived
 * as a surprise at somebody's door.
 */
export interface OtpState {
  attemptsUsed: number;
  attemptsRemaining: number;
  /** True once the cap is hit: only an admin can move this order now. */
  locked: boolean;
}

export interface ActiveOrderPayment {
  method: PaymentMethod;
  status: PaymentStatus;
  /** Cash to collect, integer paise. 0 unless this is an unpaid COD order. */
  codAmountPaise: number;
}

export interface ActiveOrder {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  assignmentId: string | null;
  placedAt: string;
  pickup: Waypoint;
  drop: Waypoint;
  customerName: string | null;
  customerPhone: string;
  items: ActiveOrderItem[];
  itemCount: number;
  payment: ActiveOrderPayment;
  distanceKm: number | null;
  etaMinutes: number | null;
  payoutPaise: number;
  otp: OtpState;
}

/* ------------------------------------------------------------------ */
/* GET /delivery/history?page&limit                                    */
/* ------------------------------------------------------------------ */

/**
 * One finished attempt.
 *
 * There is no drop label and no full address here — the API returns `city` and
 * `pincode`, which is what a rider scanning yesterday actually recognises.
 */
export interface DeliveryHistoryRow {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  /** Null for a failed attempt, which never reached a delivery time. */
  deliveredAt: string | null;
  city: string;
  pincode: string;
  distanceKm: number | null;
  payoutPaise: number;
  codCollectedPaise: number;
}

/* ------------------------------------------------------------------ */
/* GET /delivery/earnings?from&to                                      */
/* ------------------------------------------------------------------ */

export interface EarningsDay {
  /** `YYYY-MM-DD`. */
  date: string;
  deliveries: number;
  payoutPaise: number;
}

/**
 * The statement for a window.
 *
 * `from`/`to` come back as full ISO timestamps even when the request sent
 * plain dates. There is no `todayPaise`, no `weekPaise`, no `unpaidPaise` and
 * no `nextPayoutAt` — the earlier app invented all four. Today's figures come
 * from `GET /delivery/me` (`today`), and a week is summed from `byDay`.
 */
export interface EarningsSummary {
  from: string;
  to: string;
  deliveries: number;
  payoutPaise: number;
  /** Cash the rider took in and owes the platform, integer paise. */
  codCollectedPaise: number;
  byDay: EarningsDay[];
}

/* ------------------------------------------------------------------ */
/* POST /delivery/location                                             */
/* ------------------------------------------------------------------ */

/**
 * The body `POST /delivery/location` accepts, and nothing else.
 *
 * The API runs `forbidNonWhitelisted: true`, so ONE unknown property is a hard
 * 400. The previous client sent `at` and `fixes` alongside these and every
 * single ping was rejected:
 *
 *   "property at should not exist", "property fixes should not exist"
 */
export interface LocationPing {
  lat: number;
  lng: number;
  /** Metres, 0–10000. */
  accuracy?: number;
  /** Degrees clockwise from north, integer 0–359. */
  heading?: number;
}

export interface LocationAck {
  accepted: true;
  at: string;
  orderId: string;
  etaMinutes: number | null;
}

/* ------------------------------------------------------------------ */
/* Socket payloads                                                     */
/* ------------------------------------------------------------------ */

/**
 * `delivery.assigned` → `user:{riderUserId}`.
 *
 * NOTE how much thinner this is than an `Offer`: the gateway sends a label and
 * a coordinate per waypoint and nothing else — no address, no item count, no
 * COD. So it is used as a DOORBELL, not as data: it triggers a re-read of
 * `GET /delivery/offers`, which is the only thing that can fill an offer card.
 */
export interface DeliveryAssignedEvent {
  assignmentId: string;
  orderId: string;
  orderNo: string;
  pickup: { label: string; lat: number; lng: number };
  drop: { label: string; lat: number; lng: number };
  payout: number;
  distanceKm: number;
  expiresAt: string;
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
 * The four screens of a job, in order. This is a VIEW of `OrderStatus`, not a
 * second state machine — `stepForStatus()` is the only mapping and it is
 * one-way. The rider app never decides a status; it asks the API to move one.
 */
export type JobStep = 'GO_TO_STORE' | 'AT_STORE' | 'TO_CUSTOMER' | 'DELIVER';

/**
 * ASSIGNED covers the first two: the API has no "arrived at store" transition,
 * so arrival is a local, non-destructive UI step. Nothing is written until the
 * rider confirms the pickup, which is the real transition.
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

/** "Scooter", "E-scooter" — for the profile card. */
export const VEHICLE_LABEL: Record<VehicleType, string> = {
  bicycle: 'Bicycle',
  scooter: 'Scooter',
  motorcycle: 'Motorcycle',
  ev_scooter: 'Electric scooter',
};
