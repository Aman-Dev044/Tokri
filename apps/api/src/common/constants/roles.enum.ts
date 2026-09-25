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
}

/** Roles that may act across every vendor's data. */
export const PLATFORM_ROLES: readonly Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

export enum UserStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
}
