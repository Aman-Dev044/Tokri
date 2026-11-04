/**
 * ════════════════════════════════════════════════════════════════════════
 *  COUNTER ARITHMETIC — pure functions, INTEGER PAISE only
 * ════════════════════════════════════════════════════════════════════════
 *
 * The totals are produced by `computePricing` from the online checkout's
 * own `pricing.ts`, with the counter's facts plugged in: no delivery fee,
 * no commission, and the cashier's discount expressed as a flat coupon.
 * That is the point — a walk-in bill and an online bill for the same
 * basket must carry the SAME GST, computed the same way: on the taxable
 * value (subtotal − discount) at `GST_PCT`.
 *
 * What this file adds is only what the counter needs on top: splitting
 * the invoice tax across the lines so each line can print its own GST and
 * the lines still sum to the total, the financial year, and the invoice
 * number's shape.
 */

import { GST_PCT, computePricing } from '../../shop/pricing/pricing';

export interface CounterLine {
  /** INTEGER PAISE, read from the product — never from the request. */
  price: number;
  qty: number;
}

export interface CounterTotals {
  subtotal: number;
  discount: number;
  taxableValue: number;
  taxes: number;
  grandTotal: number;
  gstRate: number;
  /** Per line, in input order. Sums exactly to `taxes`. */
  lineGst: number[];
  /** Per line, `price × qty`. */
  lineTotals: number[];
}

/**
 * Splits `total` across `weights` in proportion, in whole paise, so the
 * parts sum to `total` exactly (largest-remainder method). Rounding each
 * line independently drifts by a paisa per line, and an invoice whose
 * line GSTs do not add up to its GST total is an invoice an accountant
 * sends back.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);

  const exact = weights.map((weight) => (total * weight) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((acc, part) => acc + part, 0);

  // Biggest fractional remainder first; ties to the earlier line, so the
  // split is deterministic.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

export function priceCounterSale(
  lines: readonly CounterLine[],
  discountPaise: number,
): CounterTotals {
  const pricing = computePricing({
    lines,
    coupon:
      discountPaise > 0
        ? {
            type: 'flat',
            value: discountPaise,
            maxDiscount: null,
            // The store gives its own discount at its own counter.
            vendorFunded: true,
          }
        : null,
    deliveryFeePaise: 0,
    freeDeliveryThresholdPaise: 0,
    gstPct: GST_PCT,
    // No platform commission on a walk-in sale.
    commissionPct: 0,
  });

  const lineTotals = lines.map((line) => line.price * line.qty);

  return {
    subtotal: pricing.itemsSubtotal,
    discount: pricing.discount,
    taxableValue: pricing.itemsSubtotal - pricing.discount,
    taxes: pricing.taxes,
    grandTotal: pricing.grandTotal,
    gstRate: GST_PCT,
    lineGst: allocate(pricing.taxes, lineTotals),
    lineTotals,
  };
}

/** India Standard Time is a fixed +05:30 — no daylight saving to model. */
const IST_OFFSET_MS = 330 * 60_000;

/**
 * The Indian financial year (April–March) containing `at`, in IST:
 * 31 March 2027 23:59 IST is `2026-27`; one minute later is `2027-28`.
 */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Midnight IST on the day containing `at`, as an instant. */
export function istDayStart(at: Date): Date {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) -
      IST_OFFSET_MS,
  );
}

/**
 * Up to six letters/digits from the store's slug, upper-cased. The slug is
 * a platform decision a vendor cannot edit, so the code is stable for the
 * life of the store; the vendor id's tail is the fallback for a slug with
 * nothing usable in it.
 */
export function storeCode(slug: string, vendorId: string): string {
  const fromSlug = slug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();
  return fromSlug.length >= 2 ? fromSlug : vendorId.slice(-6).toUpperCase();
}

export const formatInvoiceNo = (
  code: string,
  fy: string,
  seq: number,
): string => `INV/${code}/${fy}/${String(seq).padStart(6, '0')}`;

const UNIT_WORD: Record<string, string> = {
  kg: 'kg',
  g: 'g',
  l: 'L',
  ml: 'ml',
  piece: 'pc',
  pack: 'pack',
};

export const unitLabel = (unit: string, unitValue: number): string =>
  `${unitValue} ${UNIT_WORD[unit] ?? unit}`;
