'use client';

/**
 * ★ The rider's morning screen.
 *
 * Every other role has one: the vendor opens `DashboardView` and knows in four
 * seconds what today looks like and what is on fire. The rider had an
 * online toggle and a list of offers, which is a *screen*, not a dashboard —
 * so the offers now live at `/delivery/offers`, where they always belonged,
 * and this is what `/delivery` shows.
 *
 * It answers six questions and then stops:
 *
 *   Am I online, and can I take work?   `profile.isOnline` + wallet + KYC
 *   What am I carrying right now?       `GET /delivery/orders/active`
 *   What have I earned today?           `GET /delivery/me` → `today`
 *   And over the statement window?       `GET /delivery/earnings`
 *   How many have I delivered?          `GET /delivery/wallet` → totalDelivered
 *   Can I afford the next pick fee?     `GET /delivery/wallet`
 *   Is anything blocking me?            the needs strip
 *
 * ── WHERE EACH NUMBER COMES FROM, AND WHY NOT SOMEWHERE ELSE ────────────────
 * TODAY is `profile.today`. `GET /delivery/earnings` is a WINDOW STATEMENT and
 * has no concept of today — an earlier version of this surface read today's
 * figures off it and showed ₹0 forever. LIFETIME is the wallet's
 * `lifetimeEarnedPaise`, and DELIVERED is the wallet's `totalDelivered`; the
 * wallet is the ledger, so it is the only honest source for a lifetime total.
 * The statement row below the tiles is the earnings endpoint used for the one
 * thing it actually knows: a dated window.
 *
 * ── THE NEEDS STRIP IS THE POINT OF THE PAGE ────────────────────────────────
 * Ordered by what it COSTS to ignore, not by category. A blocker outranks a
 * warning:
 *
 *   1. KYC not verified          → 403 on every accept. Cannot work at all.
 *   2. Balance under the pick fee → 402 on every accept. Cannot work at all.
 *   3. Balance low                → will be blocked soon.
 *   4. Offline                    → no offers will arrive.
 *
 * Each one links to the screen that fixes it, except "offline", which does not
 * need a screen — it needs the toggle, so the card IS the toggle. A dashboard
 * that reports a problem without a route to its solution just makes the reader
 * feel worse.
 *
 * ── NOTHING IS RE-DERIVED ───────────────────────────────────────────────────
 * `lowBalance` is the SERVER's verdict against the SERVER's threshold. The one
 * comparison made here is `balancePaise < pickFeeMinPaise` — "cannot cover
 * even the cheapest possible draw" — because that is the exact test the API
 * applies before it answers 402, and both numbers come from the same payload.
 */

import Link from 'next/link';
import { useCallback, useState } from 'react';

import styles from './delivery.module.css';
import { CachedBanner, FixtureBanner, Notice } from './Banners';
import { Dock, PrimaryLink } from './Dock';
import { useHideNav } from './RiderShell';
import { CardSkeleton, StatPairSkeleton } from './Skeletons';
import { useRider } from './RiderProvider';
import { IconBox, IconNavigate, IconResting, IconShield, IconWallet } from './icons';
import { dayLabel, distanceKm, money } from '@/lib/delivery/format';
import { useRiderEarnings } from '@/lib/delivery/useRiderData';
import { APP_NAME } from '@/config/brand';

type Tone = 'crit' | 'warn' | 'good';

export function DashboardView() {
  const {
    profile,
    activeOrder,
    jobIsSample,
    jobFromCache,
    offers,
    offersAreSample,
    wallet,
    kyc,
    loading,
    sampleEndpoints,
    loadError,
    refresh,
    setOnline,
    availabilityPending,
  } = useRider();

  const earnings = useRiderEarnings();

  const hasJob = activeOrder !== null;
  // Unchanged from the screen this replaced: a live job takes the phone's
  // dock, so the one thing to do is anchored under the thumb. On a desktop
  // the dock is not rendered at all and the card below carries the link.
  useHideNav(hasJob);

  const [toggleError, setToggleError] = useState<string | null>(null);
  const online = profile?.isOnline ?? false;
  const today = profile?.today ?? null;

  const goOnline = useCallback(() => {
    setToggleError(null);
    void setOnline(!online).catch((cause: unknown) => {
      setToggleError(cause instanceof Error ? cause.message : 'That did not work.');
    });
  }, [online, setOnline]);

  if (loading && !hasJob) {
    return (
      <>
        <StatPairSkeleton />
        <CardSkeleton />
      </>
    );
  }

  /* ---- the four blockers, in cost order ---- */

  const kycTone: Tone =
    kyc === null ? 'warn' : kyc.status === 'verified' ? 'good' : kyc.status === 'rejected' ? 'crit' : 'warn';

  // "Cannot cover even the cheapest possible draw" — the API's own 402 test.
  const brokeTone: Tone =
    wallet === null
      ? 'warn'
      : wallet.balancePaise < wallet.pickFeeMinPaise
        ? 'crit'
        : 'good';

  const lowTone: Tone =
    wallet === null ? 'warn' : wallet.lowBalance ? 'warn' : 'good';

  const statement = earnings.value;
  const statementWindow =
    statement.from === '' || statement.to === ''
      ? null
      : `${dayLabel(statement.from)} – ${dayLabel(statement.to)}`;

  return (
    <>
      {jobIsSample || offersAreSample ? (
        <FixtureBanner endpoints={sampleEndpoints} onRetry={refresh} />
      ) : null}
      {jobFromCache && !jobIsSample ? <CachedBanner onRetry={refresh} /> : null}
      {loadError === null ? null : (
        <Notice tone="crit" title={`${APP_NAME} did not answer properly`}>
          {loadError}
        </Notice>
      )}
      {toggleError === null ? null : (
        <Notice tone="crit" title="Could not change your availability">
          {toggleError}
        </Notice>
      )}

      {/* ------------------------------------------- needs you now ---- */}
      <section className={styles.sec} aria-labelledby="rid-needs">
        <div className={styles.secHead}>
          <h1 className={styles.secTitle} id="rid-needs">
            Needs you now
          </h1>
          <p className={styles.secNote}>
            Ordered by what it costs to ignore, not by category.
          </p>
        </div>

        <div className={styles.needs}>
          <NeedCard
            href="/delivery/profile"
            tone={kycTone}
            icon={<IconShield size={20} />}
            label={
              kyc === null
                ? 'Verification not loaded'
                : kyc.status === 'verified'
                  ? 'You are verified'
                  : kyc.status === 'submitted'
                    ? 'Verification in progress'
                    : kyc.status === 'rejected'
                      ? 'Verification was rejected'
                      : 'You are not verified yet'
            }
            detail={
              kyc === null
                ? 'We could not read your verification status.'
                : kyc.status === 'verified'
                  ? 'Nothing stands between you and an offer.'
                  : kyc.status === 'submitted'
                    ? `Checked within ${kyc.slaHours} hours. You cannot accept until it clears.`
                    : 'Every accept is refused until your documents are verified.'
            }
          />

          <NeedCard
            href="/delivery/wallet"
            tone={brokeTone}
            icon={<IconWallet size={20} />}
            value={wallet === null ? null : money(wallet.balancePaise)}
            label={
              wallet === null
                ? 'Wallet not loaded'
                : brokeTone === 'crit'
                  ? 'Too low to accept anything'
                  : 'Enough for the next job'
            }
            detail={
              wallet === null
                ? 'We could not read your balance.'
                : brokeTone === 'crit'
                  ? `A pick fee starts at ${money(wallet.pickFeeMinPaise)}. Top up before the next offer.`
                  : `A pick fee is ${money(wallet.pickFeeMinPaise)}–${money(wallet.pickFeeMaxPaise)}, taken when you accept.`
            }
          />

          <NeedCard
            href="/delivery/wallet"
            tone={lowTone}
            icon={<IconWallet size={20} />}
            label={
              wallet === null
                ? 'Threshold unknown'
                : wallet.lowBalance
                  ? 'Running low'
                  : 'Balance is healthy'
            }
            detail={
              wallet === null
                ? 'We could not read the low-balance threshold.'
                : wallet.lowBalance
                  ? `Below ${money(wallet.warnThresholdPaise)}. A few more jobs and you will be blocked.`
                  : `Above the ${money(wallet.warnThresholdPaise)} warning line.`
            }
          />

          {/*
            The one card that is not a link. "Go online" does not live on
            another screen — it is one button, so the card IS the button.
          */}
          <button
            type="button"
            className={styles.need}
            data-tone={online ? 'good' : 'warn'}
            onClick={goOnline}
            disabled={availabilityPending}
          >
            <span className={styles.needIcon} aria-hidden="true">
              <IconNavigate size={20} />
            </span>
            <span className={styles.needLabel}>
              {online ? 'You are online' : 'You are offline'}
            </span>
            <span className={styles.needDetail}>
              {availabilityPending
                ? 'Saving…'
                : online
                  ? 'Offers can reach you. Tap to stop.'
                  : 'No offer will reach you. Tap to go online.'}
            </span>
          </button>
        </div>
      </section>

      {/* ----------------------------------------------- right now ---- */}
      <section className={styles.sec} aria-labelledby="rid-now">
        <div className={styles.secHead}>
          <h2 className={styles.secTitle} id="rid-now">
            Right now
          </h2>
          <p className={styles.secNote}>
            {hasJob
              ? 'What you are carrying, and where it goes.'
              : 'Waiting is the normal state of this screen, not a fault.'}
          </p>
        </div>

        {activeOrder !== null ? (
          <>
            <section className={styles.panel}>
              <span className={styles.stepTag}>
                <IconBox size={14} /> Delivery in progress
              </span>
              <h3 className={styles.h1} style={{ marginTop: '0.35rem' }}>
                {activeOrder.drop.label}
              </h3>
              <p className={styles.lede}>
                {activeOrder.drop.address === ''
                  ? 'No address on this order — call before you set off.'
                  : activeOrder.drop.address}
              </p>
              <p className={styles.rowMeta}>
                Order {activeOrder.orderNo} · {distanceKm(activeOrder.distanceKm)} · you
                earn {money(activeOrder.payoutPaise)}
              </p>
            </section>

            {/*
              Only the NAVIGATION dock is hidden on a desktop, so this one
              action is still anchored to the bottom there, right of the
              rail — exactly as it is under a thumb. See `Dock`.
            */}
            <Dock>
              <PrimaryLink
                href={`/delivery/active/${encodeURIComponent(activeOrder.orderId)}`}
              >
                Continue delivery
              </PrimaryLink>
            </Dock>
          </>
        ) : offers.length > 0 ? (
          <Notice
            tone="warn"
            title={`${offers.length} offer${offers.length === 1 ? '' : 's'} waiting`}
          >
            <Link href="/delivery/offers" className={styles.inlineLink}>
              Open it before the countdown runs out.
            </Link>
          </Notice>
        ) : (
          <div className={styles.resting}>
            <IconResting size={72} className={styles.restingMark} />
            <h3 className={styles.h1}>
              {online ? 'Waiting for offers' : 'Nothing will arrive while you are offline'}
            </h3>
            <p className={styles.lede}>
              {online
                ? 'The next job arrives with a 45-second countdown.'
                : 'Go online above and offers will start coming through.'}
            </p>
            <Link href="/delivery/offers" className={styles.inlineLink}>
              Open the offers screen
            </Link>
          </div>
        )}
      </section>

      {/* ------------------------------------------- your numbers ---- */}
      <section className={styles.sec} aria-labelledby="rid-numbers">
        <div className={styles.secHead}>
          <h2 className={styles.secTitle} id="rid-numbers">
            Your numbers
          </h2>
          <p className={styles.secNote}>
            Today comes from your profile; the lifetime figures come from the
            wallet ledger.
          </p>
        </div>

        <div className={`${styles.summaryGrid} ${styles.grid3}`}>
          <Tile
            index={0}
            value={wallet === null ? '—' : money(wallet.balancePaise)}
            label="Wallet balance"
            tone={brokeTone === 'crit' ? 'crit' : lowTone === 'warn' ? 'warn' : undefined}
          />
          <Tile
            index={1}
            value={today === null ? '—' : money(today.earningsPaise)}
            label="Earned today"
          />
          <Tile
            index={2}
            value={today === null ? '—' : String(today.deliveries)}
            label="Deliveries today"
          />
          <Tile
            index={3}
            value={wallet === null ? '—' : String(wallet.totalDelivered)}
            label="Delivered in total"
          />
          <Tile
            index={4}
            value={wallet === null ? '—' : money(wallet.lifetimeEarnedPaise)}
            label="Earned in total"
          />
          <Tile
            index={5}
            value={
              wallet === null
                ? '—'
                : `${money(wallet.pickFeeMinPaise)}–${money(wallet.pickFeeMaxPaise)}`
            }
            label="Next pick fee"
          />
        </div>

        {/*
          The earnings endpoint, used for the one thing it knows: a dated
          window. It is never asked what "today" is — it has no such field.
        */}
        {earnings.error !== null ? (
          <Notice tone="crit" title="Your statement did not load">
            {earnings.endpoint} · {earnings.error}{' '}
            <button type="button" className={styles.linkBtn} onClick={earnings.refetch}>
              Try again
            </button>
          </Notice>
        ) : (
          <Link href="/delivery/earnings" className={styles.statement}>
            <span className={styles.statementLabel}>
              {statementWindow === null ? 'Your statement' : statementWindow}
            </span>
            <span className={styles.statementValue}>
              {earnings.loading ? '—' : money(statement.payoutPaise)}
            </span>
            <span className={styles.statementNote}>
              {earnings.loading
                ? 'Loading your statement…'
                : `${statement.deliveries} ${
                    statement.deliveries === 1 ? 'delivery' : 'deliveries'
                  }${
                    statement.codCollectedPaise > 0
                      ? ` · ${money(statement.codCollectedPaise)} cash collected`
                      : ''
                  } · open the full breakdown`}
            </span>
          </Link>
        )}
      </section>
    </>
  );
}

/* ================================================================== */
/* Pieces                                                              */
/* ================================================================== */

function NeedCard({
  href,
  tone,
  icon,
  value,
  label,
  detail,
}: {
  href: string;
  tone: Tone;
  icon: React.ReactNode;
  value?: string | null;
  label: string;
  detail: string;
}) {
  return (
    <Link className={styles.need} href={href} data-tone={tone}>
      <span className={styles.needIcon} aria-hidden="true">
        {icon}
      </span>
      {value === undefined || value === null ? null : (
        <span className={styles.needValue}>{value}</span>
      )}
      <span className={styles.needLabel}>{label}</span>
      <span className={styles.needDetail}>{detail}</span>
    </Link>
  );
}

function Tile({
  index,
  value,
  label,
  tone,
}: {
  index: number;
  value: string;
  label: string;
  tone?: 'warn' | 'crit';
}) {
  return (
    <div
      className={styles.summaryTile}
      style={{ ['--i' as string]: index }}
      data-tone={tone}
    >
      <div className={styles.summaryValue}>{value}</div>
      <div className={styles.summaryLabel}>{label}</div>
    </div>
  );
}
