'use client';

/**
 * The desktop rail — the rider's console navigation, above 1024px.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * The rider surface is a phone app and that is correct: 64px targets, a dock
 * under the thumb, an exclusive primary action. But it is ALSO opened on a
 * laptop — by a rider at home checking yesterday's earnings, and by whoever is
 * looking at the product — and on a 1440px screen a 560px column with a dock
 * glued to the bottom edge is not a smaller phone, it is a broken console. The
 * admin has `adm-rail`, the vendor has `ven-rail`; this is the rider's.
 *
 * ── IT IS A MEDIA QUERY, NOT A JAVASCRIPT BRANCH ────────────────────────────
 * This component is ALWAYS in the tree. `delivery.module.css` shows it at
 * `min-width: 1024px` and hides the dock at the same breakpoint, and the two
 * swap with no React involved. A layout picked by reading `window.innerWidth`
 * renders the wrong one on first paint and then snaps — on the one surface
 * that is read one-handed, in a hurry, that flash is the bug.
 *
 * ── STRUCTURE FROM `ven-rail`, COLOUR FROM THE RIDER ────────────────────────
 * Spacing, the sticky full-height column, the hairline edge, the active
 * marker — all mirror the vendor console so the three roles feel like one
 * product. The COLOURS do not: the vendor's accent is the vendor's. Current
 * state here is `--way` (violet), which is this surface's standing role for
 * "navigation" and is already what the phone dock lights up with. One active
 * colour, two chromes.
 */

import Link from 'next/link';

import styles from './delivery.module.css';
import { isCurrent, riderNavItems } from './nav';
import { IconExit, IconUser } from './icons';
import { APP_NAME } from '@/config/brand';

export function RiderRail({
  pathname,
  offersCount,
  activeHref,
  walletLow = false,
  kycPending = false,
  riderName,
  onOpenAccount,
}: {
  pathname: string;
  offersCount: number;
  activeHref: string;
  walletLow?: boolean;
  kycPending?: boolean;
  /** Empty until `/delivery/me` answers — the foot shows the role alone. */
  riderName: string;
  onOpenAccount: () => void;
}) {
  const items = riderNavItems({ offersCount, activeHref, walletLow, kycPending });

  return (
    <nav className={styles.rail} aria-label="Rider console">
      <Link href="/delivery" className={styles.railBrand}>
        <span className={styles.railWho}>
          <span className={styles.railName}>{APP_NAME}</span>
          <span className={styles.railRole}>Rider</span>
        </span>
      </Link>

      <div className={styles.railLinks}>
        {items.map((item) => {
          const current = isCurrent(pathname, item.match);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={styles.railLink}
              aria-current={current ? 'page' : undefined}
            >
              {item.icon}
              <span className={styles.railLabel}>{item.label}</span>
              {item.badge === undefined ? null : (
                <span className={styles.railCount}>{item.badge}</span>
              )}
              {item.dot === true ? (
                <>
                  <span className={styles.railDot} aria-hidden="true" />
                  <span className={styles.srOnly}> needs attention</span>
                </>
              ) : null}
            </Link>
          );
        })}
      </div>

      {/*
        The same sheet the phone header opens, reached from the foot of the
        rail rather than a 24px button in a corner. Sign-out lives inside it,
        so there is exactly one place to end a session on either chrome.
      */}
      <button type="button" className={styles.railFoot} onClick={onOpenAccount}>
        <IconUser size={20} />
        <span className={styles.railLabel}>
          {riderName === '' ? 'Your account' : riderName}
        </span>
        <IconExit size={16} />
      </button>
    </nav>
  );
}
