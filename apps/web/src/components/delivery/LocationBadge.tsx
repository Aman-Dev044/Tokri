'use client';

/**
 * "Location sent 40s ago" — the honesty badge from plan §8.7 (challenge #16).
 *
 * The plan's exact words: the delivery panel "shows an honest *location last
 * updated 40s ago* instead of pretending". So this component never draws a
 * pulsing live dot. It states, in tabular mono, when the last fix actually
 * left this phone, and it says so in the rider's language rather than a
 * developer's.
 *
 * It also reports the three ways a browser PWA fails at this, out loud:
 *   · permission denied           → the customer cannot see you
 *   · the browser suspended us    → backgrounded tab, locked screen
 *   · fixes queued, none sent     → no network right now
 */

import styles from './delivery.module.css';
import { IconSignal } from './icons';
import { ago } from '@/lib/delivery/format';
import type { TrackingState } from '@/lib/delivery/tracking';

export function LocationBadge({
  tracking,
  now,
}: {
  tracking: TrackingState;
  /** Shared 1Hz tick, so every badge on screen agrees. */
  now: number;
}) {
  if (!tracking.running) return null;

  if (!tracking.supported) {
    return (
      <p className={`${styles.locBadge} ${styles.locBadgeWarn}`} role="status">
        <IconSignal size={18} />
        This phone cannot share its location — the customer will not see you moving.
      </p>
    );
  }

  if (tracking.permission === 'denied') {
    return (
      <p className={`${styles.locBadge} ${styles.locBadgeWarn}`} role="alert">
        <IconSignal size={18} />
        Location is off. Turn it on in your browser settings — the customer cannot track
        this delivery without it.
      </p>
    );
  }

  if (tracking.suspended) {
    return (
      <p className={`${styles.locBadge} ${styles.locBadgeWarn}`} role="status">
        <IconSignal size={18} />
        Your browser paused location updates. Keep this screen open to keep sending.
      </p>
    );
  }

  if (tracking.lastSentAt === null) {
    return (
      <p className={styles.locBadge} role="status">
        <IconSignal size={18} />
        {tracking.queued > 0
          ? `${tracking.queued} location${tracking.queued === 1 ? '' : 's'} waiting to send`
          : 'Getting your first location fix…'}
      </p>
    );
  }

  const stale = now - tracking.lastSentAt > 40_000;

  return (
    <p
      className={`${styles.locBadge} ${stale ? styles.locBadgeWarn : ''}`}
      role="status"
    >
      <IconSignal size={18} />
      <span>
        Location sent{' '}
        <span className={styles.locBadgeValue}>{ago(tracking.lastSentAt, now)}</span>
      </span>
    </p>
  );
}
