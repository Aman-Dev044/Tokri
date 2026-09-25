/**
 * Skeletons shaped like the content that is coming.
 *
 * A grey rectangle tells a rider nothing and makes the layout jump when the
 * real thing lands. Each of these traces the outline of one real screen — a
 * KPI pair, a job card, a list of rows — so the arrival is a fill, not a
 * reflow. They are `aria-hidden`: a screen reader is told "loading" by the
 * live region on the screen itself, not by four empty boxes.
 *
 * The shimmer is switched off entirely under `prefers-reduced-motion`; see the
 * foot of `delivery.module.css`.
 */

import styles from './delivery.module.css';

/** Two KPI tiles — what the top of Home and Earnings resolves into. */
export function StatPairSkeleton() {
  return (
    <div className={styles.skelGrid} aria-hidden="true">
      <div className={styles.skelCard}>
        <span className={styles.skelStat} />
        <span className={`${styles.skelBar} ${styles.skelBarShort}`} />
      </div>
      <div className={styles.skelCard}>
        <span className={styles.skelStat} />
        <span className={`${styles.skelBar} ${styles.skelBarShort}`} />
      </div>
    </div>
  );
}

/** One big card — the job panel, or the offer. */
export function CardSkeleton() {
  return (
    <div className={styles.skelCard} aria-hidden="true">
      <span className={styles.skelTitle} />
      <span className={styles.skelBar} />
      <span className={`${styles.skelBar} ${styles.skelBarShort}`} />
      <span className={styles.skelStat} />
    </div>
  );
}

/** A list of history/earnings rows. */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className={styles.skelStack} aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.skelCard}>
          <span className={`${styles.skelBar} ${styles.skelBarShort}`} />
          <span className={styles.skelBar} />
        </div>
      ))}
    </div>
  );
}
