/**
 * ════════════════════════════════════════════════════════════════════════
 *  PARTIAL-FULFILMENT RE-PRICING  (locked decision #9)
 * ════════════════════════════════════════════════════════════════════════
 *
 * "Vendor partial-fulfils. Removed lines auto-refund."
 *
 * A ₹900 basket must not die because one ₹40 item is missing. The vendor
 * unticks the line, the order is re-priced from the lines that survive,
 * and the difference is refunded to the customer.
 *
 * ── Why this is a pure function ─────────────────────────────────────────
 * It touches no database, no session and no clock, so `vendor-pricing.spec`
 * can enumerate the awkward cases — everything dropped, a 100% discount,
 * an order whose subtotal is zero — without booting Mongo. Money
 * arithmetic that can only be tested through an integration suite is
 * money arithmetic nobody tests.
 *
 * ── Every value is INTEGER PAISE ────────────────────────────────────────
 * Floating-point rupees produce settlement reports that are off by a few
 * paise and take a week to find. Each derived amount is rounded ONCE,
 * with `Math.round`, at the point it is computed.
 *
 * ── What scales and what does not ───────────────────────────────────────
 *   itemsSubtotal   recomputed from the surviving lines
 *   discount        scaled pro-rata: a ₹50-off coupon on a basket that
 *                   halved is worth ₹25, not ₹50. Keeping it whole lets a
 *                   vendor drop lines until the discount exceeds the
 *                   remaining basket and the platform pays the customer.
 *   taxes           scaled pro-rata: tax follows the goods.
 *   deliveryFee     UNCHANGED. The rider still rides. It is platform
 *                   revenue (decision #5), so it is not the vendor's to
 *                   waive and not affected by what is in the bag.
 *   commissionPct   NEVER recomputed. It is the snapshot taken at
 *                   checkout (decision #6); re-reading the vendor's
 *                   current rate here would retroactively re-price a
 *                   live order.
 *   commissionAmount round(newItemsSubtotal × commissionPct / 100) —
 *                   the same basis the rest of the platform uses.
 *   vendorPayout    newItemsSubtotal − commissionAmount.
 */

export interface OrderPricingSnapshot {
  /** INTEGER PAISE. */
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
  /** Percent. The SNAPSHOT taken at checkout — never re-read. */
  commissionPct: number;
  commissionAmount: number;
  vendorPayout: number;
}

export interface FulfilmentLine {
  /** price × qty, INTEGER PAISE. */
  lineTotal: number;
  fulfilled: boolean;
}

export interface RepricedOrder {
  pricing: OrderPricingSnapshot;
  /**
   * What the customer is owed back, INTEGER PAISE, always ≥ 0.
   * The reduction in `grandTotal` — the number they actually paid.
   */
  refundDelta: number;
  /** How much less the vendor will be paid, INTEGER PAISE, always ≥ 0. */
  payoutDelta: number;
  droppedLineCount: number;
}

/**
 * Re-prices an order against a new fulfilment pattern.
 *
 * `lines` must be the order's items in their post-edit state. The
 * original `pricing` supplies the coupon, tax and commission basis; it is
 * never mutated.
 */
export function repriceForFulfilment(
  pricing: OrderPricingSnapshot,
  lines: readonly FulfilmentLine[],
): RepricedOrder {
  const fulfilledSubtotal = lines.reduce(
    (sum, line) => (line.fulfilled ? sum + line.lineTotal : sum),
    0,
  );

  // The denominator is the ORIGINAL subtotal, not the sum of the current
  // lines: those are identical on a well-formed order, and using the
  // snapshot means a corrupted item array cannot inflate the ratio past 1.
  const basis = pricing.itemsSubtotal;
  const ratio = basis > 0 ? Math.min(fulfilledSubtotal / basis, 1) : 0;

  const discount = Math.round(pricing.discount * ratio);
  const taxes = Math.round(pricing.taxes * ratio);
  const deliveryFee = pricing.deliveryFee;

  const commissionAmount = Math.round(
    (fulfilledSubtotal * pricing.commissionPct) / 100,
  );

  const grandTotal = Math.max(
    fulfilledSubtotal - discount + deliveryFee + taxes,
    0,
  );
  const vendorPayout = fulfilledSubtotal - commissionAmount;

  const next: OrderPricingSnapshot = {
    itemsSubtotal: fulfilledSubtotal,
    discount,
    deliveryFee,
    taxes,
    grandTotal,
    commissionPct: pricing.commissionPct,
    commissionAmount,
    vendorPayout,
  };

  return {
    pricing: next,
    // Clamped at zero: re-pricing can only ever remove lines, and a
    // "negative refund" would be an invoice the customer never agreed to.
    refundDelta: Math.max(pricing.grandTotal - grandTotal, 0),
    payoutDelta: Math.max(pricing.vendorPayout - vendorPayout, 0),
    droppedLineCount: lines.filter((line) => !line.fulfilled).length,
  };
}
