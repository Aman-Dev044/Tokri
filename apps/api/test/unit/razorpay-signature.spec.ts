import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';

import { RazorpayProvider } from '../../src/modules/shop/payments/razorpay.provider';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RAZORPAY SIGNATURE MATHS — UNIT
 * ════════════════════════════════════════════════════════════════════════
 *
 * There is no live gateway to test against, so this proves the one thing
 * that actually matters and is fully testable offline: the HMAC formula
 * §8.3 specifies, applied correctly and compared safely.
 *
 *   verifySignature         HMAC-SHA256(`${orderId}|${paymentId}`, keySecret)
 *   verifyWebhookSignature  HMAC-SHA256(rawBody, webhookSecret)
 *
 * Every "known vector" here is computed independently with Node's own
 * `crypto` module — never by calling the provider to produce its own
 * test oracle — so a bug that made `verifySignature` accept anything
 * would be caught rather than laundered through a self-consistent test.
 */

const KEY_ID = 'rzp_test_1234567890';
const KEY_SECRET = 'a-key-secret-that-is-definitely-not-real';
const WEBHOOK_SECRET = 'a-webhook-secret-also-not-real';

/** A `ConfigService` stub carrying exactly the three Razorpay vars. */
function fakeConfig(overrides: Partial<Record<string, string>> = {}): ConfigService {
  const values: Record<string, string> = {
    RAZORPAY_KEY_ID: KEY_ID,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...overrides,
  };
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error(`Missing config: ${key}`);
      return value;
    },
  } as unknown as ConfigService;
}

describe('RazorpayProvider — signature verification', () => {
  describe('verifySignature (client callback)', () => {
    const provider = new RazorpayProvider(fakeConfig());
    const providerOrderId = 'order_DBJOWzybf0sJbb';
    const providerPaymentId = 'pay_29QQoUBi66xm2f';

    const knownGoodSignature = createHmac('sha256', KEY_SECRET)
      .update(`${providerOrderId}|${providerPaymentId}`)
      .digest('hex');

    it('accepts a correctly computed signature', () => {
      expect(
        provider.verifySignature({
          providerOrderId,
          providerPaymentId,
          signature: knownGoodSignature,
        }),
      ).toBe(true);
    });

    it('rejects a signature computed under the wrong secret', () => {
      const wrong = createHmac('sha256', 'not-the-real-secret')
        .update(`${providerOrderId}|${providerPaymentId}`)
        .digest('hex');

      expect(
        provider.verifySignature({
          providerOrderId,
          providerPaymentId,
          signature: wrong,
        }),
      ).toBe(false);
    });

    it('rejects a single-character tamper anywhere in a valid signature', () => {
      const flippedLastChar =
        knownGoodSignature.slice(0, -1) +
        (knownGoodSignature.at(-1) === '0' ? '1' : '0');

      expect(
        provider.verifySignature({
          providerOrderId,
          providerPaymentId,
          signature: flippedLastChar,
        }),
      ).toBe(false);
    });

    it('rejects a signature computed for a different payment id (no cross-payment replay)', () => {
      expect(
        provider.verifySignature({
          providerOrderId,
          providerPaymentId: 'pay_someOtherPayment',
          signature: knownGoodSignature,
        }),
      ).toBe(false);
    });

    it('does not throw on a malformed (non-hex, wrong-length, empty) signature', () => {
      // The comparison must be TIMING-SAFE, which also means it must be
      // CRASH-SAFE: `timingSafeEqual` throws on unequal-length buffers,
      // so the implementation must guard the length itself rather than
      // let attacker-controlled input reach it directly.
      for (const bogus of ['', 'not-hex-at-all', '00', 'gg'.repeat(32)]) {
        expect(() =>
          provider.verifySignature({
            providerOrderId,
            providerPaymentId,
            signature: bogus,
          }),
        ).not.toThrow();
        expect(
          provider.verifySignature({
            providerOrderId,
            providerPaymentId,
            signature: bogus,
          }),
        ).toBe(false);
      }
    });

    it('throws a clean, typed refusal when the gateway is not configured', () => {
      const unconfigured = new RazorpayProvider(
        fakeConfig({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }),
      );
      expect(() =>
        unconfigured.verifySignature({
          providerOrderId,
          providerPaymentId,
          signature: knownGoodSignature,
        }),
      ).toThrow();
    });
  });

  describe('verifyWebhookSignature (§8.3 — the raw body)', () => {
    const provider = new RazorpayProvider(fakeConfig());
    const rawBody = Buffer.from(
      JSON.stringify({
        id: 'evt_JFYRVLK5CtV5rc',
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: 'pay_29QQoUBi66xm2f', order_id: 'order_DBJOWzybf0sJbb', status: 'captured' },
          },
        },
      }),
      'utf8',
    );

    const knownGoodSignature = createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    it('accepts a correctly computed signature over the exact raw bytes', () => {
      expect(provider.verifyWebhookSignature(rawBody, knownGoodSignature)).toBe(true);
    });

    it('rejects the same signature against a body that has been re-serialised', () => {
      // Simulates the exact bug §8.3 warns about: parsing the body and
      // re-stringifying it (e.g. different key order / spacing) breaks
      // the HMAC even though the "content" is logically identical.
      const parsed = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      const reserialised = Buffer.from(JSON.stringify(parsed) + ' ', 'utf8');

      expect(provider.verifyWebhookSignature(reserialised, knownGoodSignature)).toBe(false);
    });

    it('rejects a tampered body under the original signature', () => {
      const tampered = Buffer.from(
        rawBody.toString('utf8').replace('payment.captured', 'payment.failed'),
        'utf8',
      );
      expect(provider.verifyWebhookSignature(tampered, knownGoodSignature)).toBe(false);
    });

    it('rejects a signature computed under the wrong secret', () => {
      const wrong = createHmac('sha256', 'not-the-webhook-secret').update(rawBody).digest('hex');
      expect(provider.verifyWebhookSignature(rawBody, wrong)).toBe(false);
    });

    it('refuses to verify (throws) when no webhook secret is configured', () => {
      const unconfigured = new RazorpayProvider(
        fakeConfig({ RAZORPAY_WEBHOOK_SECRET: undefined }),
      );
      expect(() => unconfigured.verifyWebhookSignature(rawBody, knownGoodSignature)).toThrow();
    });
  });

  describe('isConfigured / isWebhookConfigured', () => {
    it('is false when either key credential is missing', () => {
      expect(
        new RazorpayProvider(
          fakeConfig({ RAZORPAY_KEY_SECRET: undefined }),
        ).isConfigured(),
      ).toBe(false);
      expect(
        new RazorpayProvider(fakeConfig({ RAZORPAY_KEY_ID: undefined })).isConfigured(),
      ).toBe(false);
      expect(new RazorpayProvider(fakeConfig()).isConfigured()).toBe(true);
    });

    it('is independent of the webhook secret', () => {
      const provider = new RazorpayProvider(
        fakeConfig({ RAZORPAY_WEBHOOK_SECRET: undefined }),
      );
      expect(provider.isConfigured()).toBe(true);
      expect(provider.isWebhookConfigured()).toBe(false);
    });
  });
});
