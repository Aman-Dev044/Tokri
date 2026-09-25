import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '../constants/roles.enum';

export interface JwtUser {
  /** User id (JWT `sub`). */
  sub: string;
  role: Role;
  /** Present for VENDOR and DELIVERY users. Drives tenant scoping. */
  vendorId?: string;
  tokenId: string;
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
