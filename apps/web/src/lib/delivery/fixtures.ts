/**
 * Sample rider data — NEVER presented as real.
 *
 * Worker C's `/delivery/*` endpoints are landing alongside this app, so every
 * screen would otherwise be an error state and none of it would be reviewable.
 * The rule that makes this safe is absolute and is enforced at the call site,
 * not here:
 *
 *   whenever these rows are on screen, `<FixtureBanner>` is on screen.
 *
 * Every id is prefixed `sample-` and every name says "Sample" so that a
 * screenshot taken without the banner still reads as fake. A rider must never
 * ride to a fixture address, and must never believe a fixture payout.
 */

import type {
  ActiveJob,
  Availability,
  EarningsSummary,
  HistoryEntry,
  Offer,
} from './types';

/** Bengaluru, roughly — far enough apart to make the distances plausible. */
const STORE = {
  label: 'Sample Store — Anand Kirana',
  address: 'SAMPLE DATA · 14, 6th Cross, Indiranagar, Bengaluru 560038',
  point: { lat: 12.9784, lng: 77.6408 },
  phone: '+910000000000',
} as const;

const DROP = {
  label: 'Sample Drop — Flat 402, Sunrise Apartments',
  address: 'SAMPLE DATA · 88, 12th Main, Domlur, Bengaluru 560071',
  point: { lat: 12.9611, lng: 77.6387 },
  note: 'Sample note — second gate, ring the bell twice.',
} as const;

/**
 * A live offer has to expire, so this is a factory rather than a constant:
 * a frozen `expiresAt` in the past would render a permanently-dead countdown
 * and hide the one interaction the offers screen exists to demonstrate.
 */
export function sampleOffer(nowMs: number = Date.now()): Offer {
  return {
    assignmentId: 'sample-assignment-1',
    orderId: 'sample-order-1',
    orderNo: 'SAMPLE-4417',
    pickup: { ...STORE },
    drop: { ...DROP },
    payoutPaise: 4_200,
    distanceMeters: 2_900,
    itemCount: 7,
    expiresAt: new Date(nowMs + 45_000).toISOString(),
    codAmountPaise: 78_500,
  };
}

export function sampleOffers(nowMs: number = Date.now()): Offer[] {
  return [sampleOffer(nowMs)];
}

export const SAMPLE_ACTIVE_JOB: ActiveJob = {
  orderId: 'sample-order-1',
  orderNo: 'SAMPLE-4417',
  status: 'ASSIGNED',
  pickup: { ...STORE },
  drop: { ...DROP },
  items: [
    { id: 'sample-i1', name: 'Sample — Tomatoes', qty: 2, unit: 'kg' },
    { id: 'sample-i2', name: 'Sample — Toned milk 1L', qty: 3, unit: 'pc' },
    { id: 'sample-i3', name: 'Sample — Atta 5kg', qty: 1, unit: 'pc' },
    { id: 'sample-i4', name: 'Sample — Bananas', qty: 1, unit: 'dozen' },
  ],
  payoutPaise: 4_200,
  distanceMeters: 2_900,
  codAmountPaise: 78_500,
  customerName: 'Sample Customer',
  customerPhone: '+910000000000',
  otpAttemptsRemaining: 5,
  etaMinutes: 18,
  assignedAt: new Date().toISOString(),
};

export const SAMPLE_AVAILABILITY: Availability = { isOnline: false, isAvailable: false };

function isoDaysAgo(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 15, 0, 0);
  return d.toISOString();
}

export const SAMPLE_HISTORY: HistoryEntry[] = [
  {
    orderId: 'sample-h1',
    orderNo: 'SAMPLE-4390',
    completedAt: isoDaysAgo(0, 13),
    status: 'DELIVERED',
    payoutPaise: 3_800,
    distanceMeters: 2_100,
    dropLabel: 'Sample — Koramangala 5th Block',
    codCollectedPaise: 45_000,
  },
  {
    orderId: 'sample-h2',
    orderNo: 'SAMPLE-4382',
    completedAt: isoDaysAgo(0, 11),
    status: 'DELIVERED',
    payoutPaise: 4_500,
    distanceMeters: 3_600,
    dropLabel: 'Sample — HSR Layout Sector 2',
    codCollectedPaise: null,
  },
  {
    orderId: 'sample-h3',
    orderNo: 'SAMPLE-4361',
    completedAt: isoDaysAgo(1, 19),
    status: 'DELIVERY_FAILED',
    payoutPaise: 1_500,
    distanceMeters: 2_800,
    dropLabel: 'Sample — Ejipura Main Road',
    codCollectedPaise: null,
  },
  {
    orderId: 'sample-h4',
    orderNo: 'SAMPLE-4344',
    completedAt: isoDaysAgo(1, 16),
    status: 'DELIVERED',
    payoutPaise: 5_200,
    distanceMeters: 4_400,
    dropLabel: 'Sample — Sarjapur Road',
    codCollectedPaise: 112_000,
  },
  {
    orderId: 'sample-h5',
    orderNo: 'SAMPLE-4310',
    completedAt: isoDaysAgo(2, 12),
    status: 'DELIVERED',
    payoutPaise: 3_600,
    distanceMeters: 1_900,
    dropLabel: 'Sample — Old Airport Road',
    codCollectedPaise: null,
  },
];

function dayKey(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const SAMPLE_EARNINGS: EarningsSummary = {
  todayPaise: 8_300,
  todayDeliveries: 2,
  weekPaise: 46_700,
  weekDeliveries: 12,
  unpaidPaise: 46_700,
  nextPayoutAt: undefined,
  days: [
    { date: dayKey(0), deliveries: 2, payoutPaise: 8_300, tipsPaise: 0, distanceMeters: 5_700 },
    { date: dayKey(1), deliveries: 3, payoutPaise: 11_300, tipsPaise: 2_000, distanceMeters: 9_100 },
    { date: dayKey(2), deliveries: 1, payoutPaise: 3_600, tipsPaise: 0, distanceMeters: 1_900 },
    { date: dayKey(3), deliveries: 2, payoutPaise: 7_900, tipsPaise: 1_000, distanceMeters: 6_200 },
    { date: dayKey(4), deliveries: 0, payoutPaise: 0, tipsPaise: 0, distanceMeters: 0 },
    { date: dayKey(5), deliveries: 2, payoutPaise: 8_100, tipsPaise: 0, distanceMeters: 5_400 },
    { date: dayKey(6), deliveries: 2, payoutPaise: 7_500, tipsPaise: 500, distanceMeters: 4_800 },
  ],
};
