import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PLATFORM_ROLES, Role } from '../constants/roles.enum';
import { JwtUser } from '../decorators/current-user.decorator';

/**
 * Multi-tenant isolation — the guard that stops vendor A reading vendor B.
 *
 * The tenant id is INJECTED from the verified JWT onto `req.vendorScope`.
 * It is never read from a route param, query string or request body,
 * because all three are attacker-controlled.
 *
 * Repository methods for vendor-owned collections take the scope as a
 * REQUIRED argument, so the filter cannot be forgotten:
 *
 *     findOrder(orderId: string, vendorScope: string) {
 *       return this.model.findOne({ _id: orderId, vendorId: vendorScope });
 *     }
 *
 * Proven by `test/integration/vendor-isolation.spec.ts`, which authenticates
 * as vendor A and addresses every one of vendor B's resources.
 */
@Injectable()
export class VendorScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as JwtUser | undefined;
    if (!user) return true; // JwtAuthGuard already rejected it

    // Platform roles are cross-vendor by design.
    if (PLATFORM_ROLES.includes(user.role)) {
      req.vendorScope = null;
      return true;
    }

    // A VENDOR is meaningless without a tenant: every one of their routes
    // filters on it, so a token without one is broken and must be rejected.
    //
    // STAFF is scoped exactly the same way, and from the same place: the
    // `vendorId` on their OWN user record, re-read by JwtStrategy on every
    // request. A staff member of store A therefore cannot name store B
    // anywhere — there is no input that reaches this value.
    if (user.role === Role.VENDOR || user.role === Role.STAFF) {
      if (!user.vendorId) {
        throw new ForbiddenException('Token carries no vendor scope');
      }
      req.vendorScope = user.vendorId;
      return true;
    }

    // A DELIVERY partner MAY belong to a vendor, or may be on the platform
    // pool — `DeliveryPartner.vendorId` is nullable by design (plan §5.1).
    // Requiring one here 403'd every pool rider on every route.
    //
    // Riders are not scoped by tenant anyway: their routes are scoped to
    // their OWN partner record and their OWN assigned order, so a null
    // scope removes nothing. Scope is set when present purely so a
    // vendor-owned rider still cannot read across tenants.
    if (user.role === Role.DELIVERY) {
      req.vendorScope = user.vendorId ?? null;
    }

    return true;
  }
}
