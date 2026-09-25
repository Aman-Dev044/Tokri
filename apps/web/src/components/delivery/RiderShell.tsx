'use client';

/**
 * The rider shell: the online toggle, today's line, the connection state, and
 * the bottom navigation.
 *
 * ── LAYOUT ──────────────────────────────────────────────────────────────────
 * Three rows: a short sticky header, the scrolling screen, and the dock. The
 * header is short on purpose — everything a thumb needs lives at the BOTTOM
 * (plan §2.4, one-handed). The only exception is the online toggle, which is
 * the app's single most important control and belongs where it cannot be
 * missed or hit by accident: under the title, full width, 72px tall.
 *
 * ── THE DOCK IS EXCLUSIVE ───────────────────────────────────────────────────
 * A screen with a primary action calls `useHideNav()`, and the nav disappears
 * for as long as that screen is mounted. There is never a nav bar under an
 * action button: during a job, the job owns the phone.
 *
 * ── THE ROLE GATE IS UX, NOT SECURITY ───────────────────────────────────────
 * See `lib/delivery/session.ts` for the full note. The API guard chain (§4.2)
 * with `@Roles('delivery')` is what actually stops anyone. This gate only
 * stops a customer who typed the URL from watching an empty dashboard render.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import styles from './delivery.module.css';
import { Dock, RiderNav } from './Dock';
import { RiderProvider, useRider } from './RiderProvider';
import { useRiderSession } from '@/lib/delivery/session';
import { useRiderEarnings } from '@/lib/delivery/useRiderData';
import { money } from '@/lib/delivery/format';
import { IconShield } from './icons';

/* ------------------------------------------------------------------ */
/* Dock exclusivity                                                    */
/* ------------------------------------------------------------------ */

interface ChromeValue {
  hideNav: boolean;
  setHideNav: (next: boolean) => void;
}

const ChromeContext = createContext<ChromeValue | null>(null);

/**
 * Call from any screen that renders its own bottom action. The nav is hidden
 * while that screen is mounted and restored on unmount.
 */
export function useHideNav(enabled = true): void {
  const ctx = useContext(ChromeContext);
  const setHideNav = ctx?.setHideNav;
  useEffect(() => {
    if (setHideNav === undefined || !enabled) return;
    setHideNav(true);
    return () => setHideNav(false);
  }, [setHideNav, enabled]);
}

/* ------------------------------------------------------------------ */
/* Gate states                                                         */
/* ------------------------------------------------------------------ */

function Gate({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.gate}>
      <div className={styles.gateInner}>
        <IconShield size={40} />
        <h1 className={styles.h1}>{title}</h1>
        <p className={styles.lede}>{body}</p>
        {action}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

const CONN_COPY: Record<string, string> = {
  idle: 'Offline',
  connecting: 'Connecting',
  live: 'Live',
  retrying: 'Reconnecting',
  failed: 'No signal',
};

function Header({ riderName }: { riderName: string }) {
  const {
    availability,
    availabilityPending,
    setOnline,
    connection,
    networkOnline,
    reconnect,
  } = useRider();
  const earnings = useRiderEarnings();
  const [toggleError, setToggleError] = useState<string | null>(null);

  const online = availability.isOnline;

  const onToggle = useCallback(() => {
    setToggleError(null);
    void setOnline(!online).catch((cause: unknown) => {
      setToggleError(cause instanceof Error ? cause.message : 'That did not work.');
    });
  }, [online, setOnline]);

  const phase = networkOnline ? connection.phase : 'failed';
  const connClass =
    phase === 'live'
      ? styles.connLive
      : phase === 'retrying' || phase === 'connecting'
        ? styles.connRetry
        : phase === 'failed'
          ? styles.connFailed
          : '';

  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        <Link
          href="/delivery"
          className={styles.brand}
          style={{ color: 'inherit', textDecoration: 'none' }}
        >
          Mandi <span className={styles.brandRole}>RIDER</span>
        </Link>
        <button
          type="button"
          className={`${styles.conn} ${connClass}`}
          onClick={reconnect}
          aria-label={`Connection: ${CONN_COPY[phase] ?? phase}. Tap to reconnect.`}
        >
          <span className={styles.connDot} />
          {networkOnline ? (CONN_COPY[phase] ?? phase) : 'No network'}
        </button>
      </div>

      {/* THE control. Everything else on this surface is secondary to it. */}
      <button
        type="button"
        className={`${styles.toggle} ${online ? styles.toggleOn : ''}`}
        onClick={onToggle}
        disabled={availabilityPending}
        aria-pressed={online}
      >
        <span className={styles.toggleLamp} aria-hidden="true" />
        <span className={styles.toggleText}>
          <span>{online ? "You're online" : "You're offline"}</span>
          <span className={styles.toggleHint}>
            {availabilityPending
              ? 'Saving…'
              : online
                ? 'Tap to stop receiving offers'
                : 'Tap to start receiving offers'}
          </span>
        </span>
      </button>

      {toggleError === null ? null : (
        <p className={styles.attempts} role="alert" style={{ color: 'var(--rd-crit)' }}>
          {toggleError}
        </p>
      )}

      <div className={styles.todayStrip}>
        <span className={styles.todayCell}>
          TODAY
          <span className={styles.todayValue}>{money(earnings.value.todayPaise)}</span>
        </span>
        <span className={styles.todayCell}>
          DELIVERIES
          <span className={styles.todayValue}>{earnings.value.todayDeliveries}</span>
        </span>
        {earnings.isSample ? (
          <span className={styles.todayCell} style={{ color: 'var(--rd-warn)' }}>
            SAMPLE
          </span>
        ) : null}
        {riderName === '' ? null : (
          <span className={styles.todayCell} style={{ marginLeft: 'auto' }}>
            {riderName}
          </span>
        )}
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

function Chrome({ children, riderName }: { children: ReactNode; riderName: string }) {
  const pathname = usePathname();
  const [hideNav, setHideNav] = useState(false);
  const { offers, activeJob } = useRider();

  const value = useMemo<ChromeValue>(() => ({ hideNav, setHideNav }), [hideNav]);

  const activeHref =
    activeJob === null
      ? '/delivery'
      : `/delivery/active/${encodeURIComponent(activeJob.orderId)}`;

  return (
    <ChromeContext.Provider value={value}>
      <div className={styles.shell}>
        <Header riderName={riderName} />
        <main className={styles.main} id="main">
          {children}
        </main>
        {hideNav ? (
          // The screen renders its own dock. Nothing here, deliberately.
          <div />
        ) : (
          <Dock>
            <RiderNav
              pathname={pathname}
              offersCount={offers.length}
              activeHref={activeHref}
            />
          </Dock>
        )}
      </div>
    </ChromeContext.Provider>
  );
}

/* ------------------------------------------------------------------ */

export function RiderShell({ children }: { children: ReactNode }) {
  const session = useRiderSession();

  if (session.status === 'checking') {
    return (
      <div className={styles.gate}>
        <div className={styles.gateInner}>
          <p className={styles.lede}>Checking your sign-in…</p>
        </div>
      </div>
    );
  }

  if (session.status === 'anonymous') {
    return (
      <Gate
        title="Sign in to ride"
        body="Your session has ended. Sign in again to see your offers and your current delivery."
        action={
          <Link className={styles.primary} href="/login?next=/delivery">
            Sign in
          </Link>
        }
      />
    );
  }

  if (session.status === 'forbidden') {
    return (
      <Gate
        title="Not a rider account"
        body={
          session.apiRole === null
            ? 'This account is not set up for deliveries. If that is wrong, ask your manager to check your role.'
            : `This account is signed in as "${session.apiRole}", which cannot take deliveries. Ask your manager to check your role.`
        }
        action={
          <button type="button" className={styles.ghost} onClick={session.recheck}>
            Check again
          </button>
        }
      />
    );
  }

  return (
    <RiderProvider>
      <Chrome riderName={session.name}>{children}</Chrome>
    </RiderProvider>
  );
}
