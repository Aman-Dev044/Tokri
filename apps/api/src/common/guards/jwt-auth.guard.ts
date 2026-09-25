import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global authentication guard — registered as an APP_GUARD.
 *
 * DENY BY DEFAULT: every route in the application requires a valid access
 * token. A route becomes public only by carrying @Public().
 *
 * This is the inversion that matters. With route-by-route @UseGuards(),
 * one forgotten decorator silently exposes an endpoint and nobody finds
 * out until it is discovered from the outside. Here, a forgotten
 * decorator locks a route down instead.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    return super.canActivate(context);
  }
}
