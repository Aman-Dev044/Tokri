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
 * is the normal condition of this screen and it should not feel like a fault.
 */

import Link from 'next/link';

import styles from './delivery.module.css';
import { CachedBanner, FixtureBanner, Notice } from './Banners';
import { Dock, PrimaryLink } from './Dock';
import { useHideNav } from './RiderShell';
import { useRider } from './RiderProvider';
import { IconBox, IconResting } from './icons';
import { distance, money } from '@/lib/delivery/format';
import { useRiderEarnings } from '@/lib/delivery/useRiderData';

export function HomeView() {
  const {
    availability,
    activeJob,
    jobIsSample,
    jobFromCache,
    offers,
    offersAreSample,
    loading,
    sampleEndpoints,
    refresh,
  } = useRider();
  const earnings = useRiderEarnings();

  const hasJob = activeJob !== null;
  // A live job takes the dock; otherwise the nav keeps it.
  useHideNav(hasJob);

  if (loading && !hasJob) {
    return (
      <div className={styles.skeleton} style={{ height: '12rem' }} aria-hidden="true" />
    );
  }

  return (
    <>
      {jobIsSample || offersAreSample ? (
        <FixtureBanner endpoints={sampleEndpoints} onRetry={refresh} />
      ) : null}
      {jobFromCache && !jobIsSample ? <CachedBanner onRetry={refresh} /> : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>{money(earnings.value.todayPaise)}</div>
          <div className={styles.summaryLabel}>Earned today</div>
        </div>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>{earnings.value.todayDeliveries}</div>
          <div className={styles.summaryLabel}>Deliveries today</div>
        </div>
      </div>

      {hasJob && activeJob !== null ? (
        <>
          <section className={styles.panel}>
            <span className={styles.stepTag}>
              <IconBox size={14} /> Delivery in progress
            </span>
            <h1 className={styles.h1} style={{ marginTop: '0.35rem' }}>
              {activeJob.drop.label}
            </h1>
            <p className={styles.lede}>{activeJob.drop.address}</p>
            <p className={styles.rowMeta}>
              {distance(activeJob.distanceMeters)} · you earn{' '}
              {money(activeJob.payoutPaise)}
            </p>
          </section>

          <Dock>
            <PrimaryLink
              href={`/delivery/active/${encodeURIComponent(activeJob.orderId)}`}
            >
              Continue delivery
            </PrimaryLink>
          </Dock>
        </>
      ) : offers.length > 0 ? (
        <Notice tone="warn" title={`${offers.length} offer waiting`}>
          <Link href="/delivery/offers" style={{ color: 'inherit' }}>
            Open it before the countdown runs out.
          </Link>
        </Notice>
      ) : (
        <div className={styles.resting}>
          <IconResting size={72} className={styles.restingMark} />
          <h1 className={styles.h1}>
            {availability.isOnline ? 'Waiting for offers' : "You're offline"}
          </h1>
          <p className={styles.lede}>
            {availability.isOnline
              ? 'Keep this screen open. The next job arrives with a 45-second countdown.'
              : 'Tap the button above to go online and start receiving offers.'}
          </p>
        </div>
      )}
    </>
  );
}
