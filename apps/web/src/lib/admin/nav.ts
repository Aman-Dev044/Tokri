/**
 * ★ THE ADMIN NAVIGATION — one menu, two roles.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HIDING A MENU ITEM IS UX, NOT SECURITY.                                  │
 * │                                                                          │
 * │ `superAdmin: true` keeps a link out of a plain ADMIN's sidebar and out   │
 * │ of their ⌘K palette. It stops nobody: the URL can be typed, and the      │
 * │ request can be made with curl. The enforcement is the API guard chain    │
 * │ (plan §4.2) — ThrottlerGuard → JwtAuthGuard → RolesGuard → … — which     │
 * │ runs on every request regardless of what this file decided to draw.      │
 * │                                                                          │
 * │ A hidden link is not a locked door. Never let one stand in for a role    │
 * │ check on the server.                                                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ── THE PRODUCT DISTINCTION THIS FILE ENCODES ───────────────────────────────
 * SUPER_ADMIN is GOVERNANCE: money, commission, settlements, the team, the
 * platform config. ADMIN is OPERATIONS: what needs doing in the next ten
 * minutes. So the ordering is ops-first for BOTH roles — a super admin who
 * needs the live board should not have to scroll past the settlement cycle to
 * reach it — and the governance sections are appended, badged, for the one
 * role that owns them.
 *
 *   ADMIN       13 destinations, ops queues at the top
 *   SUPER_ADMIN the same 13, plus Payments, Settlements, Reports, Team,
 *               Settings — 18 in total
 *
 * ── THE HREFS ARE A CONTRACT ────────────────────────────────────────────────
 * Each one is a folder under `app/admin/`. Changing a path here without moving
 * the folder produces a sidebar link that 404s, which is the single most common
 * way a console rots.
 */

import type { AdminLevel } from './types';

export type NavIconKey =
  | 'overview'
  | 'board'
  | 'dispatch'
  | 'approvals'
  | 'issues'
  | 'stock'
  | 'vendors'
  | 'orders'
  | 'customers'
  | 'riders'
  | 'catalog'
  | 'payments'
  | 'settlements'
  | 'coupons'
  | 'reports'
  | 'audit'
  | 'team'
  | 'settings';

/**
 * The three queues whose sidebar entry carries a live count from
 * `GET /admin/ops/summary`. A badge is only ever a number of things WAITING —
 * never a notification dot, never a "new" flag — because the only reason to
 * put a number next to a menu item is to let someone triage without clicking.
 */
export type NavBadgeKey = 'approvals' | 'issues' | 'stock';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  /** super-admin only: badged in the sidebar, hidden from a plain ADMIN */
  superAdmin?: boolean;
  /** live count from the ops summary poll */
  badge?: NavBadgeKey;
  /** one line for the ⌘K palette */
  hint: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    // Everything with a clock on it. This group is the ADMIN's whole job.
    label: 'Right now',
    items: [
      {
        href: '/admin',
        label: 'Dashboard',
        icon: 'overview',
        hint: 'What needs doing, in severity order',
      },
      {
        href: '/admin/board',
        label: 'Live board',
        icon: 'board',
        hint: 'Every live order, by lane, with its SLA',
      },
      {
        href: '/admin/dispatch',
        label: 'Dispatch',
        icon: 'dispatch',
        hint: 'Unassigned orders and who is free to take them',
      },
      {
        href: '/admin/approvals',
        label: 'Approvals',
        icon: 'approvals',
        badge: 'approvals',
        hint: 'Vendors and riders waiting to be let in',
      },
      {
        href: '/admin/issues',
        label: 'Issues',
        icon: 'issues',
        badge: 'issues',
        hint: 'Open support issues, oldest first',
      },
      {
        href: '/admin/stock',
        label: 'Stock alerts',
        icon: 'stock',
        badge: 'stock',
        hint: 'Low and out-of-stock lines across vendors',
      },
    ],
  },
  {
    label: 'Marketplace',
    items: [
      { href: '/admin/orders', label: 'Orders', icon: 'orders', hint: 'Every order, across every vendor' },
      { href: '/admin/vendors', label: 'Vendors', icon: 'vendors', hint: 'Approve, suspend, set commission' },
      {
        href: '/admin/customers',
        label: 'Customers',
        icon: 'customers',
        hint: 'Accounts, addresses, order history',
      },
      { href: '/admin/riders', label: 'Riders', icon: 'riders', hint: 'Fleet, availability, assignments' },
      { href: '/admin/catalog', label: 'Catalog', icon: 'catalog', hint: 'Products, categories, stock levels' },
      { href: '/admin/coupons', label: 'Coupons', icon: 'coupons', hint: 'Codes, limits, redemption' },
    ],
  },
  {
    // Money is governance. A plain ADMIN sees none of it.
    label: 'Money',
    items: [
      {
        href: '/admin/payments',
        label: 'Payments',
        icon: 'payments',
        superAdmin: true,
        hint: 'Captures, refunds, webhook failures',
      },
      {
        href: '/admin/settlements',
        label: 'Settlements',
        icon: 'settlements',
        superAdmin: true,
        hint: 'Weekly vendor payouts — Monday cycle',
      },
      {
        href: '/admin/reports',
        label: 'Reports',
        icon: 'reports',
        superAdmin: true,
        hint: 'Sales, commission, exports',
      },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/admin/audit', label: 'Audit log', icon: 'audit', hint: 'Every mutation, with before and after' },
      {
        href: '/admin/team',
        label: 'Team',
        icon: 'team',
        superAdmin: true,
        hint: 'Admin accounts and access levels',
      },
      {
        href: '/admin/settings',
        label: 'Settings',
        icon: 'settings',
        superAdmin: true,
        hint: 'Platform-wide configuration',
      },
    ],
  },
];

/** Flattened, for the ⌘K palette and for active-route matching. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** What this role is allowed to SEE. Presentation only — see the header. */
export function visibleNav(level: AdminLevel): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => level === 'SUPER_ADMIN' || !item.superAdmin),
  })).filter((group) => group.items.length > 0);
}

/** Named for what it reads like at the call site: `navFor(role)`. */
export const navFor = visibleNav;

/**
 * Is this path one the given role's menu hides?
 *
 * Used by the shell to render a clean "Not authorised" panel instead of letting
 * a page that assumes a super-admin payload mount and explode on its first 403.
 * It is a COURTESY, not a gate: the API refuses the underlying request either
 * way, and that refusal is the thing that actually protects the data.
 */
export function isRestrictedHref(pathname: string, level: AdminLevel): boolean {
  if (level === 'SUPER_ADMIN') return false;
  return NAV_ITEMS.some((item) => item.superAdmin === true && isActiveHref(item.href, pathname));
}

/** The nav item whose section this path belongs to, if any. */
export function navItemFor(pathname: string): NavItem | null {
  // Longest href first, so `/admin/vendors/abc` matches Vendors and not the
  // `/admin` overview.
  const sorted = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length);
  return sorted.find((item) => isActiveHref(item.href, pathname)) ?? null;
}

/**
 * `/admin` must match only itself — every other route starts with it, and a
 * naive `startsWith` lights up the Dashboard on all eighteen screens.
 */
export function isActiveHref(href: string, pathname: string): boolean {
  if (href === '/admin') return pathname === '/admin';
  return pathname === href || pathname.startsWith(`${href}/`);
}
