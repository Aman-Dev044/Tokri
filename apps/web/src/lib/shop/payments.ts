'use client';

/**
 * Online payment — Razorpay Checkout, opened client-side, verified server-side.
 *
 * ── THE FLOW ─────────────────────────────────────────────────────────────
 *   1. `POST /checkout` with `paymentMethod: 'online'`. Today this is a clean
 *      503 `PAYMENT_PROVIDER_NOT_CONFIGURED` — no Razorpay credentials exist
 *      in any environment this app runs in — and `CheckoutView` renders that
 *      honestly. This file exists for the day that changes.
 *   2. When it does not 503, the response's `payment.next` is `'gateway'`
 *      and a TOP-LEVEL `gatewayOrder` block carries everything the sheet
 *      needs: `providerOrderId`, `amount` (integer paise), `currency` and
 *      `keyId`. `readPlacedOrder` takes all four or none. Absent — the
 *      only state reachable today — `CheckoutView` says plainly that online
 *      payment could not be started and the order still exists; nothing here
 *      invents a provider order id to make the sheet open anyway.
 *   3. `window.Razorpay(...).open()` with the `keyId` from step 2. That is
 *      the PUBLIC key, and it comes from the server that already holds the
 *      secret — deliberately NOT from a `NEXT_PUBLIC_` variable, which would
 *      be a second copy of the same value, free to drift and open the sheet
 *      against the wrong merchant account.
 *   4. On success, `POST /payments/:orderId/verify` with the three fields Razorpay's
 *      own callback hands back — this is the client-side optimisation only;
 *      the source of truth is the provider's webhook, which this app never
 *      touches. A cancelled or failed sheet is reported as such, never as a
 *      generic failure, and never as a fake success.
 */

import { api } from '@/lib/api-client';

export class PaymentError extends Error {
  /** true when the customer closed the sheet themselves — not a failure to report as one */
  readonly cancelled: boolean;

  constructor(message: string, cancelled = false) {
    super(message);
    this.name = 'PaymentError';
    this.cancelled = cancelled;
  }
}

/** What Razorpay Checkout's `handler` callback hands back on success. */
export interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

const CHECKOUT_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let scriptPromise: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new PaymentError('Online payment needs a browser.'));
  }
  if (window.Razorpay !== undefined) return Promise.resolve();

  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new PaymentError('The payment gateway could not be loaded. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface OpenCheckoutInput {
  /** The PUBLIC key, from the checkout response's `gatewayOrder`. */
  keyId: string;
  providerOrderId: string;
  /** INTEGER PAISE. */
  amount: number;
  currency: string;
  /** Shown on the Razorpay sheet — the brand name, never hardcoded here. */
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
}

/** Opens the Checkout sheet. Resolves on payment, rejects on cancel or failure. */
export async function openRazorpayCheckout(input: OpenCheckoutInput): Promise<RazorpaySuccess> {
  const keyId = input.keyId;
  await loadCheckoutScript();
  if (window.Razorpay === undefined) {
    throw new PaymentError('The payment gateway could not be loaded.');
  }
  const RazorpayCtor = window.Razorpay;

  return new Promise<RazorpaySuccess>((resolve, reject) => {
    const instance = new RazorpayCtor({
      key: keyId,
      order_id: input.providerOrderId,
      amount: input.amount,
      currency: input.currency,
      name: input.name,
      description: input.description,
      prefill: input.prefill,
      handler: (response) => resolve(response),
      modal: {
        ondismiss: () => reject(new PaymentError('Payment was cancelled.', true)),
      },
    });
    instance.open();
  });
}

export interface VerifyPaymentInput {
  orderId: string;
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

/**
 * `POST /payments/:orderId/verify` — the client-side confirmation only. The
 * webhook, which this app never calls, is the actual source of truth for a
 * final state (§8.3 in the plan); this just lets the confirmation screen say
 * "paid" without waiting on it.
 */
export async function verifyPayment(input: VerifyPaymentInput): Promise<void> {
  // The order id travels in the PATH, not the body. It is what
  // `ResourceOwnerGuard` reads via `@Owns({ param: 'orderId' })` to prove
  // this customer owns the order, and `VerifyPaymentDto` does not declare
  // it — with `forbidNonWhitelisted` on the global pipe, sending it as a
  // field is a hard 400 rather than a harmless extra.
  const { orderId, ...payload } = input;
  await api.post(`/payments/${encodeURIComponent(orderId)}/verify`, payload);
}
