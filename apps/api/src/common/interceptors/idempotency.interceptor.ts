import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Request, Response } from 'express';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, concatMap, map, mergeMap } from 'rxjs/operators';

import {
  IdempotencyKey,
  IdempotencyKeyDocument,
} from '../../database/schemas/idempotency-key.schema';
import {
  IDEMPOTENT_KEY,
  IdempotentOptions,
} from '../decorators/idempotent.decorator';
import { JwtUser } from '../decorators/current-user.decorator';

/** The lean projection this interceptor reads back. */
interface IdempotencyRecord {
  key: string;
  scope: string;
  userId: string | null;
  completed: boolean;
  statusCode: number | null;
  response: unknown;
}

/** Mongo duplicate-key error, without importing the `mongodb` package. */
const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/**
 * Replay protection for mutating endpoints.
 *
 * ── The problem ─────────────────────────────────────────────────────────
 * A customer taps "Place order" twice. Or their connection drops after the
 * server committed but before the response arrived, and the app retries.
 * Either way the naive outcome is two orders, two stock reservations and
 * two charges.
 *
 * ── The mechanism ───────────────────────────────────────────────────────
 * Opt a route in with `@Idempotent()` + `@UseInterceptors(IdempotencyInterceptor)`.
 * The caller sends an `Idempotency-Key` header.
 *
 *   1. A reservation document is INSERTED FIRST. The unique index on `key`
 *      is the lock, so of two concurrent requests exactly one wins the
 *      insert; the loser gets a 409 "still in progress" rather than both
 *      executing the handler.
 *   2. The handler runs, and its response body is stored on the record.
 *   3. Any later request with the same key replays that stored body and
 *      carries an `Idempotent-Replay: true` header.
 *   4. If the handler THROWS, the reservation is deleted — a failed attempt
 *      must not poison the key, or the client can never legitimately retry.
 *
 * The key is also bound to the authenticated caller, so a guessed or
 * leaked key cannot be used to read back somebody else's response.
 *
 * Records expire after 24 hours (TTL index on `createdAt`).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  /** Conservative token shape — a UUID, ULID or nanoid all satisfy it. */
  private static readonly KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

  constructor(
    private readonly reflector: Reflector,
    @InjectModel(IdempotencyKey.name)
    private readonly keys: Model<IdempotencyKeyDocument>,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const options = this.reflector.getAllAndOverride<
      IdempotentOptions | undefined
    >(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);

    // Not marked @Idempotent() — nothing to do. Safe to register globally.
    if (!options) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { user?: JwtUser }>();
    const res = http.getResponse<Response>();

    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;

    if (!key) {
      if (options.required === false) return next.handle();
      throw new BadRequestException(
        'An Idempotency-Key header is required for this operation',
      );
    }

    if (!IdempotencyInterceptor.KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key must be 8–128 characters of [A-Za-z0-9._:-]',
      );
    }

    const scope =
      options.scope ??
      `${req.method} ${context.getClass().name}.${context.getHandler().name}`;
    const userId = req.user?.sub ?? null;

    const existing = await this.keys
      .findOne({ key })
      .lean<IdempotencyRecord | null>()
      .exec();

    if (existing) return this.replay(existing, scope, userId, res);

    try {
      await this.keys.create({
        key,
        scope,
        userId,
        completed: false,
        statusCode: null,
        response: null,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;

      // Lost the insert race. Re-read and treat it like any other replay.
      const raced = await this.keys
        .findOne({ key })
        .lean<IdempotencyRecord | null>()
        .exec();

      if (!raced) {
        throw new ConflictException(
          'This Idempotency-Key is already in use. Retry with a new key.',
        );
      }
      return this.replay(raced, scope, userId, res);
    }

    // Nest applies the route's status code only AFTER the handler resolves,
    // so `res.statusCode` is still 200 at this point. Read the declared
    // @HttpCode instead, and fall back to whatever the response currently
    // carries.
    const declaredStatus = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );

    return next.handle().pipe(
      concatMap((body: unknown) =>
        from(
          this.keys
            .updateOne(
              { key },
              {
                completed: true,
                statusCode: declaredStatus ?? res.statusCode,
                response: body ?? null,
              },
            )
            .exec(),
        ).pipe(map(() => body)),
      ),
      catchError((error: unknown) =>
        // Release the key so the client can retry the operation for real.
        from(this.keys.deleteOne({ key }).exec()).pipe(
          mergeMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  /**
   * Returns the stored response for a key that has already been spent.
   *
   * Every mismatch — wrong scope, wrong caller — produces the SAME generic
   * 409. Distinguishing "this key belongs to another user" from "this key
   * was used on another endpoint" would confirm the existence of somebody
   * else's in-flight operation.
   */
  private replay(
    record: IdempotencyRecord,
    scope: string,
    userId: string | null,
    res: Response,
  ): Observable<unknown> {
    if (record.scope !== scope || record.userId !== userId) {
      this.logger.warn(
        `Idempotency-Key reused across scopes or callers (stored scope: ${record.scope})`,
      );
      throw new ConflictException(
        'This Idempotency-Key has already been used. Retry with a new key.',
      );
    }

    if (!record.completed) {
      throw new ConflictException(
        'A request with this Idempotency-Key is still in progress',
      );
    }

    res.setHeader('Idempotent-Replay', 'true');
    return of(record.response);
  }
}
