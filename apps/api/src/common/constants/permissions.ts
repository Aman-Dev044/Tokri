import { Role } from './roles.enum';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  STORE PERMISSIONS
 * ════════════════════════════════════════════════════════════════════════
 *
 * The closed catalogue of things a person can do inside ONE store. Every
 * `/vendor/*` route names the permission it needs with
 * `@RequirePermission(...)`, and `PermissionsGuard` checks it against the
 * caller's permissions — which `JwtStrategy` reads from the DATABASE on
 * every request, so revoking one takes effect on the very next call
 * rather than when a 15-minute token happens to expire.
 *
 * The owner (Role.VENDOR) holds every permission implicitly. Staff
 * (Role.STAFF) hold their preset's set, or an explicit list for CUSTOM.
 *
 * A string the catalogue does not know is dropped on read, never trusted:
 * a stale permission left in the database by an older build must not
 * become an ambient grant.
 */
export enum Permission {
  ORDERS_VIEW = 'orders.view',
  ORDERS_UPDATE = 'orders.update',
  PRODUCTS_VIEW = 'products.view',
  PRODUCTS_MANAGE = 'products.manage',
  INVENTORY_ADJUST = 'inventory.adjust',
  BILLING_VIEW = 'billing.view',
  BILLING_CREATE = 'billing.create',
  BILLING_VOID = 'billing.void',
  STAFF_MANAGE = 'staff.manage',
  RIDERS_MANAGE = 'riders.manage',
  EARNINGS_VIEW = 'earnings.view',
  STORE_MANAGE = 'store.manage',
}

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

const KNOWN = new Set<string>(ALL_PERMISSIONS);

export const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string' && KNOWN.has(value);

/** The job a staff member was hired for. CUSTOM means "the list decides". */
export enum StaffRole {
  MANAGER = 'MANAGER',
  BILLER = 'BILLER',
  ORDERS = 'ORDERS',
  INVENTORY = 'INVENTORY',
  SUPERVISOR = 'SUPERVISOR',
  CUSTOM = 'CUSTOM',
}

/**
 * The default set for each preset.
 *
 * ── Why SUPERVISOR has no earnings.view ─────────────────────────────────
 * "View permissions only" is read as the OPERATIONAL views. MANAGER, the
 * most senior preset, deliberately excludes the store's money, and a
 * preset below it holding something above it would also make a SUPERVISOR
 * the one preset a MANAGER could never create — a manager cannot grant a
 * permission they do not hold. An owner who wants a supervisor to see
 * earnings uses CUSTOM.
 */
export const STAFF_PRESETS: Readonly<
  Record<Exclude<StaffRole, StaffRole.CUSTOM>, readonly Permission[]>
> = {
  [StaffRole.MANAGER]: ALL_PERMISSIONS.filter(
    (permission) => permission !== Permission.EARNINGS_VIEW,
  ),
  [StaffRole.BILLER]: [
    Permission.BILLING_VIEW,
    Permission.BILLING_CREATE,
    Permission.PRODUCTS_VIEW,
  ],
  [StaffRole.ORDERS]: [
    Permission.ORDERS_VIEW,
    Permission.ORDERS_UPDATE,
    Permission.PRODUCTS_VIEW,
  ],
  [StaffRole.INVENTORY]: [
    Permission.PRODUCTS_VIEW,
    Permission.PRODUCTS_MANAGE,
    Permission.INVENTORY_ADJUST,
  ],
  [StaffRole.SUPERVISOR]: [
    Permission.ORDERS_VIEW,
    Permission.PRODUCTS_VIEW,
    Permission.BILLING_VIEW,
  ],
};

/** Deduplicated, catalogue-ordered, unknown strings dropped. */
export function normalisePermissions(values: readonly unknown[]): Permission[] {
  const wanted = new Set(values.filter(isPermission));
  return ALL_PERMISSIONS.filter((permission) => wanted.has(permission));
}

/**
 * The permissions a stored profile actually confers.
 *
 * A preset resolves from THIS FILE, not from the stored list, so changing
 * a preset here changes every staff member on it — which is what "preset"
 * means. CUSTOM resolves from the stored list.
 */
export function permissionsForProfile(
  profile:
    | { staffRole?: StaffRole | string | null; permissions?: readonly unknown[] | null }
    | null
    | undefined,
): Permission[] {
  if (!profile?.staffRole) return [];
  if (profile.staffRole === StaffRole.CUSTOM) {
    return normalisePermissions(profile.permissions ?? []);
  }
  const preset =
    STAFF_PRESETS[profile.staffRole as Exclude<StaffRole, StaffRole.CUSTOM>];
  return preset ? normalisePermissions(preset) : [];
}

/** What a user of any role holds inside their store. */
export function permissionsFor(
  role: Role,
  profile: Parameters<typeof permissionsForProfile>[0],
): Permission[] {
  if (role === Role.VENDOR) return [...ALL_PERMISSIONS];
  if (role === Role.STAFF) return permissionsForProfile(profile);
  return [];
}
