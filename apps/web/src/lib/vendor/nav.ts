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
  | 'settings';

export interface VendorNavItem {
  href: string;
  label: string;
  icon: VendorNavIcon;
  /** the single-letter accelerator, pressed with the panel focused */
  key: string;
  /** one line of what the screen is for — used by the ⌘K palette and titles */
  hint: string;
}

export const VENDOR_NAV: readonly VendorNavItem[] = [
  {
    href: '/vendor',
    label: 'Dashboard',
    icon: 'dashboard',
    key: 'd',
    hint: 'Today at a glance — orders, revenue, what needs you now',
  },
  {
    href: '/vendor/orders',
    label: 'Orders',
    icon: 'orders',
    key: 'o',
    hint: 'The board: new, preparing, ready for pickup',
  },
  {
    href: '/vendor/products',
    label: 'Products',
    icon: 'products',
    key: 'p',
    hint: 'Your catalogue — prices, photos, what is listed',
  },
  {
    href: '/vendor/inventory',
    label: 'Inventory',
    icon: 'inventory',
    key: 'i',
    hint: 'Stock on hand, adjustments and their history',
  },
  {
    href: '/vendor/partners',
    label: 'Delivery partners',
    icon: 'partners',
    key: 'r',
    hint: 'Your own riders and who is free right now',
  },
  {
    href: '/vendor/earnings',
    label: 'Earnings',
    icon: 'earnings',
    key: 'e',
    hint: 'Gross, commission, net — and when it lands',
  },
  {
    href: '/vendor/settings',
    label: 'Store settings',
    icon: 'settings',
    key: 's',
    hint: 'Profile, address, hours, cash on delivery',
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
