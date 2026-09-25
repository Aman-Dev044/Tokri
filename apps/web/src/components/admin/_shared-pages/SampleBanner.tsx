'use client';

/**
 * "These numbers are not real" — plus a way to try the endpoint again.
 *
 * The banner itself is the shared `<FixtureBanner/>`, deliberately: one wording
 * and one look across the whole console is what stops a reader learning to skim
 * past it. This wrapper only adds the retry affordance, because these pages are
 * built while the API is still landing and an admin should be able to pick the
 * real data up the moment it appears, without a reload.
 *
 * Not dismissible, not shrinkable to an icon. An admin acting on invented
 * settlement totals is a far worse outcome than an ugly banner.
 */

import { FixtureBanner } from '@/components/admin';

import styles from './pages.module.css';

export function SampleBanner({
  endpoint,
  onRetry,
}: {
  /** The endpoint that failed, shown verbatim so it is debuggable. */
  endpoint: string;
  onRetry?: () => void;
}) {
  return (
    <div className={styles.sampleWrap}>
      <FixtureBanner paths={[endpoint]} />
      {onRetry === undefined ? null : (
        <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
