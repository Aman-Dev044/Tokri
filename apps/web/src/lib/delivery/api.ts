/**
 * The rider surface's only door to the API (plan §6.2, DELIVERY block).
 *
 * Everything goes through the shared `api-client`, so the bearer token comes
 * from memory (§4.3), the refresh cookie rides along, and failures arrive as a
 * typed `ApiError` instead of a rejected promise of unknown shape.
 *
 * ── LIVE vs FIXTURE ─────────────────────────────────────────────────────────
 * Worker C is building these endpoints in parallel. Every function here calls
 * the REAL path. Nothing in this file knows about fixtures — the decision to
 * stand one in belongs to the hooks in `useRider.ts`, which also flip the flag
 * that puts the banner on screen. Keeping that split means a fixture can never
 * leak into a mutation.
 *
 * ── NORMALISATION, AND WHY IT IS DEFENSIVE ──────────────────────────────────
 * A response is not the declared type just because TypeScript says so. These
 * DTOs are still moving, and a rider staring at a white screen because
 * `drop.address` came back undefined is the worst possible failure on a
 * scooter. So every payload is walked once, and anything missing becomes an
 * honest blank rather than a crash.
 *
 * ── THE OTP ─────────────────────────────────────────────────────────────────
 * `deliverOrder()` takes the OTP and immediately posts it. It is never stored,
 * never put in a query string, never logged, and never echoed back into the
 * UI. The rider types what the customer reads aloud; nothing in this app ever
 * knows the correct value. The API holds it hashed (plan phase 6, item 7).
 */

import { api, type RequestOptions } from '@/lib/api-client';
import type {
  ActiveJob,
  Availability,
  EarningsDay,
  EarningsSummary,
  GeoPoint,
  HistoryEntry,
  JobItem,
  Offer,
  OrderStatus,
  Place,
} from './types';

/* ------------------------------------------------------------------ */
/* Paths — spelled out once (plan §6.2)                                */
/* ------------------------------------------------------------------ */

export const DELIVERY_PATHS = {
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

  /**
   * NOT in §6.2 yet. History and earnings are real rider needs but the plan's
   * DELIVERY block stops at `/delivery/location`. These are the paths this app
   * expects; if Worker C lands different ones, change them HERE and nothing
   * else moves. Until then they 404 and both screens run on labelled fixtures.
   * TODO(worker-c): confirm or rename these two.
   */
  history: '/delivery/orders',
  earnings: '/delivery/earnings',
} as const;

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

function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function point(value: unknown): GeoPoint | null {
  const p = bag(value);
  const lat = optNum(p['lat']);
  const lng = optNum(p['lng']);
  if (lat === undefined || lng === undefined) {
    // GeoJSON shape: { type: 'Point', coordinates: [lng, lat] } (plan §5.1).
    const coords = p['coordinates'];
    if (Array.isArray(coords) && coords.length >= 2) {
      const lng2 = optNum(coords[0]);
      const lat2 = optNum(coords[1]);
      if (lat2 !== undefined && lng2 !== undefined) return { lat: lat2, lng: lng2 };
    }
    return null;
  }
  return { lat, lng };
}

function place(value: unknown, fallbackLabel: string): Place {
  const p = bag(value);
  return {
    label: str(p['label'] ?? p['name'] ?? p['storeName'], fallbackLabel),
    address: str(p['address'] ?? p['line1'] ?? p['formatted'], ''),
    point: point(p['point'] ?? p['location'] ?? p['coordinates'] ?? p),
    phone: optStr(p['phone'] ?? p['contactPhone']),
    note: optStr(p['note'] ?? p['instructions'] ?? p['landmark']),
  };
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

function readStatus(value: unknown): OrderStatus {
  const text = str(value).toUpperCase();
  const found = ORDER_STATUSES.find((s) => s === text);
  // An unknown status must not be guessed into a step the rider can act on.
  // ASSIGNED is the least destructive reading: it shows the job, offers only
  // the pickup action, and the API rejects it with 409 if that is wrong.
  return found ?? 'ASSIGNED';
}

/** COD: a 0 is "prepaid", not "collect nothing". Both read as null here. */
function cod(value: unknown): number | null {
  const n = optNum(value);
  return n === undefined || n <= 0 ? null : n;
}

/** The API may say `payout`, `payoutPaise` or `earningPaise`. Accept all. */
function payout(b: Bag): number {
  return num(b['payoutPaise'] ?? b['payout'] ?? b['earningPaise'] ?? b['amount'], 0);
}

/* ------------------------------------------------------------------ */
/* Normalisers                                                         */
/* ------------------------------------------------------------------ */

export function normaliseOffer(raw: unknown): Offer | null {
  const b = bag(raw);
  const assignmentId = str(b['assignmentId'] ?? b['id'] ?? b['_id']);
  const orderId = str(b['orderId'] ?? b['order']);
  const expiresAt = str(b['expiresAt'] ?? b['expiresAtIso']);
  // Without these three the card cannot be acted on at all. Dropping it is
  // better than rendering a button that posts to `/offers/undefined/accept`.
  if (assignmentId === '' || orderId === '' || expiresAt === '') return null;

  return {
    assignmentId,
    orderId,
    orderNo: optStr(b['orderNo'] ?? b['orderNumber']),
    pickup: place(b['pickup'] ?? b['store'], 'Pickup'),
    drop: place(b['drop'] ?? b['dropoff'] ?? b['customerAddress'], 'Drop'),
    payoutPaise: payout(b),
    distanceMeters: optNum(b['distanceMeters'] ?? b['distance']),
    itemCount: optNum(b['itemCount']),
    expiresAt,
    codAmountPaise: cod(b['codAmountPaise'] ?? b['codAmount']),
  };
}

function normaliseItem(raw: unknown, index: number): JobItem {
  const b = bag(raw);
  return {
    id: str(b['id'] ?? b['_id'] ?? b['productId'], `item-${index}`),
    name: str(b['name'] ?? b['productName'] ?? b['title'], 'Item'),
    qty: num(b['qty'] ?? b['quantity'], 1),
    unit: optStr(b['unit']),
  };
}

export function normaliseActiveJob(raw: unknown): ActiveJob | null {
  const b = bag(raw);
  // `GET /delivery/orders/active` may answer 200 with null / {} when idle.
  const orderId = str(b['orderId'] ?? b['id'] ?? b['_id']);
  if (orderId === '') return null;

  const items = Array.isArray(b['items']) ? b['items'] : [];
  return {
    orderId,
    orderNo: optStr(b['orderNo'] ?? b['orderNumber']),
    status: readStatus(b['status']),
    pickup: place(b['pickup'] ?? b['store'] ?? b['vendor'], 'Pickup'),
    drop: place(b['drop'] ?? b['dropoff'] ?? b['deliveryAddress'], 'Drop'),
    items: items.map(normaliseItem),
    payoutPaise: payout(b),
    distanceMeters: optNum(b['distanceMeters'] ?? b['distance']),
    codAmountPaise: cod(b['codAmountPaise'] ?? b['codAmount']),
    customerName: optStr(b['customerName']),
    customerPhone: optStr(b['customerPhone'] ?? bag(b['customer'])['phone']),
    otpAttemptsRemaining: optNum(b['otpAttemptsRemaining'] ?? b['attemptsRemaining']),
    etaMinutes: optNum(b['etaMinutes'] ?? b['eta']),
    assignedAt: optStr(b['assignedAt']),
  };
}

function normaliseHistoryEntry(raw: unknown): HistoryEntry | null {
  const b = bag(raw);
  const orderId = str(b['orderId'] ?? b['id'] ?? b['_id']);
  if (orderId === '') return null;

  const dropBag = bag(b['drop'] ?? b['deliveryAddress']);
  return {
    orderId,
    orderNo: optStr(b['orderNo'] ?? b['orderNumber']),
    completedAt: str(
      b['completedAt'] ?? b['deliveredAt'] ?? b['updatedAt'],
      new Date(0).toISOString(),
    ),
    status: readStatus(b['status']) === 'DELIVERY_FAILED' ? 'DELIVERY_FAILED' : 'DELIVERED',
    payoutPaise: payout(b),
    distanceMeters: optNum(b['distanceMeters'] ?? b['distance']),
    dropLabel: str(dropBag['label'] ?? dropBag['address'], 'Delivery'),
    codCollectedPaise: cod(b['codCollectedPaise'] ?? b['codAmount']),
  };
}

function normaliseEarningsDay(raw: unknown): EarningsDay {
  const b = bag(raw);
  return {
    date: str(b['date'] ?? b['day']),
    deliveries: num(b['deliveries'] ?? b['count'], 0),
    payoutPaise: payout(b),
    tipsPaise: optNum(b['tipsPaise'] ?? b['tips']),
    codCollectedPaise: optNum(b['codCollectedPaise']),
    distanceMeters: optNum(b['distanceMeters'] ?? b['distance']),
  };
}

export function normaliseEarnings(raw: unknown): EarningsSummary {
  const b = bag(raw);
  const days = Array.isArray(b['days']) ? b['days'].map(normaliseEarningsDay) : [];
  return {
    todayPaise: num(b['todayPaise'] ?? b['today'], 0),
    todayDeliveries: num(b['todayDeliveries'], 0),
    weekPaise: num(b['weekPaise'] ?? b['week'], 0),
    weekDeliveries: num(b['weekDeliveries'], 0),
    unpaidPaise: num(b['unpaidPaise'] ?? b['pendingPaise'], 0),
    nextPayoutAt: optStr(b['nextPayoutAt']),
    days,
  };
}

/** Every list endpoint answers `{ data, meta }` (plan §6.1). */
function unwrapList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const b = bag(raw);
  return Array.isArray(b['data']) ? b['data'] : [];
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function fetchOffers(signal?: AbortSignal): Promise<Offer[]> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.offers, { signal });
  const out: Offer[] = [];
  for (const row of unwrapList(raw)) {
    const offer = normaliseOffer(row);
    if (offer !== null) out.push(offer);
  }
  return out;
}

export async function fetchActiveJob(signal?: AbortSignal): Promise<ActiveJob | null> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.activeOrder, { signal });
  // Some shapes wrap it: { data: {...} }. Try both before giving up.
  const direct = normaliseActiveJob(raw);
  if (direct !== null) return direct;
  return normaliseActiveJob(bag(raw)['data']);
}

export async function fetchHistory(signal?: AbortSignal): Promise<HistoryEntry[]> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.history, {
    query: { status: 'DELIVERED', limit: 50, sort: '-updatedAt' },
    signal,
  });
  const out: HistoryEntry[] = [];
  for (const row of unwrapList(raw)) {
    const entry = normaliseHistoryEntry(row);
    if (entry !== null) out.push(entry);
  }
  return out;
}

export async function fetchEarnings(signal?: AbortSignal): Promise<EarningsSummary> {
  const raw = await api.get<unknown>(DELIVERY_PATHS.earnings, { signal });
  return normaliseEarnings(raw);
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function setAvailability(next: Availability): Promise<void> {
  await api.patch<void>(DELIVERY_PATHS.availability, next);
}

/**
 * Accept / reject carry an `Idempotency-Key` (plan §6.1: every mutating
 * endpoint accepts one). A rider on a flaky connection WILL double-tap, and
 * accepting the same assignment twice must not produce two jobs.
 */
function idempotent(key: string): RequestOptions {
  return { idempotencyKey: key };
}

export async function acceptOffer(assignmentId: string, key: string): Promise<void> {
  await api.post<void>(
    DELIVERY_PATHS.acceptOffer(assignmentId),
    undefined,
    idempotent(key),
  );
}

export async function rejectOffer(assignmentId: string, key: string): Promise<void> {
  await api.post<void>(
    DELIVERY_PATHS.rejectOffer(assignmentId),
    undefined,
    idempotent(key),
  );
}

export async function markPickedUp(orderId: string): Promise<void> {
  await api.patch<void>(DELIVERY_PATHS.pickedUp(orderId));
}

export async function markOutForDelivery(orderId: string): Promise<void> {
  await api.patch<void>(DELIVERY_PATHS.outForDelivery(orderId));
}

/**
 * The final transition. `otp` is passed straight through to the request body
 * and is not retained anywhere in this app — see the file header.
 */
export async function deliverOrder(
  orderId: string,
  otp: string,
  photoUrl?: string,
): Promise<void> {
  await api.post<void>(DELIVERY_PATHS.deliver(orderId), {
    otp,
    ...(photoUrl === undefined ? {} : { photoUrl }),
  });
}

export async function failDelivery(orderId: string, reason: string): Promise<void> {
  await api.post<void>(DELIVERY_PATHS.failed(orderId), { reason });
}

/** One location fix, as the API expects it. */
export interface LocationFix {
  lat: number;
  lng: number;
  /** ISO of when the DEVICE took the fix, not when we managed to send it. */
  at: string;
  accuracy?: number;
}

/**
 * Location POST. Called only by `location.ts`, which owns the 10s throttle —
 * plan §6.2 says "every 10s" and that cadence is a cost and battery decision,
 * not a suggestion. Do not call this from a component.
 *
 * The body sends the newest fix at the top level (so an API that only reads
 * `{ lat, lng }` works unchanged) and the whole batch alongside it, because a
 * rider through a tunnel comes back with four queued fixes and throwing three
 * of them away loses the shape of the route.
 */
export async function postLocation(batch: readonly LocationFix[]): Promise<void> {
  const newest = batch[batch.length - 1];
  if (newest === undefined) return;
  await api.post<void>(
    DELIVERY_PATHS.location,
    { lat: newest.lat, lng: newest.lng, at: newest.at, fixes: [...batch] },
    {
      // A dropped ping is worth nothing five seconds later; the next one is
      // already on its way. Fail fast rather than queueing a stale fix behind
      // the 20s default timeout.
      timeoutMs: 8_000,
    },
  );
}
