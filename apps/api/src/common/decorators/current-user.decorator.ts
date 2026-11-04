import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../constants/roles.enum';
import type { Permission, StaffRole } from '../constants/permissions';

export interface JwtUser {
  /** User id (JWT `sub`). */
  sub: string;
  role: Role;
  /** Present for VENDOR, STAFF and DELIVERY users. Drives tenant scoping. */
  vendorId?: string;
  tokenId: string;
  /**
   * What this person may do inside their store, resolved from the
   * DATABASE on this request (never from the token). Every permission for
   * the owner, the profile's set for STAFF, empty for everyone else.
   */
  permissions?: readonly Permission[];
  /** STAFF only — the job title the permissions came from. */
  staffRole?: StaffRole | null;
  /** STAFF only — for the cashier name on an invoice. */
  name?: string;
}

/**
 * Injects the verified JWT payload.
 *
 * This is the ONLY trusted source of identity in a request. A user id,
 * role or vendorId read from params, query or body is attacker-controlled
 * and must never be used for an authorization decision.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtUser | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest().user as JwtUser;
    return data ? user?.[data] : user;
  },
);
