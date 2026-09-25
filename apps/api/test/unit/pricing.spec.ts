import {
  ApplicableCoupon,
  GST_PCT,
  computeDiscount,
  computePricing,
  percentOf,
  subtotalOf,
} from '../../src/modules/shop/pricing/pricing';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ORDER ARITHMETIC
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every assertion here is an exact integer. Not `toBeCloseTo`, not a
 * rounded comparison — the whole point of storing money as integer paise
 * is that the answer is exact, and a test that tolerates drift would let
 * the drift in.
 */

/** The platform defaults, so a case reads as the numbers a customer sees. */
const SETTINGS = {
  deliveryFeePaise: 2900, // ₹29
  freeDeliveryThresholdPaise: 49900, // ₹499
  gstPct: GST_PCT,
};

const flat = (value: number, vendorFunded = false): ApplicableCoupon => ({
  type: 'flat',
  value,
  maxDiscount: null,
  vendorFunded,
});

const percent = (
  value: number,
  maxDiscount: number | null = null,
  vendorFunded = false,
): ApplicableCoupon => ({
  type: 'percent',
  value,
  maxDiscount,
  vendorFunded,
});

describe('percentOf', () => {
  it('multiplies before dividing, so nothing drifts', () => {
    // 5% of ₹149.50. `14950 * 0.05` in floating point is
    // 747.5000000000001; multiply-then-divide gives exactly 747.5, which
    // rounds to 748.
    expect(percentOf(14950, 5)).toBe(748);
  });

  it('returns whole paise for every input in a realistic range', () => {
    for (let paise = 0; paise <= 200_000; paise += 137) {
      const tax = percentOf(paise, 5);
      expect(Number.isInteger(tax)).toBe(true);
    }
  });

  it('is exact on the classic float-error amounts', () => {
    // 0.1 + 0.2 territory: ₹0.10 and ₹0.20 are 10 and 20 paise, and
    // integer arithmetic has nothing to say about it.
    expect(percentOf(10, 5)).toBe(1); // 0.5 → 1 (round half up)
    expect(percentOf(20, 5)).toBe(1);
    expect(percentOf(30, 5)).toBe(2); // 1.5 → 2
  });
});

describe('subtotalOf', () => {
  it('sums price × qty in paise', () => {
    expect(
      subtotalOf([
        { price: 4900, qty: 2 }, // ₹98.00
        { price: 12550, qty: 1 }, // ₹125.50
        { price: 999, qty: 3 }, // ₹29.97
      ]),
    ).toBe(9800 + 12550 + 2997);
  });

  it('rejects a fractional price rather than silently rounding it', () => {
    // A float price is a bug upstream — in a seed, a migration or an
    // admin form. Rounding it here would hide the bug in a report that
    // is off by a few paise a month later.
    expect(() => subtotalOf([{ price: 49.5, qty: 1 }])).toThrow(
      /integer number of paise/,
    );
  });

  it('rejects a zero or negative quantity', () => {
    expect(() => subtotalOf([{ price: 100, qty: 0 }])).toThrow(
      /positive integer/,
    );
  });
});

describe('computeDiscount', () => {
  it('takes a flat coupon off at face value', () => {
    expect(computeDiscount(50_000, flat(10_000))).toBe(10_000);
  });

  it('rounds a percent coupon DOWN, never in the customer\'s favour by a paisa the books cannot explain', () => {
    // 10% of ₹123.45 is 1234.5 paise.
    expect(computeDiscount(12_345, percent(10))).toBe(1234);
  });

  it('honours maxDiscount — an uncapped percent coupon is an unbounded liability', () => {
    // 50% off a ₹12,000 bulk order would be ₹6,000 without the cap.
    expect(computeDiscount(1_200_000, percent(50, 20_000))).toBe(20_000);
  });

  it('never discounts more than the basket', () => {
    // Otherwise grandTotal goes negative and the platform pays the
    // customer to shop.
    expect(computeDiscount(5_000, flat(50_000))).toBe(5_000);
  });

  it('is zero with no coupon', () => {
    expect(computeDiscount(50_000, null)).toBe(0);
  });
});

describe('computePricing', () => {
  it('prices a simple basket end to end', () => {
    const result = computePricing({
      lines: [
        { price: 4900, qty: 2 }, // ₹98.00
        { price: 12550, qty: 1 }, // ₹125.50
      ],
      coupon: null,
      ...SETTINGS,
      commissionPct: 12,
    });

    const subtotal = 9800 + 12550; // 22350
    expect(result.itemsSubtotal).toBe(subtotal);
    expect(result.discount).toBe(0);
    // Below the ₹499 free-delivery threshold.
    expect(result.deliveryFee).toBe(2900);
    expect(result.taxes).toBe(percentOf(subtotal, 5)); // 1118
    expect(result.grandTotal).toBe(subtotal + 2900 + 1118);
    expect(result.grandTotal).toBe(26_368);
  });

  it('waives delivery at or above the threshold, measured AFTER the discount', () => {
    const above = computePricing({
      lines: [{ price: 50_000, qty: 1 }], // ₹500
      coupon: null,
      ...SETTINGS,
      commissionPct: 10,
    });
    expect(above.deliveryFee).toBe(0);

    // The same basket with a coupon that drops it below ₹499: the
    // discount must not buy free delivery it did not earn.
    const below = computePricing({
      lines: [{ price: 50_000, qty: 1 }],
      coupon: flat(5_000),
      ...SETTINGS,
      commissionPct: 10,
    });
    expect(below.deliveryFee).toBe(2900);
  });

  it('charges GST on the taxable value — subtotal minus discount', () => {
    const result = computePricing({
      lines: [{ price: 20_000, qty: 1 }],
      coupon: flat(5_000),
      ...SETTINGS,
      commissionPct: 10,
    });

    expect(result.discount).toBe(5_000);
    expect(result.taxes).toBe(percentOf(15_000, 5)); // 750, not 1000
    expect(result.taxes).toBe(750);
  });

  it('snapshots the commission rate onto the result', () => {
    const result = computePricing({
      lines: [{ price: 100_000, qty: 1 }],
      coupon: null,
      ...SETTINGS,
      commissionPct: 12.5,
    });

    // The RATE is copied, not just the amount: a later change to the
    // vendor's rate must never be able to re-derive this order.
    expect(result.commissionPct).toBe(12.5);
    expect(result.commissionAmount).toBe(12_500);
    expect(result.vendorPayout).toBe(100_000 - 12_500);
  });

  it('leaves the vendor whole when the PLATFORM funded the coupon', () => {
    const result = computePricing({
      lines: [{ price: 100_000, qty: 1 }],
      coupon: flat(10_000, false),
      ...SETTINGS,
      commissionPct: 10,
    });

    // §5.1: vendorPayout = itemsSubtotal − commissionAmount. A
    // platform-wide promotion is a platform marketing cost, and the
    // vendor sold ₹1,000 of groceries either way.
    expect(result.vendorPayout).toBe(100_000 - 10_000);
    expect(result.discount).toBe(10_000);
  });

  it('charges the vendor for their OWN coupon', () => {
    const result = computePricing({
      lines: [{ price: 100_000, qty: 1 }],
      coupon: flat(10_000, true),
      ...SETTINGS,
      commissionPct: 10,
    });

    // A vendor-issued coupon comes off the vendor's payout — otherwise
    // any vendor could issue 90%-off codes at the platform's expense.
    expect(result.vendorPayout).toBe(100_000 - 10_000 - 10_000);
  });

  it('keeps every field an integer across a thousand awkward baskets', () => {
    for (let i = 1; i <= 1000; i++) {
      const result = computePricing({
        lines: [
          { price: 999 * i, qty: (i % 5) + 1 },
          { price: 1_237 + i, qty: (i % 3) + 1 },
        ],
        coupon: i % 2 === 0 ? percent(7, 25_000) : flat(333),
        ...SETTINGS,
        commissionPct: i % 20,
      });

      for (const [field, value] of Object.entries(result)) {
        if (field === 'commissionPct') continue; // a rate, may be fractional
        expect(Number.isInteger(value)).toBe(true);
      }

      // The accounting identity, on every single basket.
      expect(result.grandTotal).toBe(
        result.itemsSubtotal -
          result.discount +
          result.deliveryFee +
          result.taxes,
      );
      expect(result.grandTotal).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic — the preview and the charge cannot disagree', () => {
    const input = {
      lines: [{ price: 14_950, qty: 3 }],
      coupon: percent(15, 5_000),
      ...SETTINGS,
      commissionPct: 11,
    };

    expect(computePricing(input)).toEqual(computePricing(input));
  });
});
