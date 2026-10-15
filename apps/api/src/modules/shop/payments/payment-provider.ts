/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE PAYMENT PROVIDER PORT
 * ════════════════════════════════════════════════════════════════════════
 *
 * Locked decision #2 is Razorpay · India · INR, written behind an
 * interface so a second gateway is an adapter rather than a rewrite. §8.7
 * #17 adds the operational reason: every third party sits behind a port
 * with a timeout, so an outage degrades one path instead of taking the
 * platform down. Payments down → COD still works, and that is only true
 * if nothing outside this folder imports a Razorpay type.
 */

/** What the client needs to open the gateway's checkout sheet. */
export interface ProviderOrder {
  providerOrderId: string;
  /** INTEGER PAISE. */
  amount: number;
  currency: 'INR';
  /** The PUBLIC key id. The secret never leaves the server. */
  keyId: string;
}

export interface CreateProviderOrderInput {
  /** Our own order number, passed through as the provider's receipt. */
  receipt: string;
  /** INTEGER PAISE. */
  amount: number;
  notes?: Record<string, string>;
}

/** The three-field payload a Razorpay-style client callback returns. */
export interface VerifySignatureInput {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

/** What the gateway currently thinks happened to one of its orders. */
export type ProviderPaymentState = 'paid' | 'pending' | 'failed';

export interface ProviderOrderStatus {
  state: ProviderPaymentState;
  /** The captured payment's id, present only when `state === 'paid'`. */
  providerPaymentId: string | null;
}

export interface PaymentProvider {
  readonly name: string;

  /**
   * True only when every credential `createOrder` / `verifySignature`
   * need is present.
   *
   * Checkout asks BEFORE it does anything, so an unconfigured gateway is
   * a clean 503 on the online path rather than a crash — and never a
   * reason for the COD path to stop working.
   */
  isConfigured(): boolean;

  /**
   * True only when `RAZORPAY_WEBHOOK_SECRET` is present.
   *
   * Kept separate from `isConfigured()`: a deployment could in principle
   * hold API keys without a webhook secret (or vice versa) while it is
   * being provisioned, and the webhook must refuse to trust a signature
   * it cannot actually verify rather than silently accepting everything.
   */
  isWebhookConfigured(): boolean;

  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;

  /**
   * Verifies the signature on a CLIENT callback.
   *
   * §8.3: the browser callback is an optimisation, never the source of
   * truth. The webhook is — and it is a separate phase.
   */
  verifySignature(input: VerifySignatureInput): boolean;

  /**
   * Verifies the HMAC on a WEBHOOK delivery.
   *
   * `rawBody` must be the exact bytes Razorpay sent — a body that has
   * been JSON-parsed and re-serialised will not reproduce the same HMAC,
   * because key order and whitespace are not guaranteed to round-trip.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;

  /**
   * Live lookup of an order's payment state, straight from the gateway.
   *
   * Used only by the reconciliation sweep (§8.3): the backstop for a
   * webhook that never arrived. Never on the request path — a customer's
   * checkout must never wait on a gateway round trip it doesn't need.
   */
  fetchOrderStatus(providerOrderId: string): Promise<ProviderOrderStatus>;
}

/** DI token. An interface has no runtime identity to inject by. */
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
