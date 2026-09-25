import {
  ExecutionContext,
  ForbiddenException,
  createParamDecorator,
} from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * The tenant id, taken from `req.vendorScope`.
 *
 * `VendorScopeGuard` (an APP_GUARD, §4.2) puts it there from the
 * SIGNATURE-VERIFIED JWT. Nothing in this module ever reads a vendorId
 * from a route param, a query string or a request body — all three are
 * attacker-controlled, and trusting one is exactly the hole that
 * `test/integration/vendor-isolation.spec.ts` exists to prove closed.
 *
 * It throws rather than returning `undefined`: a handler that received an
 * empty scope would build a filter of `{ vendorId: undefined }`, which
 * Mongoose silently drops — turning "my products" into "every product on
 * the platform". Failing loudly is the only safe degradation.
 */
export const VendorScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<{ vendorScope?: string | null }>();

    const scope = req.vendorScope;
    if (typeof scope !== 'string' || !Types.ObjectId.isValid(scope)) {
      throw new ForbiddenException('This token carries no vendor scope');
    }

    return scope;
  },
);

/** The scope as an ObjectId, for aggregation `$match` stages. */
export const scopeId = (vendorScope: string): Types.ObjectId =>
  new Types.ObjectId(vendorScope);

/** `null` for anything that is not a well-formed ObjectId string. */
export const toObjectIdOrNull = (value: string | null): Types.ObjectId | null =>
  value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
