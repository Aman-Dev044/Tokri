'use client';

/**
 * Earnings — what today paid, what the week paid, what is still owed.
 *
 * ── NO CHART LIBRARY ────────────────────────────────────────────────────────
 * The per-day bars are two divs and a percentage width. A rider glancing at
 * this wants "which days were good", not an axis, a tooltip or a legend — and
 * a charting bundle on a phone over 3G is a real cost for no real information.
 * Every bar carries its own mono value beside it, so the bar is emphasis and
 * the number is the data (plan §2.6 — colour and length never carry meaning
 * alone).
 *
 * `GET /delivery/earnings` is not in plan §6.2's DELIVERY block yet, so today
 * this is expected to 404 and show the sample banner.
 */

import styles from './delivery.module.css';
import { FixtureBanner, Notice } from './Banners';
import { dayLabel, money } from '@/lib/delivery/format';
import { useRiderEarnings } from '@/lib/delivery/useRiderData';

export function EarningsView() {
  const { value, loading, isSample, endpoint, refetch } = useRiderEarnings();

  const peak = value.days.reduce((max, day) => Math.max(max, day.payoutPaise), 0);

  return (
    <>
      <h1 className={styles.h1}>Earnings</h1>

      {isSample ? <FixtureBanner endpoints={[endpoint]} onRetry={refetch} /> : null}

      {loading && value.days.length === 0 ? (
        <div className={styles.skeleton} style={{ height: '10rem' }} aria-hidden="true" />
      ) : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>{money(value.todayPaise)}</div>
          <div className={styles.summaryLabel}>Today</div>
        </div>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>{value.todayDeliveries}</div>
          <div className={styles.summaryLabel}>Deliveries today</div>
        </div>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>{money(value.weekPaise)}</div>
          <div className={styles.summaryLabel}>This week</div>
        </div>
        <div className={styles.summaryTile}>
          <div className={styles.summaryValue}>{value.weekDeliveries}</div>
          <div className={styles.summaryLabel}>Deliveries this week</div>
        </div>
      </div>

      <section className={styles.panel}>
        <span className={styles.stepTag}>Awaiting payout</span>
        <div className={styles.summaryValue} style={{ fontSize: '2rem' }}>
          {money(value.unpaidPaise)}
        </div>
        <p className={styles.lede} style={{ fontSize: '0.9rem', marginTop: '0.35rem' }}>
          {value.nextPayoutAt === undefined
            ? 'Payouts are settled weekly. Mandi has not sent a date for the next run.'
            : `Next payout ${dayLabel(value.nextPayoutAt)}.`}
        </p>
      </section>

      <h2 className={styles.h2}>Last 7 days</h2>
      <section className={styles.panelFlat}>
        {value.days.length === 0 ? (
          <p className={styles.lede}>No days to show yet.</p>
        ) : (
          value.days.map((day) => {
            const pct = peak === 0 ? 0 : Math.round((day.payoutPaise / peak) * 100);
            return (
              <div key={day.date} className={styles.barRow}>
                <span className={styles.barLabel}>{dayLabel(day.date).slice(0, 6)}</span>
                <span className={styles.barTrack}>
                  <span className={styles.barFill} style={{ width: `${pct}%` }} />
                </span>
                <span className={styles.barValue}>{money(day.payoutPaise)}</span>
              </div>
            );
          })
        )}
      </section>

      <Notice tone="neutral" title="How this is worked out">
        Each delivery pays out when the order is marked delivered. Tips, when a customer
        leaves one, are added on top and are never taken out of the delivery fee.
      </Notice>
    </>
  );
}
