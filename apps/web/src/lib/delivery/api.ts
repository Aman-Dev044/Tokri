/**
 * The rider surface's only door to the API.
 *
 * Everything goes through the shared `api-client`, so the bearer token comes
 * from memory, the refresh cookie rides along, and failures arrive as a typed
 * `ApiError` instead of a rejected promise of unknown shape.
 *
 * ── THE PATHS ARE NO LONGER GUESSES ─────────────────────────────────────────
 * Every path and every query parameter below was verified against the running
 * API. Two of them were wrong and are fixed here:
 *
 *   history   `/delivery/orders?status=DELIVERED`  →  `/delivery/history?page&limit`
 *   location  `{ lat, lng, at, fixes }`            →  `{ lat, lng, accuracy?, heading? }`
 *
 * The second was not cosmetic. The API runs `forbidNonWhitelisted: true`, so
 * `at` and `fixes` made every location ping a 400 — a rider's live position
 * never reached the customer's map, on any delivery, ever.
 *
 * ── NORMALISATION, AND WHY IT IS STILL DEFENSIVE ────────────────────────────
 * The shapes are now right, so the normalisers no longer guess at alternative
 * spellings. What they still do is guarantee TOTALITY: every field the UI
 * touches exists after normalisation, so `job.drop.address` can never throw on
 * a scooter in the rain. A payload that cannot be made whole is dropped, and
 * the screen renders its empty state rather than a half-card.
 *
 * ── THE OTP ─────────────────────────────────────────────────────────────────
 * `deliverOrder()` takes the OTP and immediately posts it. It is never stored,
 * never put in a query string, never logged, and never echoed back into the
 * UI. Nothing in this app ever knows the correct value; the API holds a hash.
 */

import { ApiError, api, type RequestOptions } from '@/lib/api-client';
import type {
  ActiveOrder,
  ActiveOrderItem,
  ActiveOrderPayment,
  AvailabilityInput,
  DeliveryHistoryRow,
  EarningsDay,
  EarningsSummary,
  LatLng,
  LocationAck,
  LocationPing,
  Offer,
  OrderStatus,
  OtpState,
  PartnerStatus,
  PaymentMethod,
  PaymentStatus,
  RiderProfile,
  RiderTodayStats,
  VehicleType,
  Waypoint,
} from './types';

/* ------------------------------------------------------------------ */
/* Paths — every one of these is live and verified                     */
/* ------------------------------------------------------------------ */

export const DELIVERY_PATHS = {
  me: '/delivery/me',
  availability: '/delivery/availability',
  offers: '/delivery/offers',
  acceptOffer: (id: string) => `/delivery/offers/${encodeURIComponent(id)}/accept`,
  rejectOffer: (id: string) => `/delivery/offers/${encodeURIComponent(id)}/reject`,
  activeOrder: '/delivery/orders/active',
  pickedUp: (id: string) => `/delivery/orders/${encodeURIComponent(id)}/picked-up`,
  outForDelivery: (id: string) =>
    `/delivery/orders/${encodeURIComponent(id)}/out-for-delivery`,
  deliver: (id: string) => `/delivery/orders/${encodeURIComponent(id)}/deliver`,
  failed: (id: string) => `/delivery/orders/${encodeURIComponent(id)}/failed`,
  location: '/delivery/location',
  history: '/delivery/history',
  earnings: '/delivery/earnings',
} as const;

/** How many finished jobs the history screen asks for. The API caps at 100. */
export const HISTORY_PAGE_SIZE = 50;

/* ------------------------------------------------------------------ */
/* Safe readers                                                        */
/* ------------------------------------------------------------------ */

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag {
  return typeof value === 'object' && value !== null ? (value as Bag) : {};
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A string, or null. An empty string is null: it is not a value. */
function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A number, or null. Used for every `| null` field the API declares. */
function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const ORDER_STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PACKING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'REJECTED',
  'CANCELLED',
];

/**
 * An unknown status must not be guessed into a step the rider can act on.
 * ASSIGNED is the least destructive reading: it shows the job, offers only the
 * pickup action, and the API answers 409 if that turns out to be wrong.
 */
function readStatus(value: unknown): OrderStatus {
  const text = str(value);
  return ORDER_STATUSES.find((status) => status === text) ?? 'ASSIGNED';
}

const VEHICLE_TYPES: readonly VehicleType[] = [
  'bicycle',
  'scooter',
  'motorcycle',
  'ev_scooter',
];

function readVehicle(value: unknown): VehicleType {
  const text = str(value);
  return VEHICLE_TYPES.find((vehicle) => vehicle === text) ?? 'scooter';
}

const PARTNER_STATUSES: readonly PartnerStatus[] = ['active', 'pending', 'suspended'];

function readPartnerStatus(value: unknown): PartnerStatus {
  const text = str(value);
  return PARTNER_STATUSES.find((status) => status === text) ?? 'pending';
}

const PAYMENT_METHODS: readonly PaymentMethod[] = ['online', 'cod'];

function readPaymentMethod(value: unknown): PaymentMethod {
  const text = str(value);
  return PAYMENT_METHODS.find((method) => method === text) ?? 'online';
}

const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'pending',
  'authorized',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
];

function readPaymentStatus(value: unknown): PaymentStatus {
  const text = str(value);
  return PAYMENT_STATUSES.find((status) => status === text) ?? 'pending';
}

/** The flat `{ label, address, lat, lng }` the API actually sends. */
function waypoint(value: unknown, fallbackLabel: string): Waypoint {
  const raw = bag(value);
  return {
    label: nullableStr(raw['label']) ?? fallbackLabel,
    address: str(raw['address'], ''),
    lat: nullableNum(raw['lat']),
    lng: nullableNum(raw['lng']),
  };
}

function latLng(value: unknown): LatLng | null {
  const raw = bag(value);
  const lat = nullableNum(raw['lat']);
  const lng = nullableNum(raw['lng']);
  return lat === null || lng === null ? null : { lat, lng };
}

/* ------------------------------------------------------------------ */
/* Normalisers                                                         */
/* ------------------------------------------------------------------ */

function normaliseToday(value: unknown): RiderTodayStats {
  const raw = bag(value);
  return {
    deliveries: num(raw['deliveries'], 0),
    earningsPaise: num(raw['earningsPaise'], 0),
    onlineMinutes: num(raw['onlineMinutes'], 0),
  };
}

export function normaliseProfile(raw: unknown): RiderProfile | null {
  const b = bag(raw);
  const partnerId = str(b['partnerId']);
  // Without a partner id this is not a rider profile, whatever else it holds.
  if (partnerId === '') return null;

  return {
    partnerId,
    userId: str(b['userId']),
    name: str(b['name']),
    phone: str(b['phone']),
    vendorId: nullableStr(b['vendorId']),
    vehicleType: readVehicle(b['vehicleType']),
    status: readPartnerStatus(b['status']),
    isOnline: bool(b['isOnline']),
    isAvailable: bool(b['isAvailable']),
    rating: num(b['rating'], 0),
    completedCount: num(b['completedCount'], 0),
    activeOrderId: nullableStr(b['activeOrderId']),
    currentLocation: latLng(b['currentLocation']),
    locationAt: nullableStr(b['locationAt']),
    socketConnected: bool(b['socketConnected']),
    today: normaliseToday(b['today']),
  };
}

export function normaliseOffer(raw: unknown): Offer | null {
  const b = bag(raw);
  // `id`, NOT `assignmentId`. This is the accept/reject key.
  const id = str(b['id']);
  const orderId = str(b['orderId']);
  const expiresAt = str(b['expiresAt']);
  // Without these three the card cannot be acted on at all. Dropping it is
  // better than rendering a button that posts to `/offers/undefined/accept`.
  if (id === '' || orderId === '' || expiresAt === '') return null;

  return {
    id,
    orderId,
    orderNo: str(b['orderNo']),
    attemptNo: num(b['attemptNo'], 1),
    offeredAt: str(b['offeredAt'], expiresAt),
    expiresAt,
    expiresInMs: num(b['expiresInMs'], 0),
    pickup: waypoint(b['pickup'], 'Pickup'),
    drop: waypoint(b['drop'], 'Drop'),
    distanceKm: nullableNum(b['distanceKm']),
    itemCount: num(b['itemCount'], 0),
    codAmountPaise: num(b['codAmountPaise'], 0),
    payoutPaise: num(b['payoutPaise'], 0),
  };
}

function normaliseItem(raw: unknown): ActiveOrderItem {
  const b = bag(raw);
  return {
    name: str(b['name'], 'Item'),
    qty: num(b['qty'], 1),
    unit: str(b['unit'], ''),
    image: nullableStr(b['image']),
  };
}

/** Nested under `otp`. Absent ⇒ a full five attempts and no lock. */
function normaliseOtp(raw: unknown): OtpState {
  const b = bag(raw);
  const attemptsUsed = num(b['attemptsUsed'], 0);
  return {
    attemptsUsed,
    attemptsRemaining: num(b['attemptsRemaining'], Math.max(0, 5 - attemptsUsed)),
    locked: bool(b['locked']),
  };
}

function normalisePayment(raw: unknown): ActiveOrderPayment {
  const b = bag(raw);
  return {
    method: readPaymentMethod(b['method']),
    status: readPaymentStatus(b['status']),
    codAmountPaise: num(b['codAmountPaise'], 0),
  };
}

export function normaliseActiveOrder(raw: unknown): ActiveOrder | null {
  const b = bag(raw);
  // The API answers 200 with an EMPTY BODY when the rider has no job, which
  // `apiFetch` hands back as `undefined`. That is "no job", not a failure.
  const orderId = str(b['orderId']);
  if (orderId === '') return null;

  const items = Array.isArray(b['items']) ? b['items'] : [];
  return {
    orderId,
    orderNo: str(b['orderNo']),
    status: readStatus(b['status']),
    assignmentId: nullableStr(b['assignmentId']),
    placedAt: str(b['placedAt']),
    pickup: waypoint(b['pickup'], 'Pickup'),
    drop: waypoint(b['drop'], 'Drop'),
    customerName: nullableStr(b['customerName']),
    customerPhone: str(b['customerPhone']),
    items: items.map(normaliseItem),
    itemCount: num(b['itemCount'], items.length),
    payment: normalisePayment(b['payment']),
    distanceKm: nullableNum(b['distanceKm']),
    etaMinutes: nullableNum(b['etaMinutes']),
    payoutPaise: num(b['payoutPaise'], 0),
    otp: normaliseOtp(b['otp']),
  };
}

function normaliseHistoryRow(raw: unknown): DeliveryHistoryRow | null {
  const b = bag(raw);
  const orderId = str(b['orderId']);
  if (orderId === '') return null;

  return {
    orderId,
    orderNo: str(b['orderNo']),
    status: readStatus(b['status']),
    deliveredAt: nullableStr(b['deliveredAt']),
    city: str(b['city']),
    pincode: str(b['pincode']),
    distanceKm: nullableNum(b['distanceKm']),
    payoutPaise: num(b['payoutPaise'], 0),
    codCollectedPaise: num(b['codCollectedPaise'], 0),
  };
}

function normaliseEarningsDay(raw: unknown): EarningsDay {
  const b = bag(raw);
  return {
    date: str(b['date']),
    deliveries: num(b['deliveries'], 0),
    payoutPaise: num(b['payoutPaise'], 0),
  };
}

export function normaliseEarnings(raw: unknown): EarningsSummary {
  const b = bag(raw);
  const byDay = Array.isArray(b['byDay']) ? b['byDay'].map(normaliseEarningsDay) : [];
  return {
    from: str(b['from']),
    to: str(b['to']),
    deliveries: num(b['deliveries'], 0),
    payoutPaise: num(b['payoutPaise'], 0),
    codCollectedPaise: num(b['codCollectedPaise'], 0),
    byDay,
  };
}

/** `{ data, meta }` — the envelope every list endpoint returns. */
function unwrapList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const data = bag(raw)['data'];
  return Array.isArray(data) ? data : [];
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function fetchProfile(signal?: AbortSignal): Promise<RiderProfile | null> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.me, { signal });
  return normaliseProfile(raw);
}

export async function fetchOffers(signal?: AbortSignal): Promise<Offer[]> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.offers, { signal });
  const out: Offer[] = [];
  for (const row of unwrapList(raw)) {
    const offer = normaliseOffer(row);
    if (offer !== null) out.push(offer);
  }
  return out;
}

/**
 * The job in hand.
 *
 * Two shapes mean "nothing right now" and BOTH are normal, not errors:
 *   · 200 with an empty body — what the API actually does today
 *   · 404                    — a rider with no partner row at all
 * Either way this resolves to `null` and the screen shows the calm waiting
 * state. Anything else throws and is handled as a real failure upstream.
 */
export async function fetchActiveOrder(signal?: AbortSignal): Promise<ActiveOrder | null> {
  try {
    const raw = await api.get<unknown>(DELIVERY_PATHS.activeOrder, { signal });
    return normaliseActiveOrder(raw);
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 404 && !cause.isNetworkError) {
      return null;
    }
    throw cause;
  }
}

export async function fetchHistory(signal?: AbortSignal): Promise<DeliveryHistoryRow[]> {
  // `page` and `limit` ONLY. `status` and `sort` are not on this DTO and an
  // unknown query parameter is a hard 400, not an ignored extra.
  const raw = await api.get<unknown>(DELIVERY_PATHS.history, {
    query: { page: 1, limit: HISTORY_PAGE_SIZE },
    signal,
  });
  const out: DeliveryHistoryRow[] = [];
  for (const row of unwrapList(raw)) {
    const entry = normaliseHistoryRow(row);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/**
 * Earnings over a window. Both bounds are optional ISO-8601; omitting them
 * gives the API's own default of the last 30 days, which is what this app
 * wants, so nothing is sent.
 */
export async function fetchEarnings(signal?: AbortSignal): Promise<EarningsSummary> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.earnings, { signal });
  return normaliseEarnings(raw);
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Go online / offline. The API answers with the WHOLE profile, so the toggle
 * never has to assume what it just did — a rider carrying an order is refused
 * with 409 and the profile that comes back is the one that is really true.
 */
export async function setAvailability(next: AvailabilityInput): Promise<RiderProfile | null> {
  const raw = await api.patch<unknown>(DELIVERY_PATHS.availability, next);
  return normaliseProfile(raw);
}

/**
 * Accept / reject carry an `Idempotency-Key`. A rider on a flaky connection
 * WILL double-tap, and accepting the same assignment twice must not produce
 * two jobs.
 */
function idempotent(key: string): RequestOptions {
  return { idempotencyKey: key };
}

/** Accept returns the full active order — the job the rider just took. */
export async function acceptOffer(
  assignmentId: string,
  key: string,
): Promise<ActiveOrder | null> {
  const raw = await api.post<unknown>(
    DELIVERY_PATHS.acceptOffer(assignmentId),
    undefined,
    idempotent(key),
  );
  return normaliseActiveOrder(raw);
}

/**
 * Reject returns the rider's REMAINING offers, so the queue is replaced from
 * the response rather than patched locally and re-fetched.
 *
 * `reason` is optional and must be 3–200 characters when sent. An empty body
 * is valid; a `{ reason: '' }` is a 400, so nothing is sent unless it is real.
 */
export async function rejectOffer(
  assignmentId: string,
  key: string,
  reason?: string,
): Promise<Offer[]> {
  const trimmed = reason?.trim() ?? '';
  const body = trimmed.length >= 3 ? { reason: trimmed.slice(0, 200) } : {};
  const raw = await api.post<unknown>(
    DELIVERY_PATHS.rejectOffer(assignmentId),
    body,
    idempotent(key),
  );
  const out: Offer[] = [];
  for (const row of unwrapList(raw)) {
    const offer = normaliseOffer(row);
    if (offer !== null) out.push(offer);
  }
  return out;
}

/** Every transition answers with the refreshed active order. */
export async function markPickedUp(orderId: string): Promise<ActiveOrder | null> {
  const raw = await api.patch<unknown>(DELIVERY_PATHS.pickedUp(orderId));
  return normaliseActiveOrder(raw);
}

export async function markOutForDelivery(orderId: string): Promise<ActiveOrder | null> {
  const raw = await api.patch<unknown>(DELIVERY_PATHS.outForDelivery(orderId));
  return normaliseActiveOrder(raw);
}

/**
 * The final transition. `otp` is passed straight through to the request body
 * and is not retained anywhere in this app — see the file header.
 *
 * `photoUrl` is deliberately NOT a parameter. The API accepts one, but there
 * is no endpoint anywhere that turns a captured photo into a URL, so a
 * parameter here would be an invitation to send a blob URL that the API would
 * reject with 400. See `PhotoProof.tsx` for the missing endpoint.
 */
export async function deliverOrder(orderId: string, otp: string): Promise<ActiveOrder | null> {
  const raw = await api.post<unknown>(DELIVERY_PATHS.deliver(orderId), { otp });
  return normaliseActiveOrder(raw);
}

export async function failDelivery(
  orderId: string,
  reason: string,
): Promise<ActiveOrder | null> {
  const raw = await api.post<unknown>(DELIVERY_PATHS.failed(orderId), { reason });
  return normaliseActiveOrder(raw);
}

/* ------------------------------------------------------------------ */
/* The OTP failure body                                                */
/* ------------------------------------------------------------------ */

/**
 * What a rejected OTP tells us.
 *
 * The API puts the counter in the RFC 7807 body's `errors` key — the one extra
 * key its exception filter forwards — as `{ attemptsRemaining, locked }`.
 * Those are a NUMBER and a BOOLEAN, while `ProblemDetails.errors` is typed as
 * the form-validation shape `Record<string, string[]>`. So the value is read
 * back through `unknown` rather than trusted, which is also the honest
 * spelling: it is a foreign body, not a form.
 *
 *   400 → wrong code, `attemptsRemaining` counts down
 *   423 → LOCKED. Only an admin can move this order now.
 */
export interface OtpFailure {
  attemptsRemaining: number | null;
  locked: boolean;
}

export function readOtpFailure(cause: unknown): OtpFailure | null {
  if (!(cause instanceof ApiError)) return null;
  if (cause.status !== 400 && cause.status !== 423) return null;

  const errors: unknown = cause.problem.errors;
  const raw = bag(errors);
  return {
    attemptsRemaining: nullableNum(raw['attemptsRemaining']),
    // A 423 is a lock whatever the body says.
    locked: cause.status === 423 || bool(raw['locked']),
  };
}

/* ------------------------------------------------------------------ */
/* Location                                                            */
/* ------------------------------------------------------------------ */

/**
 * One position report.
 *
 * ONE fix per request, with only the four properties the DTO whitelists.
 * There is no batch endpoint: a queued backlog is flushed newest-first by the
 * caller, because the customer's map wants where the rider IS, not where they
 * were four fixes ago.
 *
 * The API answers 400 with "No order is out for delivery" whenever nothing is
 * in flight. That is expected, not an error to surface — `tracking.ts` only
 * runs this while the order is OUT_FOR_DELIVERY, and a race at the end of a
 * delivery must not put a red banner over "Delivered".
 */
export async function postLocation(ping: LocationPing): Promise<LocationAck | null> {
  const body: LocationPing = {
    lat: ping.lat,
    lng: ping.lng,
    ...(ping.accuracy === undefined ? {} : { accuracy: ping.accuracy }),
    ...(ping.heading === undefined ? {} : { heading: ping.heading }),
  };
  const raw = await api.post<unknown>(DELIVERY_PATHS.location, body, {
    // A dropped ping is worth nothing five seconds later; the next one is
    // already on its way. Fail fast rather than queueing a stale fix behind
    // the 20s default timeout.
    timeoutMs: 8_000,
  });
  const b = bag(raw);
  if (b['accepted'] !== true) return null;
  return {
    accepted: true,
    at: str(b['at']),
    orderId: str(b['orderId']),
    etaMinutes: nullableNum(b['etaMinutes']),
  };
}
