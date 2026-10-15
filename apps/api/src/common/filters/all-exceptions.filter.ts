import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

/** Keys whose values must never reach a log line or an error response. */
const REDACTED_KEYS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'otp',
  'secret',
  'signature',
  'authorization',
  'cookie',
];

export const scrub = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        REDACTED_KEYS.some((r) => k.toLowerCase().includes(r.toLowerCase()))
          ? [k, '[REDACTED]']
          : [k, scrub(v)],
      ),
    );
  }
  return value;
};

/**
 * Global exception filter — RFC 7807 problem+json shape.
 *
 * Two security properties:
 *  1. Secrets are scrubbed from anything logged.
 *  2. UNEXPECTED errors return a generic message. Stack traces and driver
 *     errors go to the log, never to the client, so internals are not
 *     leaked to an attacker probing for information.
 *
 *     "Unexpected" is doing real work in that sentence. A 5xx thrown
 *     deliberately with a `problem()` body — a 503 saying the payment
 *     gateway has no credentials, say — carries a sentence an author wrote
 *     FOR the caller to read, and blanking it reports a crash that never
 *     happened. `isAuthoredProblem` below is the line between the two.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * The RFC 7807 `type` namespace, on EVERY error this API returns.
   *
   * Built from APP_NAME rather than written out, because a hardcoded
   * domain here survives a rename silently: nothing fails, every error
   * body just keeps pointing at the old product's docs. It is an
   * identifier, not a link that has to resolve — RFC 7807 says a `type`
   * URI "need not be dereferenceable" — so it costs nothing to keep it
   * honest.
   */
  private readonly errorBase: string;

  constructor(config: ConfigService) {
    const appName = config.getOrThrow<string>('brand.name');
    this.errorBase = `https://${appName.toLowerCase()}.app/errors`;
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload = isHttp ? exception.getResponse() : null;
    const detail =
      typeof payload === 'string'
        ? payload
        : ((payload as Record<string, unknown>)?.message as string) ??
          'An unexpected error occurred';

    // A body built by `problem()` — the only thing that produces a
    // nested `errors.code` — is a message someone chose to show. An
    // unhandled throw has no `errors` object at all, so it can never
    // satisfy this and can never smuggle a driver message out.
    const isAuthoredProblem =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { errors?: unknown }).errors === 'object' &&
      (payload as { errors?: unknown }).errors !== null &&
      typeof ((payload as { errors: { code?: unknown } }).errors.code) ===
        'string';

    if (status >= 500) {
      // Logged either way: a 503 is still worth a line, because "the
      // gateway is unconfigured" is something an operator wants to see.
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      type: `${this.errorBase}/${status}`,
      title: HttpStatus[status] ?? 'Error',
      status,
      // An unexpected 5xx never echoes internals back to the caller. A
      // deliberate one, authored through `problem()`, says what it means.
      detail: status >= 500 && !isAuthoredProblem ? 'Internal server error' : detail,
      instance: req.url,
      ...(isHttp &&
      typeof payload === 'object' &&
      (payload as Record<string, unknown>)?.errors
        ? { errors: scrub((payload as Record<string, unknown>).errors) }
        : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
