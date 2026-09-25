import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../constants/roles.enum';
import { JwtUser } from '../decorators/current-user.decorator';

/**
 * Global role guard — registered as an APP_GUARD, runs after JwtAuthGuard.
 *
 * SUPER_ADMIN implicitly satisfies any requirement for ADMIN, so routes
 * only need to declare the lowest role that may use them.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @Roles() on the route: authentication alone is enough.
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as JwtUser;
    if (!user?.role) throw new ForbiddenException('No role on token');

    const allowed =
      required.includes(user.role) ||
      // SUPER_ADMIN inherits every ADMIN permission.
      (user.role === Role.SUPER_ADMIN && required.includes(Role.ADMIN));

    if (!allowed) {
      throw new ForbiddenException('Insufficient role for this resource');
    }

    return true;
  }
}
