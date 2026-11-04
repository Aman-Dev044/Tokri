import { SetMetadata } from '@nestjs/common';
import { Permission } from '../constants/permissions';

export const PERMISSIONS_KEY = 'storePermissions';

/**
 * The permission rule a store route declares.
 *
 *  · `all` — the caller must hold every listed permission.
 *  · `any` — one of them is enough.
 *  · `member` — any active member of THIS store, no specific permission.
 *    Reserved for identity reads (`GET /vendor/me`) and pinned by an
 *    allowlist in `test/integration/store-staff.spec.ts`, so it cannot
 *    quietly become the way to skip choosing a permission.
 */
export interface PermissionRule {
  mode: 'all' | 'any' | 'member';
  permissions: readonly Permission[];
}

/**
 * Names the store permission a `/vendor/*` route needs. ALL of them, when
 * more than one is listed.
 *
 *     @RequirePermission(Permission.ORDERS_UPDATE)
 *     @Patch(':id/accept')
 *
 * Enforced by `PermissionsGuard` (an APP_GUARD). Deny by default twice
 * over: the guard refuses a STAFF caller on any store route that declares
 * no rule, and the route sweep in `store-staff.spec.ts` fails the build
 * for any `/vendor/*` route without one.
 */
export const RequirePermission = (
  ...permissions: [Permission, ...Permission[]]
) =>
  SetMetadata(PERMISSIONS_KEY, {
    mode: 'all',
    permissions,
  } satisfies PermissionRule);

/** Like `@RequirePermission`, but ANY one of the listed permissions will do. */
export const RequireAnyPermission = (
  ...permissions: [Permission, Permission, ...Permission[]]
) =>
  SetMetadata(PERMISSIONS_KEY, {
    mode: 'any',
    permissions,
  } satisfies PermissionRule);

/**
 * Any active member of the store. See `PermissionRule.member` — this is an
 * allowlisted exception, not a convenience.
 */
export const StoreMember = () =>
  SetMetadata(PERMISSIONS_KEY, {
    mode: 'member',
    permissions: [],
  } satisfies PermissionRule);
