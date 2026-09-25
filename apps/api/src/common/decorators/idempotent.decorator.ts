import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

export interface IdempotentOptions {
  /**
   * Logical name for the operation, stored alongside the key.
   * Defaults to `METHOD /controller/path` when omitted.
   */
  scope?: string;
  /**
   * When true (the default) a request without an `Idempotency-Key` header
   * is rejected with 400. Set false to make the header optional — only
   * appropriate for operations that are already naturally idempotent.
   */
  required?: boolean;
}

/**
 * Marks a mutating route as replay-safe.
 *
 *     @Idempotent('checkout.create')
 *     @UseInterceptors(IdempotencyInterceptor)
 *     @Post('checkout')
 *
 * See `IdempotencyInterceptor` for the mechanics. Per §6.1 of the
 * implementation plan, checkout and payment endpoints REQUIRE the header.
 */
export const Idempotent = (
  scopeOrOptions?: string | IdempotentOptions,
): MethodDecorator & ClassDecorator => {
  const options: IdempotentOptions =
    typeof scopeOrOptions === 'string'
      ? { scope: scopeOrOptions }
      : (scopeOrOptions ?? {});

  return SetMetadata(IDEMPOTENT_KEY, {
    scope: options.scope,
    required: options.required ?? true,
  } satisfies IdempotentOptions);
};
