import {
  GST_PCT,
  computePricing,
  percentOf,
} from '../../src/modules/shop/pricing/pricing';
import {
  allocate,
  financialYear,
  formatInvoiceNo,
  istDayStart,
  priceCounterSale,
  storeCode,
} from '../../src/modules/vendor/pos/pos-pricing';
import {
  ALL_PERMISSIONS,
  Permission,
  STAFF_PRESETS,
  StaffRole,
  permissionsFor,
  permissionsForProfile,
} from '../../src/common/constants/permissions';
import { Role } from '../../src/common/constants/roles.enum';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  COUNTER ARITHMETIC + THE PERMISSION CATALOGUE
 * ════════════════════════════════════════════════════════════════════════
 *
 * Exact integers throughout, as in `pricing.spec.ts`: money is paise and
 * the answer is exact or it is wrong.
 */

describe('allocate (largest remainder)', () => {
  it('splits a total so the parts sum to it exactly', () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it('is proportional and deterministic', () => {
    expect(allocate(500, [8000, 2000])).toEqual([400, 100]);
    expect(allocate(7, [3, 3, 3, 3])).toEqual([2, 2, 2, 1]);
  });

  it('returns zeros for a zero total or zero weights', () => {
    expect(allocate(0, [10, 20])).toEqual([0, 0]);
    expect(allocate(50, [0, 0])).toEqual([0, 0]);
  });
});

describe('priceCounterSale', () => {
  it('charges GST exactly as the online checkout does', () => {
    const lines = [
      { price: 4_000, qty: 3 },
      { price: 2_499, qty: 1 },
    ];
    const online = computePricing({
      lines,
      coupon: null,
      deliveryFeePaise: 0,
      freeDeliveryThresholdPaise: 0,
      gstPct: GST_PCT,
      commissionPct: 0,
    });
    const counter = priceCounterSale(lines, 0);

    expect(counter.subtotal).toBe(14_499);
    expect(counter.taxes).toBe(online.taxes);
    expect(counter.taxes).toBe(percentOf(14_499, GST_PCT));
    expect(counter.grandTotal).toBe(14_499 + counter.taxes);
    expect(counter.gstRate).toBe(GST_PCT);
  });

  it('taxes the value after discount and caps the discount at the subtotal', () => {
    const lines = [{ price: 1_000, qty: 2 }];

    const discounted = priceCounterSale(lines, 500);
    expect(discounted.discount).toBe(500);
    expect(discounted.taxableValue).toBe(1_500);
    expect(discounted.taxes).toBe(percentOf(1_500, GST_PCT));

    const capped = priceCounterSale(lines, 999_999);
    expect(capped.discount).toBe(2_000);
    expect(capped.taxes).toBe(0);
    expect(capped.grandTotal).toBe(0);
  });

  it('line GST always sums to the invoice GST', () => {
    const counter = priceCounterSale(
      [
        { price: 333, qty: 1 },
        { price: 333, qty: 1 },
        { price: 334, qty: 1 },
      ],
      17,
    );
    expect(counter.lineGst.reduce((a, b) => a + b, 0)).toBe(counter.taxes);
  });
});

describe('financial year and invoice numbers', () => {
  it('rolls over at midnight IST on 1 April, not at UTC midnight', () => {
    // 31 Mar 2027 23:59 IST = 31 Mar 18:29 UTC
    expect(financialYear(new Date('2027-03-31T18:29:00Z'))).toBe('2026-27');
    // 1 Apr 2027 00:00 IST = 31 Mar 18:30 UTC
    expect(financialYear(new Date('2027-03-31T18:30:00Z'))).toBe('2027-28');
    expect(financialYear(new Date('2026-11-04T06:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00');
  });

  it('starts the IST day at 18:30 UTC the evening before', () => {
    expect(istDayStart(new Date('2026-11-04T10:00:00Z')).toISOString()).toBe(
      '2026-11-03T18:30:00.000Z',
    );
    expect(istDayStart(new Date('2026-11-04T19:00:00Z')).toISOString()).toBe(
      '2026-11-04T18:30:00.000Z',
    );
  });

  it('formats INV/<CODE>/<FY>/<6-digit seq>', () => {
    expect(formatInvoiceNo(storeCode('green-basket-pune', 'x'), '2026-27', 123)).toBe(
      'INV/GREENB/2026-27/000123',
    );
    expect(storeCode('-', '65f0c0ffee00000000abcdef')).toBe('ABCDEF');
  });
});

describe('permission catalogue', () => {
  it('gives the owner every permission and other roles none', () => {
    expect(permissionsFor(Role.VENDOR, null)).toEqual([...ALL_PERMISSIONS]);
    expect(permissionsFor(Role.CUSTOMER, null)).toEqual([]);
    expect(permissionsFor(Role.ADMIN, null)).toEqual([]);
  });

  it('MANAGER has everything except earnings.view', () => {
    const manager = STAFF_PRESETS[StaffRole.MANAGER];
    expect(manager).not.toContain(Permission.EARNINGS_VIEW);
    expect(manager).toHaveLength(ALL_PERMISSIONS.length - 1);
  });

  it('every preset is grantable by a MANAGER', () => {
    const manager = new Set(STAFF_PRESETS[StaffRole.MANAGER]);
    for (const preset of Object.values(STAFF_PRESETS)) {
      expect(preset.filter((p) => !manager.has(p))).toEqual([]);
    }
  });

  it('resolves a preset from code and CUSTOM from the stored list, dropping unknowns', () => {
    expect(
      permissionsForProfile({ staffRole: StaffRole.BILLER, permissions: [] }),
    ).toEqual([
      Permission.PRODUCTS_VIEW,
      Permission.BILLING_VIEW,
      Permission.BILLING_CREATE,
    ]);
    expect(
      permissionsForProfile({
        staffRole: StaffRole.CUSTOM,
        permissions: ['earnings.view', 'root.everything', 'orders.view'],
      }),
    ).toEqual([Permission.ORDERS_VIEW, Permission.EARNINGS_VIEW]);
    expect(permissionsFor(Role.STAFF, null)).toEqual([]);
  });
});
