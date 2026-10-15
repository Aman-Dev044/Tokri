'use client';

/**
 * ONE list of destinations, read by two chromes.
 *
 * The phone dock and the desktop rail are different shapes, not different
 * navigations. If each kept its own array they would drift — a badge added to
 * one, a route renamed in the other — and a rider switching between a phone
 * and a laptop would be looking at two apps. So the list lives here, every
 * entry carries what BOTH chromes need, and each chrome decides only how much
 * of it fits.
 *
 * ── `match` IS NOT `href` ───────────────────────────────────────────────────
 * The active test used to be `pathname.startsWith(href)`, and "Active" points
 * at `/delivery` whenever there is no job — so `/delivery` lit up the Active
 * tab on every single page load. `match` is the prefix that decides "you are
 * here", independently of where the link GOES: Active's is `/delivery/active`,
 * so it is current only during a job, while its href still falls back to the
 * dashboard when there is nothing to open.
 *
 * `/delivery` is the one exact match. As a prefix it matches everything.
 */

import type { ReactNode } from 'react';

import {
  IconBox,
  IconChart,
  IconClock,
  IconGrid,
  IconNavigate,
  IconShield,
  IconWallet,
} from './icons';

export interface RiderNavItem {
  href: string;
  /** Prefix that marks this item current. `/delivery` means exact. */
  match: string;
  label: string;
  icon: ReactNode;
  /** A count, where a count means something. Offers only. */
  badge?: number;
  /**
   * An attention dot with no number. Wallet and Verify get one because both
   * can hard-block a rider (402 / 403) and neither has a meaningful count —
   * "1" beside Wallet would read as one rupee, one transaction or one warning
   * and it means none of those.
   */
  dot?: boolean;
  /**
   * True for destinations the five-tab dock has no room for. They are not
   * less important; a thumb-reachable dock simply holds five, and a desktop
   * rail holds as many as the list has.
   */
  railOnly?: boolean;
}

export function riderNavItems({
  offersCount,
  activeHref,
  walletLow = false,
  kycPending = false,
}: {
  offersCount: number;
  /** The live job's URL, or `/delivery` when there is no job. */
  activeHref: string;
  walletLow?: boolean;
  kycPending?: boolean;
}): RiderNavItem[] {
  return [
    {
      href: '/delivery',
      match: '/delivery',
      label: 'Dashboard',
      icon: <IconGrid size={24} />,
      railOnly: true,
    },
    {
      href: '/delivery/offers',
      match: '/delivery/offers',
      label: 'Offers',
      icon: <IconNavigate size={24} />,
      ...(offersCount > 0 ? { badge: offersCount } : {}),
    },
    {
      href: activeHref,
      match: '/delivery/active',
      label: 'Active',
      icon: <IconBox size={24} />,
    },
    {
      href: '/delivery/wallet',
      match: '/delivery/wallet',
      label: 'Wallet',
      icon: <IconWallet size={24} />,
      ...(walletLow ? { dot: true } : {}),
    },
    {
      href: '/delivery/profile',
      match: '/delivery/profile',
      label: 'Verify',
      icon: <IconShield size={24} />,
      ...(kycPending ? { dot: true } : {}),
    },
    {
      href: '/delivery/earnings',
      match: '/delivery/earnings',
      label: 'Earnings',
      icon: <IconChart size={24} />,
    },
    {
      href: '/delivery/history',
      match: '/delivery/history',
      label: 'History',
      icon: <IconClock size={24} />,
      railOnly: true,
    },
  ];
}

/** `/delivery` exactly, anything else by prefix. */
export function isCurrent(pathname: string, match: string): boolean {
  if (match === '/delivery') return pathname === '/delivery';
  return pathname === match || pathname.startsWith(`${match}/`);
}
