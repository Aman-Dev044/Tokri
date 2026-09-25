/**
 * Sample rider data — NEVER presented as real.
 *
 * ── WHEN THIS IS ALLOWED ON SCREEN ──────────────────────────────────────────
 * ONLY on a genuine network failure: `ApiError.isNetworkError`, which covers
 * the API being unreachable, a CORS block and a timeout. That is the one case
 * where a rider gets a blank app through no fault of the code.
 *
 * A 400, a 404, a 403 or a 500 is a BUG, not a reason to show sample data.
 * Papering over a wrong query parameter with plausible rows is how a contract
 * mismatch survives a review — the earlier version of this app did exactly
 * that, and `/delivery/orders?status=DELIVERED` 404'd for weeks behind a
 * banner that looked like a known limitation.
 *
 * The rule that makes this safe is absolute and enforced at the call site:
 *
 *   whenever these rows are on screen, `<FixtureBanner>` is on screen.
 *
 * Every id is prefixed `sample-` and every name says "Sample" so that a
 * screenshot taken without the banner still reads as fake. A rider must never
 * ride to a fixture address, and must never believe a fixture payout.
 */

import type {
  ActiveOrder,
  DeliveryHistoryRow,
  EarningsSummary,
  Offer,
  Waypoint,
} from './types';

/** Bengaluru, roughly — far enough apart to make the distances plausible. */
const STORE: Waypoint = {
  label: 'Sample Store — Anand Kirana',
  address: 'SAMPLE DATA · 14, 6th Cross, Indiranagar, Bengaluru 560038',
  lat: 12.9784,
  lng: 77.6408,
};

const DROP: Waypoint = {
  label: 'Sample Drop — Flat 402, Sunrise Apartments',
  address: 'SAMPLE DATA · 88, 12th Main, Domlur, Bengaluru 560071',
  lat: 12.9611,
  lng: 77.6387,
};

/**
 * A live offer has to expire, so this is a factory rather than a constant:
 * a frozen `expiresAt` in the past would render a permanently-dead countdown
 * and hide the one interaction the offers screen exists to demonstrate.
 */
export function sampleOffer(nowMs: number = Date.now()): Offer {
  return {
    id: 'sample-assignment-1',
    orderId: 'sample-order-1',
    orderNo: 'SAMPLE-4417',
    attemptNo: 1,
    offeredAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + 45_000).toISOString(),
    expiresInMs: 45_000,
    pickup: { ...STORE },
    drop: { ...DROP },
    distanceKm: 2.9,
    itemCount: 7,
    codAmountPaise: 78_500,
    payoutPaise: 4_200,
  };
}

export function sampleOffers(nowMs: number = Date.now()): Offer[] {
  return [sampleOffer(nowMs)];
}

export const SAMPLE_ACTIVE_ORDER: ActiveOrder = {
  orderId: 'sample-order-1',
  orderNo: 'SAMPLE-4417',
  status: 'ASSIGNED',
  assignmentId: 'sample-assignment-1',
  placedAt: new Date(0).toISOString(),
  pickup: { ...STORE },
  drop: { ...DROP },
  customerName: 'Sample Customer',
  customerPhone: '+910000000000',
  items: [
    { name: 'Sample — Tomatoes', qty: 2, unit: 'kg', image: null },
    { name: 'Sample — Toned milk 1L', qty: 3, unit: 'pc', image: null },
    { name: 'Sample — Atta 5kg', qty: 1, unit: 'pc', image: null },
    { name: 'Sample — Bananas', qty: 1, unit: 'dozen', image: null },
  ],
  itemCount: 4,
  payment: { method: 'cod', status: 'pending', codAmountPaise: 78_500 },
  distanceKm: 2.9,
  etaMinutes: 18,
  payoutPaise: 4_200,
  otp: { attemptsUsed: 0, attemptsRemaining: 5, locked: false },
};

function isoDaysAgo(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

export const SAMPLE_HISTORY: DeliveryHistoryRow[] = [
  {
    orderId: 'sample-h1',
    orderNo: 'SAMPLE-4390',
    status: 'DELIVERED',
    deliveredAt: isoDaysAgo(0, 13),
    city: 'SAMPLE — Bengaluru',
    pincode: '560034',
    distanceKm: 2.1,
    payoutPaise: 3_800,
    codCollectedPaise: 45_000,
  },
  {
    orderId: 'sample-h2',
    orderNo: 'SAMPLE-4382',
    status: 'DELIVERED',
    deliveredAt: isoDaysAgo(0, 11),
    city: 'SAMPLE — Bengaluru',
    pincode: '560102',
    distanceKm: 3.6,
    payoutPaise: 4_500,
    codCollectedPaise: 0,
  },
  {
    orderId: 'sample-h3',
    orderNo: 'SAMPLE-4361',
    status: 'DELIVERY_FAILED',
    deliveredAt: null,
    city: 'SAMPLE — Bengaluru',
    pincode: '560047',
    distanceKm: 2.8,
    payoutPaise: 1_500,
    codCollectedPaise: 0,
  },
  {
    orderId: 'sample-h4',
    orderNo: 'SAMPLE-4344',
    status: 'DELIVERED',
    deliveredAt: isoDaysAgo(1, 16),
    city: 'SAMPLE — Bengaluru',
    pincode: '560035',
    distanceKm: 4.4,
    payoutPaise: 5_200,
    codCollectedPaise: 112_000,
  },
];

function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const SAMPLE_EARNINGS: EarningsSummary = {
  from: `${dayKey(6)}T00:00:00.000Z`,
  to: `${dayKey(0)}T23:59:59.999Z`,
  deliveries: 12,
  payoutPaise: 46_700,
  codCollectedPaise: 157_000,
  byDay: [
    { date: dayKey(6), deliveries: 2, payoutPaise: 7_500 },
    { date: dayKey(5), deliveries: 2, payoutPaise: 8_100 },
    { date: dayKey(4), deliveries: 0, payoutPaise: 0 },
    { date: dayKey(3), deliveries: 2, payoutPaise: 7_900 },
    { date: dayKey(2), deliveries: 1, payoutPaise: 3_600 },
    { date: dayKey(1), deliveries: 3, payoutPaise: 11_300 },
    { date: dayKey(0), deliveries: 2, payoutPaise: 8_300 },
  ],
};
