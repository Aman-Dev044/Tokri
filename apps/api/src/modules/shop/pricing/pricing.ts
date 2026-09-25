/**
 * ════════════════════════════════════════════════════════════════════════
 *  ORDER ARITHMETIC — pure functions, INTEGER PAISE only
 * ════════════════════════════════════════════════════════════════════════
 *
 * Nothing in this file touches the database, the request or the clock. It
 * is the single place the money is worked out, which is why it is pure:
 * the same numbers are produced by `POST /checkout/validate` (a preview)
 * and by `POST /checkout` (the real thing), and a preview that disagrees
 * with the charge is the single most damaging bug a checkout can have.
 *
 * ── The one rule ────────────────────────────────────────────────────────
 * Every amount is an INTEGER NUMBER OF PAISE. ₹149.50 is 14950. There is
 * no float anywhere in this file, and no division that does not immediately
 * round back to an integer. Floating rupees produce settlement reports
 * that are off by a few paise per order and take a week to find.
 *
 * `Number.MAX_SAFE_INTEGER` is ~9.0e15; an intermediate `amount * pct`
 * here peaks at roughly 1e9 paise (₹10 crore) × 100, i.e. 1e11 — four
 * orders of magnitude inside the safe range, so the multiply-then-divide
 * below is exact rather than merely close.
 */

/** GST on prepared grocery baskets. Platform-wide in v1. */
export const GST_PCT = 5;

/** One line of the basket, priced. */
export interface PricedLine {
  /** INTEGER PAISE, the live catalogue price at pricing time. */
  price: number;
  qty: number;
}

/** A coupon that has ALREADY passed validation (window, caps, minimum). */
export interface ApplicableCoupon {
  type: 'flat' | 'percent';
  /** FLAT → paise off. PERCENT → whole percent, 1–100. */
  value: number;
  /** INTEGER PAISE. Required in practice for PERCENT. */
  maxDiscount: number | null;
  /**
   * True when the coupon belongs to the vendor rather than the platform.
   *
   * This decides who funds it — see `vendorPayout` below.
   */
  vendorFunded: boolean;
}

export interface PricingInput {
  lines: readonly PricedLine[];
  coupon: ApplicableCoupon | null;
  /** INTEGER PAISE, from platform settings. */
  deliveryFeePaise: number;
  /** INTEGER PAISE. At or above this, delivery is free. */
  freeDeliveryThresholdPaise: number;
  /** Whole percent. */
  gstPct: number;
  /** The vendor's rate AT THIS MOMENT — snapshotted onto the order. */
  commissionPct: number;
}

/** Exactly the shape of `Order.pricing`. */
export interface PricingResult {
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorPayout: number;
}

/**
 * `amount × pct ÷ 100`, rounded to whole paise.
 *
 * Multiply first, divide last: `amount * (pct / 100)` would introduce a
 * binary fraction before the multiply and drift by a paisa on values that
 * happen to land near a half.
 */
export const percentOf = (amount: number, pct: number): number =>
  Math.round((amount * pct) / 100);

/** Guards the invariant at the boundary instead of trusting callers. */
function assertPaise(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `${label} must be a non-negative integer number of paise, received ${value}`,
    );
  }
}

/** Σ price × qty. */
export function lineTotal(line: PricedLine): number {
  assertPaise(line.price, 'line.price');
  if (!Number.isInteger(line.qty) || line.qty < 1) {
    throw new Error(`line.qty must be a positive integer, received ${line.qty}`);
  }
  return line.price * line.qty;
}

export function subtotalOf(lines: readonly PricedLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

/**
 * The discount a coupon takes off a subtotal.
 *
 * Rounded DOWN, and clamped both to `maxDiscount` and to the subtotal
 * itself. An uncapped percent coupon on a large basket is an unbounded
 * liability, and a discount larger than the basket is a negative
 * `grandTotal` — i.e. the platform paying the customer to shop.
 */
export function computeDiscount(
  itemsSubtotal: number,
  coupon: ApplicableCoupon | null,
): number {
  if (!coupon) return 0;
  assertPaise(itemsSubtotal, 'itemsSubtotal');

  const raw =
    coupon.type === 'flat'
      ? Math.floor(coupon.value)
      : Math.floor((itemsSubtotal * coupon.value) / 100);

  const capped =
    coupon.maxDiscount === null ? raw : Math.min(raw, coupon.maxDiscount);

  return Math.max(0, Math.min(capped, itemsSubtotal));
}

/**
 * The whole bill, in one pass.
 *
 * ── The decisions encoded here, and where they come from ────────────────
 *  • Delivery is free at or above the threshold, measured on the amount
 *    the customer actually pays for goods (subtotal − discount). Measuring
 *    it pre-discount would let a coupon buy free delivery it did not earn.
 *  • GST is charged on the TAXABLE VALUE — subtotal − discount — which is
 *    how a discount is treated in Indian GST. The delivery fee is platform
 *    revenue (locked decision #5) and is not part of the vendor's taxable
 *    supply here.
 *  • Commission is a flat percent of `itemsSubtotal` (decision #6), and
 *    `commissionPct` is COPIED into the result so the order carries the
 *    rate that was in force when it was placed. Changing a vendor's rate
 *    tomorrow must never re-price what they sold today.
 *  • `vendorPayout` follows who funded the coupon. A platform-wide coupon
 *    is a platform marketing cost, so the vendor is still paid on the full
 *    subtotal (`itemsSubtotal − commissionAmount`, exactly as §5.1 states).
 *    A vendor's own coupon is funded by that vendor, so it comes off their
 *    payout — which is what the `Order.pricing` schema comment describes.
 *    One rule, both documents satisfied, and neither party silently
 *    absorbing the other's promotion.
 */
export function computePricing(input: PricingInput): PricingResult {
  assertPaise(input.deliveryFeePaise, 'deliveryFeePaise');
  assertPaise(input.freeDeliveryThresholdPaise, 'freeDeliveryThresholdPaise');

  const itemsSubtotal = subtotalOf(input.lines);
  const discount = computeDiscount(itemsSubtotal, input.coupon);
  const payableGoods = itemsSubtotal - discount;

  const deliveryFee =
    payableGoods >= input.freeDeliveryThresholdPaise
      ? 0
      : input.deliveryFeePaise;

  const taxes = percentOf(payableGoods, input.gstPct);
  const grandTotal = payableGoods + deliveryFee + taxes;

  const commissionAmount = percentOf(itemsSubtotal, input.commissionPct);
  const vendorFundedDiscount = input.coupon?.vendorFunded ? discount : 0;
  const vendorPayout = itemsSubtotal - commissionAmount - vendorFundedDiscount;

  return {
    itemsSubtotal,
    discount,
    deliveryFee,
    taxes,
    grandTotal,
    commissionPct: input.commissionPct,
    commissionAmount,
    vendorPayout,
  };
}
