import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CreateProviderOrderInput,
  PaymentProvider,
  ProviderOrder,
  ProviderOrderStatus,
  ProviderRefund,
  RefundPaymentInput,
  VerifySignatureInput,
} from './payment-provider';
import { problem } from '../common/problem';

/** `https://api.razorpay.com/v1` — never mutated at runtime. */
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

/**
 * A checkout, a signature verification and a reconciliation lookup are
 * all synchronous steps in something a human is waiting on (placing an
 * order, or a background sweep that must not stall forever on one row).
 * 8 seconds is generous for Razorpay's own SLA and short enough that a
 * dead gateway degrades one request instead of hanging it.
 */
const REQUEST_TIMEOUT_MS = 8_000;

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
}

interface RazorpayPaymentEntity {
  id: string;
  order_id: string;
  status: string; // 'created' | 'authorized' | 'captured' | 'failed' | 'refunded'
}

interface RazorpayPaymentsForOrderResponse {
  items?: RazorpayPaymentEntity[];
}

interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number;
  status: string; // 'pending' | 'processed' | 'failed'
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RAZORPAY
 * ════════════════════════════════════════════════════════════════════════
 *
 * India · INR, behind the `PaymentProvider` port (§8.7 #17): a second
 * gateway is a new adapter, never a rewrite of anything that calls this
 * one. Nothing outside this folder may import a Razorpay-specific type —
 * that is what keeps "payments down → COD still works" true by
 * construction rather than by discipline.
 *
 * ── Why the keys are read with `get`/`getOrThrow`, never a fallback ─────
 * `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`
 * are OPTIONAL in the Joi schema, exactly like `SEED_DEMO_PASSWORD`: the
 * platform is fully operational on COD without a Razorpay account, so
 * `.required()` would refuse to boot a COD-only deployment over a
 * gateway nobody has signed up for. Every method below checks
 * `isConfigured()` / `isWebhookConfigured()` FIRST and throws a clean,
 * typed refusal if the credential it needs is absent — never a bare
 * `undefined` reaching an HTTP call or an HMAC. Once the guard has
 * passed, the actual read is `config.getOrThrow(...)`, never `!`, so the
 * compiler — not a runtime assumption — proves the value is a string at
 * the point of use.
 *
 * ── Timing-safe comparison ───────────────────────────────────────────────
 * `verifySignature` and `verifyWebhookSignature` both compare with
 * `timingSafeEqual`, never `===`. A `===` on a signature leaks how many
 * leading bytes matched through response timing — a real, exploitable
 * oracle against an HMAC comparison, and the entire reason this file
 * exists rather than a two-line skeleton.
 */
@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';

  private readonly logger = new Logger(RazorpayProvider.name);

  constructor(private readonly config: ConfigService) {
    if (!this.isConfigured()) {
      this.logger.warn(
        'Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET ' +
          'are absent). Online payment will return 503; COD is unaffected.',
      );
    }
    if (!this.isWebhookConfigured()) {
      this.logger.warn(
        'RAZORPAY_WEBHOOK_SECRET is absent. Webhook deliveries cannot be ' +
          'verified and will be rejected with 401 until it is set.',
      );
    }
  }

  isConfigured(): boolean {
    const hasKeyId = Boolean(this.config.get<string>('RAZORPAY_KEY_ID'));
    const hasKeySecret = Boolean(this.config.get<string>('RAZORPAY_KEY_SECRET'));
    return hasKeyId && hasKeySecret;
  }

  isWebhookConfigured(): boolean {
    return Boolean(this.config.get<string>('RAZORPAY_WEBHOOK_SECRET'));
  }

  // ── Order creation ────────────────────────────────────────────────────

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    if (!this.isConfigured()) throw this.notConfigured();

    const keyId = this.config.getOrThrow<string>('RAZORPAY_KEY_ID');
    const keySecret = this.config.getOrThrow<string>('RAZORPAY_KEY_SECRET');

    const body = await this.request<RazorpayOrderResponse>(
      '/orders',
      keyId,
      keySecret,
      {
        // INTEGER PAISE, passed through exactly as received — never
        // rounded, never re-derived from a float.
        amount: input.amount,
        currency: 'INR',
        receipt: input.receipt,
        notes: input.notes ?? {},
        // Auto-capture: a customer who completed the checkout sheet has
        // paid, full stop. Holding an authorized-but-uncaptured payment
        // for a second manual step is a refund waiting to happen.
        payment_capture: 1,
      },
    );

    return {
      providerOrderId: body.id,
      amount: input.amount,
      currency: 'INR',
      keyId,
    };
  }

  // ── Client-callback signature ────────────────────────────────────────

  verifySignature(input: VerifySignatureInput): boolean {
    if (!this.isConfigured()) throw this.notConfigured();

    const keySecret = this.config.getOrThrow<string>('RAZORPAY_KEY_SECRET');
    const payload = `${input.providerOrderId}|${input.providerPaymentId}`;
    const expected = createHmac('sha256', keySecret)
      .update(payload)
      .digest('hex');

    return safeCompareHex(expected, input.signature);
  }

  // ── Webhook signature ────────────────────────────────────────────────

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!this.isWebhookConfigured()) {
      throw new ServiceUnavailableException(
        problem(
          'PAYMENT_PROVIDER_NOT_CONFIGURED',
          'The payment webhook is not configured on this deployment.',
          { provider: this.name },
        ),
      );
    }

    const secret = this.config.getOrThrow<string>('RAZORPAY_WEBHOOK_SECRET');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');

    return safeCompareHex(expected, signature);
  }

  // ── Reconciliation ───────────────────────────────────────────────────

  /**
   * Live state of one order, straight from Razorpay's payments-for-order
   * endpoint. `captured` on any payment wins — an order can carry a
   * failed attempt followed by a successful retry, and the failed one
   * must never shadow the money that actually arrived.
   */
  async fetchOrderStatus(providerOrderId: string): Promise<ProviderOrderStatus> {
    if (!this.isConfigured()) throw this.notConfigured();

    const keyId = this.config.getOrThrow<string>('RAZORPAY_KEY_ID');
    const keySecret = this.config.getOrThrow<string>('RAZORPAY_KEY_SECRET');

    const body = await this.request<RazorpayPaymentsForOrderResponse>(
      `/orders/${encodeURIComponent(providerOrderId)}/payments`,
      keyId,
      keySecret,
      null,
    );

    const items = body.items ?? [];
    const captured = items.find((item) => item.status === 'captured');
    if (captured) {
      return { state: 'paid', providerPaymentId: captured.id };
    }

    const allFailed = items.length > 0 && items.every((item) => item.status === 'failed');
    if (allFailed) {
      return { state: 'failed', providerPaymentId: null };
    }

    // No attempt yet, or one still authorized/in-progress: neither paid
    // nor conclusively failed.
    return { state: 'pending', providerPaymentId: null };
  }

  // ── Refunds ──────────────────────────────────────────────────────────

  /**
   * `POST /payments/:id/refund` — a normal-speed refund of `amount` paise.
   *
   * Razorpay answers `pending` or `processed` once it has accepted the
   * refund, and a non-2xx (which `request` turns into a 503) when it has
   * not. A `failed` status in a 2xx body is treated as a refusal too: the
   * caller records the refund only when this resolves, so resolving on a
   * refund the gateway has already declared failed would write money
   * back to the customer that never moved.
   */
  async refundPayment(input: RefundPaymentInput): Promise<ProviderRefund> {
    if (!this.isConfigured()) throw this.notConfigured();

    const keyId = this.config.getOrThrow<string>('RAZORPAY_KEY_ID');
    const keySecret = this.config.getOrThrow<string>('RAZORPAY_KEY_SECRET');

    const body = await this.request<RazorpayRefundEntity>(
      `/payments/${encodeURIComponent(input.providerPaymentId)}/refund`,
      keyId,
      keySecret,
      {
        // INTEGER PAISE, passed through exactly as received.
        amount: input.amount,
        notes: input.notes ?? {},
      },
    );

    if (body.status === 'failed') {
      this.logger.error(
        `Razorpay refund ${body.id} on ${input.providerPaymentId} came back failed`,
      );
      throw this.gatewayUnavailable();
    }

    return { providerRefundId: body.id, status: body.status };
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * One JSON request against the Razorpay REST API, HTTP Basic auth with
   * `keyId:keySecret`, bounded by `REQUEST_TIMEOUT_MS`.
   *
   * `body: null` sends a GET; anything else sends a POST with a JSON
   * body — the only two shapes this adapter needs.
   */
  private async request<T>(
    path: string,
    keyId: string,
    keySecret: string,
    body: Record<string, unknown> | null,
  ): Promise<T> {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(`${RAZORPAY_API_BASE}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        `Razorpay request to ${path} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw this.gatewayUnavailable();
    }

    if (!response.ok) {
      // The response body can carry Razorpay's own error description —
      // logged for operators, never returned to the caller, which is
      // the same discipline `GeoService` applies to Google's status
      // field.
      const detail = await response.text().catch(() => '');
      this.logger.error(
        `Razorpay ${path} returned ${response.status}: ${detail.slice(0, 500)}`,
      );
      throw this.gatewayUnavailable();
    }

    return (await response.json()) as T;
  }

  /**
   * One explicit, actionable error instead of a crash somewhere deeper.
   *
   * 503 and not 500: the request was valid and the caller should retry
   * later (or pay cash), which is exactly what "Service Unavailable"
   * means and exactly what the customer app should show.
   */
  private notConfigured(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      problem(
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        'Online payment is not available yet — the payment provider is not ' +
          'configured. Cash on delivery is unaffected.',
        { provider: this.name },
      ),
    );
  }

  private gatewayUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      problem(
        'PAYMENT_GATEWAY_UNAVAILABLE',
        'The payment gateway did not respond. Please try again shortly, ' +
          'or choose cash on delivery.',
        { provider: this.name },
      ),
    );
  }
}

/**
 * Constant-time hex-digest comparison.
 *
 * A length mismatch is resolved BEFORE `timingSafeEqual` — which throws
 * on unequal-length buffers rather than returning a safe `false` — and
 * that early return leaks nothing worth hiding: HMAC-SHA256 digests are
 * always 64 hex characters, so "wrong length" only ever means "not even
 * shaped like a signature," never a partial match. `Buffer.from(x,
 * 'hex')` never throws on malformed hex either; it simply stops at the
 * first invalid pair, which this length check also catches.
 */
function safeCompareHex(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
