import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import {
  PERMISSIONS_KEY,
  PermissionRule,
} from '../decorators/require-permission.decorator';
import { Role, STORE_ROLES } from '../constants/roles.enum';
import { JwtUser } from '../decorators/current-user.decorator';

/**
 * Store-level authorization — the guard that stops a biller voiding a
 * sale or a packer reading the store's earnings.
 *
 * Registered as an APP_GUARD AFTER `VendorScopeGuard`, so by the time it
 * runs the caller is known to be authenticated, of an admitted role, and
 * pinned to their own store. This guard answers the last question: may
 * THIS person do THIS thing inside that store?
 *
 * The permissions come from `req.user.permissions`, which `JwtStrategy`
 * resolved from the database on this very request. Nothing here reads a
 * claim out of the token, so a permission revoked a second ago is gone.
 *
 * ── Deny by default ─────────────────────────────────────────────────────
 * A store route that admits STAFF but declares no rule is refused for
 * staff outright — forgetting the decorator locks the route down rather
 * than opening it. The route sweep in `store-staff.spec.ts` additionally
 * fails the build for any `/vendor/*` route without a rule, so the owner
 * path cannot drift either.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      targets,
    );
    if (isPublic) return true;

    const user = context.switchToHttp().getRequest().user as
      | JwtUser
      | undefined;
    if (!user) return true; // JwtAuthGuard already rejected it

    const rule = this.reflector.getAllAndOverride<PermissionRule | undefined>(
      PERMISSIONS_KEY,
      targets,
    );

    if (!rule) {
      const roles =
        this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets) ??
        [];
      // A route that lets staff in must say what staff need. One that
      // does not is a forgotten decorator, and a forgotten decorator
      // must fail closed.
      if (user.role === Role.STAFF && roles.includes(Role.STAFF)) {
        throw new ForbiddenException('This route declares no store permission');
      }
      return true;
    }

    // A rule only means something inside a store. Any other role reaching
    // a ruled route is a wiring mistake upstream — refuse it.
    if (!STORE_ROLES.includes(user.role)) {
      throw new ForbiddenException('Not a member of a store');
    }

    if (rule.mode === 'member') return true;

    const held = new Set(user.permissions ?? []);
    const allowed =
      rule.mode === 'any'
        ? rule.permissions.some((permission) => held.has(permission))
        : rule.permissions.every((permission) => held.has(permission));

    if (!allowed) {
      throw new ForbiddenException(
        `Missing store permission: ${rule.permissions.join(rule.mode === 'any' ? ' or ' : ' and ')}`,
      );
    }

    return true;
  }
}
