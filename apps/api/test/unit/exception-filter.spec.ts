import 'reflect-metadata';
import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { problem } from '../../src/modules/shop/common/problem';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE 5xx DISCLOSURE BOUNDARY
 * ════════════════════════════════════════════════════════════════════════
 *
 * One filter decides what every error in this API is allowed to say, and
 * it has to get two opposite things right at once:
 *
 *   • An UNEXPECTED 500 must say nothing. A Mongoose failure or an
 *     unhandled throw can carry a stack, a driver message, even a
 *     connection string. That is free reconnaissance for anyone probing
 *     the service, so it is replaced wholesale.
 *
 *   • A DELIBERATE 5xx must say exactly what it means. A 503 raised as
 *     `problem('PAYMENT_PROVIDER_NOT_CONFIGURED', '…')` carries a sentence
 *     an author wrote for the caller to read. Blanking that reported a
 *     crash that never happened — the UI told people the system had broken
 *     when the truth was "this deployment has no gateway credentials yet".
 *
 * Both halves are asserted here because loosening one is exactly how you
 * silently break the other.
 */

/** Captures what the filter would have written to the response. */
function captureResponse() {
  const sent: { status?: number; body?: Record<string, unknown> } = {};
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
      return this;
    },
  };
  return { sent, res };
}

function hostFor(res: unknown, url = '/api/v1/anything'): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => ({ method: 'POST', url }),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter — the 5xx disclosure boundary', () => {
  let filter: AllExceptionsFilter;

  beforeAll(() => {
    // The filter only reads `brand.name`, to build the RFC 7807 `type`
    // namespace. A stub keeps this a unit test.
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'brand.name') return 'Tokri';
        throw new Error(`unexpected config key: ${key}`);
      },
    } as unknown as ConfigService;

    filter = new AllExceptionsFilter(config);

    // The filter logs every 5xx. That is correct behaviour and not what
    // this file is testing, so keep it out of the test output.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const run = (exception: unknown) => {
    const { sent, res } = captureResponse();
    filter.catch(exception, hostFor(res));
    return sent;
  };

  // ── THE SECURITY HALF ──────────────────────────────────────────────

  it('REPLACES the message of an unhandled non-HTTP error', () => {
    const sent = run(new Error('connect ECONNREFUSED 10.0.0.7:27017'));

    expect(sent.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(sent.body?.detail).toBe('Internal server error');
    // The single assertion that matters: the original text is gone.
    expect(JSON.stringify(sent.body)).not.toMatch(/ECONNREFUSED|10\.0\.0\.7|27017/);
  });

  it('REPLACES the message of a plain InternalServerErrorException', () => {
    const sent = run(
      new InternalServerErrorException('Cast to ObjectId failed for "users"'),
    );

    expect(sent.status).toBe(500);
    expect(sent.body?.detail).toBe('Internal server error');
    expect(JSON.stringify(sent.body)).not.toMatch(/Cast to ObjectId|users/);
  });

  it('REPLACES a 503 that carries no authored problem body', () => {
    // A 503 is not automatically trustworthy — Mongoose and the HTTP
    // client can raise one too. Only `problem()` earns disclosure.
    const sent = run(
      new ServiceUnavailableException('upstream mongodb://user:pw@host down'),
    );

    expect(sent.status).toBe(503);
    expect(sent.body?.detail).toBe('Internal server error');
    expect(JSON.stringify(sent.body)).not.toMatch(/mongodb:\/\/|user:pw/);
  });

  // ── THE HONESTY HALF ───────────────────────────────────────────────

  it('KEEPS the message of a 503 authored through problem()', () => {
    const sent = run(
      new ServiceUnavailableException(
        problem(
          'PAYMENT_PROVIDER_NOT_CONFIGURED',
          'Online payment is not available yet — the payment provider is not configured.',
          { provider: 'razorpay' },
        ),
      ),
    );

    expect(sent.status).toBe(503);
    expect(sent.body?.detail).toBe(
      'Online payment is not available yet — the payment provider is not configured.',
    );
    expect(sent.body?.errors).toMatchObject({
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      provider: 'razorpay',
    });
  });

  // ── UNCHANGED BEHAVIOUR BELOW 500 ──────────────────────────────────

  it('passes a 4xx message through untouched', () => {
    const sent = run(new BadRequestException('phone must be 10 digits'));

    expect(sent.status).toBe(400);
    expect(sent.body?.detail).toBe('phone must be 10 digits');
  });

  it('keeps the machine-readable code on a 4xx problem', () => {
    const sent = run(
      new ConflictException(
        problem('OUT_OF_STOCK', 'Tomatoes just sold out', { productId: 'abc' }),
      ),
    );

    expect(sent.status).toBe(409);
    expect(sent.body?.detail).toBe('Tomatoes just sold out');
    expect(sent.body?.errors).toMatchObject({
      code: 'OUT_OF_STOCK',
      productId: 'abc',
    });
  });

  it('renders the RFC 7807 envelope from the brand name', () => {
    const sent = run(new BadRequestException('nope'));

    expect(sent.body?.type).toBe('https://tokri.app/errors/400');
    expect(sent.body?.status).toBe(400);
    expect(sent.body?.instance).toBe('/api/v1/anything');
    expect(typeof sent.body?.timestamp).toBe('string');
  });

  // ── THE NEAR MISSES ────────────────────────────────────────────────
  // `errors.code` must be the real discriminator, not "has an `errors`
  // key" — otherwise a validation pipe's `errors` array on an unexpected
  // 500 would be enough to unblank it.

  it('still replaces a 500 whose errors has no string code', () => {
    const sent = run(
      new InternalServerErrorException({
        message: 'internal detail that must not escape',
        errors: ['something', 'else'],
      }),
    );

    expect(sent.body?.detail).toBe('Internal server error');
    expect(JSON.stringify(sent.body)).not.toMatch(/must not escape/);
  });

  it('still replaces a 500 whose errors.code is not a string', () => {
    const sent = run(
      new InternalServerErrorException({
        message: 'internal detail that must not escape',
        errors: { code: 500 },
      }),
    );

    expect(sent.body?.detail).toBe('Internal server error');
    expect(JSON.stringify(sent.body)).not.toMatch(/must not escape/);
  });
});
