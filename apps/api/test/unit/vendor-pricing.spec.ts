import {
  FulfilmentLine,
  OrderPricingSnapshot,
  repriceForFulfilment,
} from '../../src/modules/vendor/orders/pricing.util';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  PARTIAL-FULFILMENT RE-PRICING  (locked decision #9)
 * ════════════════════════════════════════════════════════════════════════
 *
 * This is refund arithmetic: every case below is a number that either
 * leaves the platform or does not. It is deliberately a UNIT suite — the
 * function touches no database and no clock, so the awkward cases (a
 * coupon larger than what survives, a zero-subtotal order, everything
 * dropped) can be enumerated in milliseconds instead of being sampled
 * through an integration run.
 *
 * Every amount is INTEGER PAISE. `₹149.50` is `14950`.
 */

/** ₹1,000 of goods, ₹50 off, ₹30 delivery, 5% GST, 12% commission. */
const BASE: OrderPricingSnapshot = {
  itemsSubtotal: 100_000,
  discount: 5_000,
  deliveryFee: 3_000,
  taxes: 5_000,
  // 100000 − 5000 + 3000 + 5000
  grandTotal: 103_000,
  commissionPct: 12,
  commissionAmount: 12_000,
  vendorPayout: 88_000,
};

const lines = (...spec: [number, boolean][]): FulfilmentLine[] =>
  spec.map(([lineTotal, fulfilled]) => ({ lineTotal, fulfilled }));

describe('repriceForFulfilment', () => {
  // ══════════════════════════════════════════════════════════════════
  //  Nothing dropped
  // ══════════════════════════════════════════════════════════════════

  it('is a no-op when every line survives', () => {
    const result = repriceForFulfilment(
      BASE,
      lines([60_000, true], [40_000, true]),
    );

    expect(result.pricing).toEqual(BASE);
    expect(result.refundDelta).toBe(0);
    expect(result.payoutDelta).toBe(0);
    expect(result.droppedLineCount).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════
  //  The ordinary case
  // ══════════════════════════════════════════════════════════════════

  it('re-prices from the surviving lines and returns the refund delta', () => {
    // ₹400 of the ₹1,000 basket is missing.
    const result = repriceForFulfilment(
      BASE,
      lines([60_000, true], [40_000, false]),
    );

    // ratio = 60000 / 100000 = 0.6
    expect(result.pricing.itemsSubtotal).toBe(60_000);
    expect(result.pricing.discount).toBe(3_000); // 5000 × 0.6
    expect(result.pricing.taxes).toBe(3_000); // 5000 × 0.6
    expect(result.pricing.deliveryFee).toBe(3_000); // unchanged
    expect(result.pricing.commissionAmount).toBe(7_200); // 12% of 60000
    expect(result.pricing.vendorPayout).toBe(52_800); // 60000 − 7200
    expect(result.pricing.grandTotal).toBe(63_000); // 60000−3000+3000+3000

    expect(result.refundDelta).toBe(40_000); // 103000 − 63000
    expect(result.payoutDelta).toBe(35_200); // 88000 − 52800
    expect(result.droppedLineCount).toBe(1);
  });

  it('never re-reads the commission rate — the snapshot is the contract', () => {
    // Decision #6: the percentage is copied onto the order at checkout.
    // Re-deriving it here from the vendor's CURRENT rate would
    // retroactively re-price a live order, which is the difference
    // between a rate change and a re-billing.
    const result = repriceForFulfilment(
      BASE,
      lines([50_000, true], [50_000, false]),
    );

    expect(result.pricing.commissionPct).toBe(BASE.commissionPct);
    expect(result.pricing.commissionAmount).toBe(6_000); // 12% of 50000
  });

  it('leaves the delivery fee alone — the rider still rides', () => {
    // Decision #5: the delivery fee is PLATFORM revenue, not the
    // vendor's, so dropping a line does not reduce it.
    const result = repriceForFulfilment(
      BASE,
      lines([10_000, true], [90_000, false]),
    );

    expect(result.pricing.deliveryFee).toBe(BASE.deliveryFee);
  });

  // ══════════════════════════════════════════════════════════════════
  //  The coupon
  // ══════════════════════════════════════════════════════════════════

  it('scales the discount pro-rata so it can never exceed what is left', () => {
    // A ₹900 coupon on a ₹1,000 basket. Keeping it whole while the
    // basket shrinks to ₹100 would make the platform pay the customer.
    const generous: OrderPricingSnapshot = {
      ...BASE,
      discount: 90_000,
      grandTotal: 100_000 - 90_000 + 3_000 + 5_000,
    };

    const result = repriceForFulfilment(
      generous,
      lines([10_000, true], [90_000, false]),
    );

    expect(result.pricing.discount).toBe(9_000); // 90000 × 0.1
    expect(result.pricing.grandTotal).toBeGreaterThanOrEqual(0);
    expect(result.pricing.grandTotal).toBe(10_000 - 9_000 + 3_000 + 500);
  });

  // ══════════════════════════════════════════════════════════════════
  //  Rounding
  // ══════════════════════════════════════════════════════════════════

  it('rounds every derived amount to whole paise', () => {
    // A ratio of 1/3 — nothing here may produce a fractional paisa.
    const result = repriceForFulfilment(
      { ...BASE, itemsSubtotal: 99_999, grandTotal: 102_999 },
      lines([33_333, true], [66_666, false]),
    );

    for (const amount of Object.values(result.pricing)) {
      expect(Number.isInteger(amount)).toBe(true);
    }
    expect(Number.isInteger(result.refundDelta)).toBe(true);
    expect(Number.isInteger(result.payoutDelta)).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════
  //  Degenerate inputs
  // ══════════════════════════════════════════════════════════════════

  it('handles every line being dropped without producing a negative total', () => {
    // The service refuses this case with a 400 (an empty order is a
    // rejection, not a partial fulfilment) — but the arithmetic must
    // still be sane if it is ever reached.
    const result = repriceForFulfilment(
      BASE,
      lines([60_000, false], [40_000, false]),
    );

    expect(result.pricing.itemsSubtotal).toBe(0);
    expect(result.pricing.discount).toBe(0);
    expect(result.pricing.taxes).toBe(0);
    expect(result.pricing.commissionAmount).toBe(0);
    expect(result.pricing.vendorPayout).toBe(0);
    expect(result.pricing.grandTotal).toBe(BASE.deliveryFee);
    expect(result.refundDelta).toBe(BASE.grandTotal - BASE.deliveryFee);
    expect(result.droppedLineCount).toBe(2);
  });

  it('survives a zero-subtotal order without dividing by zero', () => {
    const free: OrderPricingSnapshot = {
      itemsSubtotal: 0,
      discount: 0,
      deliveryFee: 0,
      taxes: 0,
      grandTotal: 0,
      commissionPct: 12,
      commissionAmount: 0,
      vendorPayout: 0,
    };

    const result = repriceForFulfilment(free, lines([0, true]));

    expect(Number.isNaN(result.pricing.grandTotal)).toBe(false);
    expect(result.refundDelta).toBe(0);
  });

  it('clamps the ratio at 1 if the lines exceed the snapshot subtotal', () => {
    // A corrupted item array must not be able to inflate the discount
    // or the tax above what the customer was originally charged.
    const result = repriceForFulfilment(BASE, lines([500_000, true]));

    expect(result.pricing.discount).toBe(BASE.discount);
    expect(result.pricing.taxes).toBe(BASE.taxes);
    expect(result.refundDelta).toBe(0);
    expect(result.payoutDelta).toBe(0);
  });

  it('never reports a negative refund', () => {
    // Re-pricing can only ever remove lines. A "negative refund" would
    // be an invoice the customer never agreed to.
    const result = repriceForFulfilment(
      { ...BASE, grandTotal: 0 },
      lines([100_000, true]),
    );

    expect(result.refundDelta).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════
  //  The input is never mutated
  // ══════════════════════════════════════════════════════════════════

  it('leaves the original pricing snapshot untouched', () => {
    const original = { ...BASE };
    repriceForFulfilment(BASE, lines([10_000, true], [90_000, false]));
    expect(BASE).toEqual(original);
  });
});
