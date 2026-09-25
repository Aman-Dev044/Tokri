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

export interface PaymentProvider {
  readonly name: string;

  /**
   * True only when every credential the adapter needs is present.
   *
   * Checkout asks BEFORE it does anything, so an unconfigured gateway is
   * a clean 503 on the online path rather than a crash — and never a
   * reason for the COD path to stop working.
   */
  isConfigured(): boolean;

  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;

  /**
   * Verifies the signature on a CLIENT callback.
   *
   * §8.3: the browser callback is an optimisation, never the source of
   * truth. The webhook is — and it is a separate phase.
   */
  verifySignature(input: VerifySignatureInput): boolean;
}

/** DI token. An interface has no runtime identity to inject by. */
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
