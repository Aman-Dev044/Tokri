/**
 * Counter-billing helpers for the vendor panel.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE TOTALS HERE ARE A PREVIEW.                                           │
 * │                                                                          │
 * │ The request to `POST /vendor/pos/sales` carries product ids and          │
 * │ quantities and nothing else; the API re-reads every price and computes  │
 * │ the GST, the discount cap, the total and the change itself. The invoice  │
 * │ screen prints what the API returned. This file only lets the cashier see │
 * │ roughly what the customer owes before pressing Charge.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { PosPaymentMode, PosProduct, PosSaleDetail } from './types';
import { formatPaise } from '@/components/vendor/format';

export interface CartLine {
  product: PosProduct;
  qty: number;
}

export interface PreviewTotals {
  subtotal: number;
  discount: number;
  taxes: number;
  grandTotal: number;
}

/**
 * Same shape of arithmetic as the API's `pricing.ts`: GST on the taxable
 * value (subtotal − discount), multiply-then-divide, rounded to the paisa.
 * Integer paise throughout.
 */
export function previewTotals(lines: readonly CartLine[], discountPaise: number): PreviewTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
  const discount = Math.max(0, Math.min(Math.floor(discountPaise), subtotal));
  const taxable = subtotal - discount;
  // Every product carries the same platform rate today; take the first.
  const rate = lines[0]?.product.gstRate ?? 0;
  const taxes = Math.round((taxable * rate) / 100);
  return { subtotal, discount, taxes, grandTotal: taxable + taxes };
}

export const PAYMENT_LABEL: Record<PosPaymentMode, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
};

/** One key per Charge attempt, held across retries of THAT attempt. */
export function newSaleKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Plain-http contexts have no randomUUID. An idempotency key is not a
  // credential; getRandomValues is still available and still random.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `pos-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** The plain-text invoice that goes into the WhatsApp message. */
export function invoiceText(sale: PosSaleDetail): string {
  const lines = [
    `${sale.store.name}`,
    `Invoice ${sale.invoiceNo}`,
    sale.createdAt ? new Date(sale.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
    '',
    ...sale.items.map(
      (item) => `${item.qty} x ${item.name} (${item.unitLabel}) - ${formatPaise(item.lineTotal)}`,
    ),
    '',
    `Subtotal: ${formatPaise(sale.subtotal)}`,
    ...(sale.discount > 0 ? [`Discount: -${formatPaise(sale.discount)}`] : []),
    `GST: ${formatPaise(sale.taxes)}`,
    `Total: ${formatPaise(sale.grandTotal)}`,
    `Paid by ${PAYMENT_LABEL[sale.paymentMode]}`,
    ...(sale.status === 'voided' ? ['', 'This sale was VOIDED.'] : []),
    '',
    'Thank you for shopping with us.',
  ];
  return lines.filter((line, index) => line !== '' || lines[index - 1] !== '').join('\n');
}

/** `https://wa.me/91XXXXXXXXXX?text=…`, or null without a 10-digit phone. */
export function whatsappLink(sale: PosSaleDetail): string | null {
  const phone = sale.customer.phone;
  if (!phone || !/^\d{10}$/.test(phone)) return null;
  return `https://wa.me/91${phone}?text=${encodeURIComponent(invoiceText(sale))}`;
}
