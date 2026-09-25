'use client';

/**
 * Online / available / offline, as a live-feeling indicator.
 *
 * The dot is the fast read; the word beside it is the real one. Colour never
 * carries the meaning alone (plan §2.6) — a monochrome screenshot of this table
 * is still correct, because "Online · free" is written out.
 *
 * The halo is a separate pseudo-element so the dot itself never moves. A dot
 * that pulses *in place* in a dense table drags the eye off the numbers, which
 * is the opposite of what an ops console wants.
 */

import styles from '../_shared-pages/pages.module.css';

export function Presence({
  online,
  available,
}: {
  online: boolean;
  available: boolean;
}) {
  const tone = !online ? 'offline' : available ? 'free' : 'busy';

  const dotClass =
    tone === 'offline'
      ? styles.presenceDot
      : tone === 'free'
        ? `${styles.presenceDot} ${styles.presenceOnline}`
        : `${styles.presenceDot} ${styles.presenceBusy}`;

  const label =
    tone === 'offline' ? 'Offline' : tone === 'free' ? 'Online · free' : 'Online · on a run';

  return (
    <span className={styles.presence}>
      <span className={dotClass} aria-hidden="true" />
      <span className={tone === 'offline' ? styles.muted : undefined}>{label}</span>
    </span>
  );
}
