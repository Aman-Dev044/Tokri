'use client';

/**
 * The three things this surface must never lie about.
 *
 *   FixtureBanner   — "these are not real jobs"
 *   OfflineBanner   — "you are looking at a cached screen"
 *   Notice          — everything else, in one honest voice
 *
 * None of them are dismissible. A rider acting on an invented address or a
 * stale job is a far worse outcome than a banner they have to scroll past.
 */

import styles from './delivery.module.css';
import { IconSignal, IconShield } from './icons';
import { APP_NAME } from '@/config/brand';

export function FixtureBanner({
  endpoints,
  onRetry,
}: {
  /** Shown verbatim so a developer can see exactly what 404'd. */
  endpoints: readonly string[];
  onRetry?: () => void;
}) {
  if (endpoints.length === 0) return null;
  return (
    <div className={styles.banner} role="status">
      <IconShield size={22} />
      <div>
        <strong className={styles.bannerTitle}>Sample data — not a real job</strong>
        The delivery API is not answering, so this screen is showing examples. Do not
        ride anywhere from this.
        <div className={styles.bannerCode}>{endpoints.join(' · ')}</div>
        {onRetry === undefined ? null : (
          <button type="button" className={styles.ghost} onClick={onRetry} style={{ marginTop: '0.5rem' }}>
            Try the API again
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Shown when the job on screen came out of the session cache rather than the
 * network — i.e. the offline shell did its job. The rider is told plainly,
 * because a delivery detail that changed while they were in a basement would
 * otherwise be invisible.
 */
export function CachedBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={`${styles.banner} ${styles.bannerNeutral}`} role="status">
      <IconSignal size={22} />
      <div>
        <strong className={styles.bannerTitle}>Showing your last saved job</strong>
        We could not reach {APP_NAME}, so this is the copy saved on this phone. It may be
        out of date.
        <button type="button" className={styles.ghost} onClick={onRetry} style={{ marginTop: '0.5rem' }}>
          Retry
        </button>
      </div>
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'warn' | 'crit';
  title: string;
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === 'crit' ? styles.bannerCrit : tone === 'warn' ? '' : styles.bannerNeutral;
  return (
    <div className={`${styles.banner} ${toneClass}`} role={tone === 'crit' ? 'alert' : 'status'}>
      <div>
        <strong className={styles.bannerTitle}>{title}</strong>
        {children}
      </div>
    </div>
  );
}
