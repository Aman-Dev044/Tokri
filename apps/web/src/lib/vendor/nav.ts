import type { StorePermission } from './types';

/**
 * The vendor sidebar, in order of how often a shop owner touches it.
 *
 * Orders is first and Dashboard second on purpose — the dashboard is what you
 * read once in the morning, the board is what you live in. Settings is last
 * because a shop's address changes twice a decade.
 */

export type VendorNavIcon =
  | 'dashboard'
  | 'orders'
  | 'products'
  | 'inventory'
  | 'partners'
  | 'earnings'
  | 'billing'
  | 'staff'
  | 'settings';

export interface VendorNavItem {
  href: string;
  label: string;
  icon: VendorNavIcon;
  /** the single-letter accelerator, pressed with the panel focused */
  key: string;
  /** one line of what the screen is for — used by the ⌘K palette and titles */
  hint: string;
  /**
   * The permission the screen's main read needs. Items the signed-in person
   * lacks are not drawn. UX only: the API guard is the real check.
   */
  permission: StorePermission;
}

export const VENDOR_NAV: readonly VendorNavItem[] = [
  {
    href: '/vendor',
    label: 'Dashboard',
    icon: 'dashboard',
    key: 'd',
    hint: 'Today at a glance — orders, revenue, what needs you now',
    permission: 'orders.view',
  },
  {
    href: '/vendor/orders',
    label: 'Orders',
    icon: 'orders',
    key: 'o',
    hint: 'The board: new, preparing, ready for pickup',
    permission: 'orders.view',
  },
  {
    href: '/vendor/pos',
    label: 'Billing',
    icon: 'billing',
    key: 'b',
    hint: 'The counter: scan, charge, print the invoice',
    permission: 'billing.view',
  },
  {
    href: '/vendor/products',
    label: 'Products',
    icon: 'products',
    key: 'p',
    hint: 'Your catalogue — prices, photos, what is listed',
    permission: 'products.view',
  },
  {
    href: '/vendor/inventory',
    label: 'Inventory',
    icon: 'inventory',
    key: 'i',
    hint: 'Stock on hand, adjustments and their history',
    permission: 'products.view',
  },
  {
    href: '/vendor/partners',
    label: 'Delivery partners',
    icon: 'partners',
    key: 'r',
    hint: 'Your own riders and who is free right now',
    permission: 'riders.manage',
  },
  {
    href: '/vendor/earnings',
    label: 'Earnings',
    icon: 'earnings',
    key: 'e',
    hint: 'Gross, commission, net — and when it lands',
    permission: 'earnings.view',
  },
  {
    href: '/vendor/staff',
    label: 'Staff',
    icon: 'staff',
    key: 't',
    hint: 'Who works here and what each of them can do',
    permission: 'staff.manage',
  },
  {
    href: '/vendor/settings',
    label: 'Store settings',
    icon: 'settings',
    key: 's',
    hint: 'Profile, address, hours, cash on delivery',
    permission: 'store.manage',
  },
];

/**
 * `/vendor` matches only itself; every other entry matches its subtree.
 *
 * Without the exact case, Dashboard would light up on every screen in the panel
 * because every path starts with `/vendor`.
 */
export function isActiveHref(pathname: string, href: string): boolean {
  if (href === '/vendor') return pathname === '/vendor' || pathname === '/vendor/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function navItemFor(pathname: string): VendorNavItem | null {
  // Longest match first, so `/vendor/orders/abc` resolves to Orders and not to
  // Dashboard.
  const sorted = [...VENDOR_NAV].sort((a, b) => b.href.length - a.href.length);
  return sorted.find((item) => isActiveHref(pathname, item.href)) ?? null;
}

/** The items this person may see, in rail order. */
export function navFor(can: (permission: StorePermission) => boolean): VendorNavItem[] {
  return VENDOR_NAV.filter((item) => can(item.permission));
}
