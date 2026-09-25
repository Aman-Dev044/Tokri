import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { Request } from 'express';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { OWNS_KEY, OwnsOptions } from '../decorators/owns.decorator';
import { PLATFORM_ROLES } from '../constants/roles.enum';
import { JwtUser } from '../decorators/current-user.decorator';

/**
 * Object-level authorization — the guard that stops customer A reading
 * customer B's order by changing one digit in the URL.
 *
 * Registered as an APP_GUARD, last in the chain, and inert on any route
 * that does not carry `@Owns(...)`. Routes opt in:
 *
 *     @Owns({ model: 'Order', param: 'id', field: 'customerId' })
 *     @Get('orders/:id')
 *
 * ── Why 404 and not 403 ─────────────────────────────────────────────────
 * A 403 confirms the document EXISTS and is simply not yours. That turns
 * the endpoint into an enumeration oracle: walk the id space, and every
 * 403 marks a real order while every 404 marks an empty slot. An attacker
 * learns order volume, id allocation rate and which ids to target with the
 * next bug they find. Returning 404 for "missing" and "not yours" alike
 * gives them nothing: to a non-owner, the resource simply does not exist.
 *
 * The same reasoning covers a malformed id — also 404, never a 400.
 *
 * ── Why the id comes from the token ─────────────────────────────────────
 * The comparison is always against `req.user.sub`, which came out of a
 * signature-verified JWT. A user id in a param, query or body is
 * attacker-controlled and is never an authorization input.
 */
@Injectable()
export class ResourceOwnerGuard implements CanActivate {
  private readonly logger = new Logger(ResourceOwnerGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const options = this.reflector.getAllAndOverride<OwnsOptions | undefined>(
      OWNS_KEY,
      [context.getHandler(), context.getClass()],
    );
    // No @Owns() on this route — nothing to check.
    if (!options) return true;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: JwtUser }>();
    const user = req.user;

    // Unauthenticated requests never reach here: JwtAuthGuard runs first
    // and has already rejected them.
    if (!user) return true;

    // Platform roles are cross-tenant and cross-customer by design — that
    // is what an admin support console is for.
    if (PLATFORM_ROLES.includes(user.role)) return true;

    const paramName = options.param ?? 'id';
    const rawParam: unknown = req.params?.[paramName];

    const notFound = new NotFoundException('Resource not found');

    // Express types a route param as `string | string[]` (a repeated
    // param arrives as an array). Anything that is not a single, valid
    // ObjectId string is a 404 — NOT a 400 and NOT a 403. A distinct
    // "malformed id" error would tell a prober which id shapes are real,
    // which is the enumeration leak this guard exists to close.
    if (typeof rawParam !== 'string' || !Types.ObjectId.isValid(rawParam)) {
      throw notFound;
    }
    const resourceId: string = rawParam;

    const model = this.connection.models[options.model];
    if (!model) {
      // A wiring mistake, not a client error: the model was never
      // registered with MongooseModule.forFeature. Fail loudly in the log,
      // generically to the caller.
      this.logger.error(
        `@Owns references model "${options.model}", which is not registered on this connection. ` +
          `Registered models: ${Object.keys(this.connection.models).join(', ')}`,
      );
      throw new InternalServerErrorException();
    }

    const doc = await model
      .findById(resourceId)
      .select(options.field)
      .lean<Record<string, unknown> | null>()
      .exec();

    if (!doc) throw notFound;

    const owner = doc[options.field];
    if (owner === undefined || owner === null) {
      this.logger.error(
        `@Owns references field "${options.field}" on ${options.model}, which is absent on document ${resourceId}.`,
      );
      throw notFound;
    }

    // ObjectId | string | Buffer all normalise through String().
    if (String(owner) !== user.sub) {
      this.logger.warn(
        `Ownership denied: ${user.role} ${user.sub} requested ${options.model} ${resourceId}`,
      );
      throw notFound;
    }

    return true;
  }
}
