import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CreateProviderOrderInput,
  PaymentProvider,
  ProviderOrder,
  VerifySignatureInput,
} from './payment-provider';
import { problem } from '../common/problem';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RAZORPAY — SKELETON ONLY. NOT WIRED TO THE GATEWAY.
 * ════════════════════════════════════════════════════════════════════════
 *
 * The merchant account is still open business (§1.1: "Razorpay merchant
 * account with KYC complete + test/live API keys → needed by Phase 5"),
 * so there are no credentials to talk to. This adapter therefore does
 * exactly one useful thing today: it reports that it is NOT configured,
 * clearly and at request time.
 *
 * ── Why the keys are read with `get` and not `getOrThrow` ───────────────
 * `getOrThrow` is right for a secret the application cannot run without —
 * it stops the process at boot rather than letting it run misconfigured.
 * These are different: the platform is fully operational on COD without
 * them. Adding RAZORPAY_KEY_ID to the Joi schema as `.required()` would
 * mean the API refuses to boot until a gateway nobody has signed up for
 * yet is configured. So they are optional, read once, and their absence
 * turns into a 503 on the online payment path and nothing else.
 *
 * This is NOT the banned `process.env.X || 'fallback'` pattern. There is
 * no fallback value anywhere here: a missing key produces a refusal, not
 * a default. That distinction is the whole of §4.1.
 *
 * ── What lands when the keys do ─────────────────────────────────────────
 * TODO(phase-5): `createOrder` → POST /v1/orders with basic auth, a
 *   request timeout and a circuit breaker (§8.7 #17).
 * TODO(phase-5): `verifySignature` → HMAC-SHA256 of
 *   `${providerOrderId}|${providerPaymentId}` under the key secret,
 *   compared with `timingSafeEqual` — never `===`, which leaks the
 *   comparison position through timing.
 * TODO(phase-5): `POST /webhooks/razorpay` — the SOURCE OF TRUTH per
 *   §8.3: HMAC over the RAW body, dedupe on the provider's event id,
 *   apply in a transaction keyed on the order. Deliberately not started
 *   here: a half-built webhook that accepts unverified events is worse
 *   than no webhook at all.
 */
@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';

  private readonly logger = new Logger(RazorpayProvider.name);

  private readonly keyId: string | undefined;
  private readonly keySecret: string | undefined;

  constructor(config: ConfigService) {
    this.keyId = config.get<string>('RAZORPAY_KEY_ID');
    this.keySecret = config.get<string>('RAZORPAY_KEY_SECRET');

    if (!this.isConfigured()) {
      this.logger.warn(
        'Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET ' +
          'are absent). Online payment will return 503; COD is unaffected.',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  createOrder(_input: CreateProviderOrderInput): Promise<ProviderOrder> {
    throw this.notConfigured();
  }

  verifySignature(_input: VerifySignatureInput): boolean {
    throw this.notConfigured();
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
}
