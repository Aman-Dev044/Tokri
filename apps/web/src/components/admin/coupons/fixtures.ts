/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * Backs `/admin/coupons` when that endpoint cannot be reached, always behind
 * the amber banner.
 *
 * ── UNITS, CAREFULLY ────────────────────────────────────────────────────────
 * `type: 'flat'`    → `value` is INTEGER PAISE off the order.
 * `type: 'percent'` → `value` is a PERCENTAGE (1–100), and `maxDiscountPaise`
 *                     is required, because an uncapped percentage on a large
 *                     basket is an unbounded liability.
 * `minOrderPaise` and `maxDiscountPaise` are always paise.
 */

export type CouponType = 'flat' | 'percent';

export interface CouponRow {
  id: string;
  code: string;
  type: CouponType;
  /** paise for `flat`, a 1–100 percentage for `percent` */
  value: number;
  minOrderPaise: number;
  /** required for `percent`; null is only valid for `flat` */
  maxDiscountPaise: number | null;
  usageLimit: number | null;
  usedCount: number;
  perUserLimit: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  /** null ⇒ platform-wide */
  vendorId: string | null;
  vendorName: string | null;
}

/** The editable slice — exactly what the drawer writes back. */
export interface CouponDraft {
  code: string;
  type: CouponType;
  value: number;
  minOrderPaise: number;
  maxDiscountPaise: number | null;
  usageLimit: number | null;
  perUserLimit: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
}

export const COUPONS_FIXTURE: readonly CouponRow[] = [
  {
    id: 'cpn_01',
    code: 'MANDI100',
    type: 'flat',
    value: 10_000,
    minOrderPaise: 49_900,
    maxDiscountPaise: null,
    usageLimit: 5_000,
    usedCount: 3_812,
    perUserLimit: 1,
    validFrom: '2026-09-01T00:00:00+05:30',
    validTo: '2026-09-30T23:59:59+05:30',
    isActive: true,
    vendorId: null,
    vendorName: null,
  },
  {
    id: 'cpn_02',
    code: 'FRESH20',
    type: 'percent',
    value: 20,
    minOrderPaise: 29_900,
    maxDiscountPaise: 15_000,
    usageLimit: 10_000,
    usedCount: 9_740,
    perUserLimit: 2,
    validFrom: '2026-08-15T00:00:00+05:30',
    validTo: '2026-10-15T23:59:59+05:30',
    isActive: true,
    vendorId: null,
    vendorName: null,
  },
  {
    id: 'cpn_03',
    code: 'NANDINI50',
    type: 'flat',
    value: 5_000,
    minOrderPaise: 39_900,
    maxDiscountPaise: null,
    usageLimit: 2_000,
    usedCount: 411,
    perUserLimit: 3,
    validFrom: '2026-09-10T00:00:00+05:30',
    validTo: '2026-12-31T23:59:59+05:30',
    isActive: true,
    vendorId: 'ven_02',
    vendorName: 'Nandini Fresh, HSR',
  },
  {
    id: 'cpn_04',
    code: 'WELCOME15',
    type: 'percent',
    value: 15,
    minOrderPaise: 19_900,
    maxDiscountPaise: 10_000,
    usageLimit: null,
    usedCount: 24_183,
    perUserLimit: 1,
    validFrom: '2026-01-01T00:00:00+05:30',
    validTo: '2026-12-31T23:59:59+05:30',
    isActive: true,
    vendorId: null,
    vendorName: null,
  },
  {
    id: 'cpn_05',
    code: 'MONSOON25',
    type: 'percent',
    value: 25,
    minOrderPaise: 59_900,
    maxDiscountPaise: 20_000,
    usageLimit: 3_000,
    usedCount: 3_000,
    perUserLimit: 1,
    validFrom: '2026-06-01T00:00:00+05:30',
    validTo: '2026-08-31T23:59:59+05:30',
    isActive: true,
    vendorId: null,
    vendorName: null,
  },
  {
    id: 'cpn_06',
    code: 'DIWALI500',
    type: 'flat',
    value: 50_000,
    minOrderPaise: 2_49_900,
    maxDiscountPaise: null,
    usageLimit: 1_000,
    usedCount: 0,
    perUserLimit: 1,
    validFrom: '2026-10-25T00:00:00+05:30',
    validTo: '2026-11-05T23:59:59+05:30',
    isActive: true,
    vendorId: null,
    vendorName: null,
  },
  {
    id: 'cpn_07',
    code: 'TESTDROP',
    type: 'flat',
    value: 2_500,
    minOrderPaise: 0,
    maxDiscountPaise: null,
    usageLimit: 100,
    usedCount: 17,
    perUserLimit: 1,
    validFrom: '2026-07-01T00:00:00+05:30',
    validTo: '2026-09-30T23:59:59+05:30',
    isActive: false,
    vendorId: null,
    vendorName: null,
  },
  {
    id: 'cpn_08',
    code: 'SAHYADRI10',
    type: 'percent',
    value: 10,
    minOrderPaise: 24_900,
    maxDiscountPaise: 7_500,
    usageLimit: 1_500,
    usedCount: 1_122,
    perUserLimit: 4,
    validFrom: '2026-09-05T00:00:00+05:30',
    validTo: '2026-10-05T23:59:59+05:30',
    isActive: true,
    vendorId: 'ven_07',
    vendorName: 'Sahyadri Kirana',
  },
];

export const BLANK_COUPON: CouponDraft = {
  code: '',
  type: 'flat',
  value: 0,
  minOrderPaise: 0,
  maxDiscountPaise: null,
  usageLimit: null,
  perUserLimit: 1,
  validFrom: '',
  validTo: '',
  isActive: true,
};

export type CouponState = 'scheduled' | 'live' | 'expired' | 'exhausted' | 'disabled';

/**
 * The state an admin actually cares about, derived rather than stored — a
 * coupon with `isActive: true` whose window closed yesterday is not "active".
 */
export function couponState(row: CouponRow, now: number): CouponState {
  if (!row.isActive) return 'disabled';
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) return 'exhausted';
  if (now < Date.parse(row.validFrom)) return 'scheduled';
  if (now > Date.parse(row.validTo)) return 'expired';
  return 'live';
}

export const COUPON_STATE_LABEL: Readonly<Record<CouponState, string>> = {
  scheduled: 'Scheduled',
  live: 'Live',
  expired: 'Expired',
  exhausted: 'Exhausted',
  disabled: 'Disabled',
};
