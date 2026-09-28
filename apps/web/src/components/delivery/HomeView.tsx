'use client';

/**
 * Home — the screen a rider sees between jobs, and the one they land on when
 * they open the app cold.
 *
 * It answers three questions and nothing else:
 *   Am I online?            (the shell's toggle, directly above)
 *   What did I earn today?  (the shell's strip, and the tiles here)
 *   Do I have a job?        (this screen's whole body)
 *
 * With a live job it becomes a single bottom-anchored "Continue delivery" and
 * the nav is hidden — a rider mid-delivery has one thing to do. With no job it
 * is a calm resting state, not a spinner and not an empty dashboard: waiting
 * is the NORMAL condition of this screen and it must not feel like a fault.
 *
 * ── TODAY'S NUMBERS COME FROM THE PROFILE ───────────────────────────────────
 * `GET /delivery/me` returns `today: { deliveries, earningsPaise,
 * onlineMinutes }`. The earnings endpoint has no concept of "today" — it is a
 * window statement — so reading today's figures from it was always wrong.
 */

import Link from 'next/link';

import styles from './delivery.module.css';
import { CachedBanner, FixtureBanner, Notice } from './Banners';
import { Dock, PrimaryLink } from './Dock';
import { useHideNav } from './RiderShell';
import { CardSkeleton, StatPairSkeleton } from './Skeletons';
import { useRider } from './RiderProvider';
import { IconBox, IconResting } from './icons';
import { distanceKm, money } from '@/lib/delivery/format';
import { APP_NAME } from '@/config/brand';

export function HomeView() {
  const {
    profile,
    activeOrder,
    jobIsSample,
    jobFromCache,
    offers,
    offersAreSample,
    loading,
    sampleEndpoints,
    loadError,
    refresh,
  } = useRider();

  const hasJob = activeOrder !== null;
  // A live job takes the dock; otherwise the nav keeps it.
  useHideNav(hasJob);

  const today = profile?.today ?? null;
  const online = profile?.isOnline ?? false;

  if (loading && !hasJob) {
    return (
      <>
        <StatPairSkeleton />
        <CardSkeleton />
      </>
    );
  }

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

      <div className={styles.summaryGrid}>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>
            {today === null ? '—' : money(today.earningsPaise)}
          </div>
          <div className={styles.summaryLabel}>Earned today</div>
        </div>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>
            {today === null ? '—' : today.deliveries}
          </div>
          <div className={styles.summaryLabel}>Deliveries today</div>
        </div>
      </div>

      {activeOrder !== null ? (
        <>
          <section className={styles.panel}>
            <span className={styles.stepTag}>
              <IconBox size={14} /> Delivery in progress
            </span>
            <h1 className={styles.h1} style={{ marginTop: '0.35rem' }}>
              {activeOrder.drop.label}
            </h1>
            <p className={styles.lede}>
              {activeOrder.drop.address === ''
                ? 'No address on this order — call before you set off.'
                : activeOrder.drop.address}
            </p>
            <p className={styles.rowMeta}>
              {distanceKm(activeOrder.distanceKm)} · you earn{' '}
              {money(activeOrder.payoutPaise)}
            </p>
          </section>

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
          <Link href="/delivery/offers" style={{ color: 'inherit' }}>
            Open it before the countdown runs out.
          </Link>
        </Notice>
      ) : (
        <div className={styles.resting}>
          <IconResting size={72} className={styles.restingMark} />
          <h1 className={styles.h1}>
            {online ? 'Waiting for offers' : "You're offline"}
          </h1>
          <p className={styles.lede}>
            {online
              ? 'Keep this screen open. The next job arrives with a 45-second countdown.'
              : 'Tap the button above to go online and start receiving offers.'}
          </p>
        </div>
      )}
    </>
  );
}
