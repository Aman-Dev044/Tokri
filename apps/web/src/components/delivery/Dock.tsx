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
 *
 * ── ON A DESKTOP, ONLY THE NAVIGATION DOCK GOES AWAY ────────────────────────
 * Above 1024px the rail is the navigation, so the dock holding `RiderNav` is
 * hidden — that one, and ONLY that one, which is why it is marked `nav`. The
 * action docks stay: "Accept", "Picked up", "Deliver" and "Continue delivery"
 * all live in here, and hiding the dock wholesale would leave a rider on a
 * laptop looking at an offer they cannot accept and a job they cannot move.
 * They simply shift right of the rail and stop stretching the full window.
 */

import Link from 'next/link';
import styles from './delivery.module.css';
import { IconArrow } from './icons';
import { isCurrent, riderNavItems } from './nav';

export function Dock({
  children,
  nav = false,
}: {
  children: React.ReactNode;
  /** True for the one dock that holds navigation rather than an action. */
  nav?: boolean;
}) {
  return (
    <div className={`${styles.dock} ${nav ? styles.dockNav : ''}`}>
      <div className={styles.dockInner}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation — shown only when there is no action to take             */
/* ------------------------------------------------------------------ */

export function RiderNav({
  pathname,
  offersCount,
  activeHref,
  walletLow = false,
  kycPending = false,
}: {
  pathname: string;
  offersCount: number;
  /** The live job's URL, or `/delivery` when there is no job. */
  activeHref: string;
  /** Puts a dot on Wallet when the platform says the balance is low. */
  walletLow?: boolean;
  /** Puts a dot on Verify until the rider is actually VERIFIED. */
  kycPending?: boolean;
}) {
  /*
    Five destinations, which is the ceiling for a thumb-reachable dock. The
    list itself lives in `nav.tsx` and is shared with the desktop rail; what
    this dock does is DROP the two entries marked `railOnly` — Dashboard and
    History — because five is what a thumb reaches, not because they matter
    less. The dashboard is one tap away from the header brand; History is a
    record read occasionally and the rail has room for it.

    Wallet and Verify earn their place because BOTH can stop a rider working
    entirely — an empty wallet is a 402 on the next accept and an unverified
    rider is a 403 — and a blocker the rider cannot navigate to is a blocker
    they cannot clear.
  */
  const items = riderNavItems({
    offersCount,
    activeHref,
    walletLow,
    kycPending,
  }).filter((item) => item.railOnly !== true);

  /*
    The yellow active pill is ONE element — the bar's own pseudo-element —
    slid to the current tab by index, so a route change is a single
    translate rather than one tab fading out while another fades in. -1
    means no tab is current (the dashboard), and the pill hides.
  */
  const activeIndex = items.findIndex((item) => isCurrent(pathname, item.match));

  return (
    <nav
      className={`${styles.nav} ${activeIndex >= 0 ? styles.navHasActive : ''}`}
      aria-label="Rider sections"
      style={{ ['--tab-i' as string]: activeIndex, ['--tab-n' as string]: items.length }}
    >
      {items.map((item) => {
        const active = isCurrent(pathname, item.match);
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
              {item.dot === true ? (
                <>
                  {' '}
                  <span className={styles.navDot} aria-hidden="true" />
                  <span className={styles.srOnly}> needs attention</span>
                </>
              ) : null}
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
      className={`${styles.primary} ${styles.primaryWithArrow} ${
        tone === 'crit' ? styles.primaryCrit : ''
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
      <PrimaryArrow />
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
    <Link href={href} className={`${styles.primary} ${styles.primaryWithArrow}`}>
      {children}
      <PrimaryArrow />
    </Link>
  );
}

/**
 * The round arrow button on the right of a full-width yellow pill. Purely
 * decorative — the label beside it is the accessible name — and only for
 * full-width primaries: in a two-button row there is no room for it.
 */
export function PrimaryArrow() {
  return (
    <span className={styles.primaryArrow} aria-hidden="true">
      <IconArrow size={22} />
    </span>
  );
}
