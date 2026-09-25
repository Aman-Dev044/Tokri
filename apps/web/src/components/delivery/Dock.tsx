'use client';

/**
 * The bottom of the viewport — where a thumb actually reaches.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * The dock holds EITHER the navigation OR the screen's one primary action.
 * Never both, never two primaries side by side.
 *
 * That is not a layout preference. A rider mid-delivery should not be able to
 * fat-finger "History" while reaching for "Picked up", and a screen with two
 * equally-weighted buttons at the bottom has no primary action at all. So
 * while a job is in progress the nav is GONE — the job owns the phone.
 *
 * The one deliberate exception is the offer screen, where Accept and Decline
 * are a genuine binary and both must be one tap away. Even there they are not
 * peers: Accept is filled and takes two thirds of the width, Decline is an
 * outline.
 *
 * ── WHY IT IS FIXED, NOT THE LAST GRID ROW ──────────────────────────────────
 * A docked action parked at the end of the document is only reachable after a
 * scroll, which on a long job screen means the primary action of the app is
 * below the fold. It is `position: fixed` and `main` reserves its height, so
 * the action is always in the thumb and nothing is ever hidden under it.
 */

import Link from 'next/link';
import styles from './delivery.module.css';
import { IconBox, IconList, IconNavigate, IconWallet } from './icons';

export function Dock({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.dock}>
      <div className={styles.dockInner}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation — shown only when there is no action to take             */
/* ------------------------------------------------------------------ */

export interface NavTarget {
  href: string;
  label: string;
  badge?: number;
}

export function RiderNav({
  pathname,
  offersCount,
  activeHref,
}: {
  pathname: string;
  offersCount: number;
  /** The live job's URL, or `/delivery` when there is no job. */
  activeHref: string;
}) {
  const items: Array<NavTarget & { icon: React.ReactNode }> = [
    {
      href: '/delivery/offers',
      label: 'Offers',
      icon: <IconNavigate size={24} />,
      ...(offersCount > 0 ? { badge: offersCount } : {}),
    },
    { href: activeHref, label: 'Active', icon: <IconBox size={24} /> },
    { href: '/delivery/history', label: 'History', icon: <IconList size={24} /> },
    { href: '/delivery/earnings', label: 'Earnings', icon: <IconWallet size={24} /> },
  ];

  return (
    <nav className={styles.nav} aria-label="Rider sections">
      {items.map((item) => {
        const active =
          item.href === '/delivery'
            ? pathname === '/delivery'
            : pathname.startsWith(item.href.split('?')[0] ?? item.href);
        return (
          <Link
            key={item.label}
            href={item.href}
            className={`${styles.navItem} ${active ? styles.navItemActive : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {item.icon}
            <span>
              {item.label}
              {item.badge === undefined ? null : (
                <>
                  {' '}
                  <span className={styles.navBadge}>{item.badge}</span>
                </>
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* The one primary action                                              */
/* ------------------------------------------------------------------ */

export function PrimaryButton({
  children,
  onClick,
  disabled = false,
  tone = 'good',
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'good' | 'crit';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      className={`${styles.primary} ${tone === 'crit' ? styles.primaryCrit : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function PrimaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={styles.primary}>
      {children}
    </Link>
  );
}
