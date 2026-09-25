'use client';

/**
 * Earnings — what today paid, what the window paid, and what cash is owed.
 *
 * ── WHAT THE API ACTUALLY SENDS ─────────────────────────────────────────────
 * `GET /delivery/earnings` is a WINDOW STATEMENT, defaulting to the last 30
 * days: `{ from, to, deliveries, payoutPaise, codCollectedPaise, byDay[] }`.
 *
 * There is no `todayPaise`, no `weekPaise`, no `unpaidPaise` and no
 * `nextPayoutAt`. The previous build displayed all four; every one of them
 * rendered ₹0 forever, and "Awaiting payout ₹0" is a worse lie than no tile at
 * all. Today's figures come from `GET /delivery/me` (`profile.today`), which
 * is the only endpoint that knows what "today" means for this rider.
 *
 * ── COD IS NOT EARNINGS ─────────────────────────────────────────────────────
 * `codCollectedPaise` is cash the rider is HOLDING and owes the platform. It
 * is set apart from the payout and labelled as a debt, because a rider who
 * reads it as income is short at the end of the week.
 *
 * ── NO CHART LIBRARY ────────────────────────────────────────────────────────
 * The per-day bars are two divs and a percentage width. Every bar carries its
 * own mono value beside it, so the bar is emphasis and the number is the data
 * — colour and length never carry meaning alone.
 */

import styles from './delivery.module.css';
import { FixtureBanner, Notice } from './Banners';
import { useRider } from './RiderProvider';
import { RowsSkeleton, StatPairSkeleton } from './Skeletons';
import { dayLabel, money } from '@/lib/delivery/format';
import { useRiderEarnings } from '@/lib/delivery/useRiderData';

/** The bars only ever show the tail of the window; 14 fits 360px comfortably. */
const MAX_BARS = 14;

export function EarningsView() {
  const { value, loading, isSample, error, endpoint, refetch } = useRiderEarnings();
  const { profile } = useRider();

  const today = profile?.today ?? null;
  const days = value.byDay.slice(-MAX_BARS);
  const peak = days.reduce((max, day) => Math.max(max, day.payoutPaise), 0);
  const windowLabel =
    value.from === '' || value.to === ''
      ? 'the last 30 days'
      : `${dayLabel(value.from)} — ${dayLabel(value.to)}`;

  return (
    <>
      <h1 className={styles.h1}>Earnings</h1>

      {isSample ? <FixtureBanner endpoints={[endpoint]} onRetry={refetch} /> : null}
      {error === null ? null : (
        <Notice tone="crit" title="Could not load your earnings">
          {error}
          <div className={styles.bannerCode}>{endpoint}</div>
          <button
            type="button"
            className={styles.ghost}
            onClick={refetch}
            style={{ marginTop: '0.5rem' }}
          >
            Try again
          </button>
        </Notice>
      )}

      {loading && days.length === 0 ? (
        <StatPairSkeleton />
      ) : (
        <div className={styles.summaryGrid}>
          <div className={styles.summaryTile}>
            <div className={styles.summaryValue}>
              {today === null ? '—' : money(today.earningsPaise)}
            </div>
            <div className={styles.summaryLabel}>Today</div>
          </div>
          <div className={styles.summaryTile}>
            <div className={styles.summaryValue}>
              {today === null ? '—' : today.deliveries}
            </div>
            <div className={styles.summaryLabel}>Deliveries today</div>
          </div>
          <div className={styles.summaryTile}>
            <div className={styles.summaryValue}>{money(value.payoutPaise)}</div>
            <div className={styles.summaryLabel}>This period</div>
          </div>
          <div className={styles.summaryTile}>
            <div className={styles.summaryValue}>{value.deliveries}</div>
            <div className={styles.summaryLabel}>Deliveries this period</div>
          </div>
        </div>
      )}

      <section className={styles.panel}>
        <span className={styles.stepTag}>Cash you are holding</span>
        <div className={styles.summaryValue} style={{ fontSize: '2rem' }}>
          {money(value.codCollectedPaise)}
        </div>
        <p className={styles.lede} style={{ fontSize: '0.9rem', marginTop: '0.35rem' }}>
          Cash on delivery you collected over {windowLabel}. This is owed to Mandi — it
          is not part of what you earned.
        </p>
      </section>

      <h2 className={styles.h2}>Day by day</h2>
      {loading && days.length === 0 ? (
        <RowsSkeleton rows={4} />
      ) : (
        <section className={styles.panelFlat}>
          {days.length === 0 ? (
            <p className={styles.lede}>
              No deliveries in this period yet. Days appear here as you complete jobs.
            </p>
          ) : (
            days.map((day) => {
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
      )}

      <Notice tone="neutral" title="How this is worked out">
        Each delivery pays out when the order is marked delivered, and the fee is
        derived from the same distance the offer card quoted — so the statement and the
        offer cannot disagree.
      </Notice>
    </>
  );
}
