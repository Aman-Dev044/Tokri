import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
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
 *  2. Unexpected errors return a generic message. Stack traces and driver
 *     errors go to the log, never to the client, so internals are not
 *     leaked to an attacker probing for information.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

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

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      type: `https://mandi.app/errors/${status}`,
      title: HttpStatus[status] ?? 'Error',
      status,
      // 5xx never echoes internals back to the caller.
      detail: status >= 500 ? 'Internal server error' : detail,
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
