/**
 * Platform roles, ordered by privilege.
 *
 * SUPER_ADMIN sits above ADMIN: it owns platform configuration, admin
 * account management and anything financially irreversible. ADMIN runs
 * day-to-day operations (vendor approval, order oversight, support).
 */
export enum Role {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  VENDOR = 'vendor',
  CUSTOMER = 'customer',
  DELIVERY = 'delivery',
  /**
   * An employee of ONE store — a biller, a packer, a shift manager.
   *
   * Carries `vendorId` exactly like VENDOR, plus a `staffProfile` whose
   * permissions decide which `/vendor/*` routes it may call. It is NOT a
   * lesser VENDOR: every vendor route names the permission it needs
   * (`@RequirePermission`), and `PermissionsGuard` refuses a STAFF caller
   * on any store route that names none. See `permissions.ts`.
   */
  STAFF = 'staff',
}

/** Roles that may act across every vendor's data. */
export const PLATFORM_ROLES: readonly Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

/**
 * Roles that act INSIDE one store, scoped to the `vendorId` on their own
 * user record. The owner holds every store permission implicitly; staff
 * hold what their profile grants.
 */
export const STORE_ROLES: readonly Role[] = [Role.VENDOR, Role.STAFF];

export enum UserStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
}
