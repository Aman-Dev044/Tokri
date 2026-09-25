'use client';

/**
 * Completed deliveries, newest first, grouped by day.
 *
 * This screen has no primary action — it is a record, not a task — so the nav
 * keeps the dock. Every number is mono and tabular so a column of payouts
 * reads as a column.
 *
 * `GET /delivery/orders?status=DELIVERED` is not in plan §6.2's DELIVERY block
 * yet, so today this is expected to 404 and show the sample banner. See the
 * note on `DELIVERY_PATHS`.
 */

import styles from './delivery.module.css';
import { FixtureBanner } from './Banners';
import { IconList } from './icons';
import { dayLabel, distance, money, timeOfDay } from '@/lib/delivery/format';
import { useRiderHistory } from '@/lib/delivery/useRiderData';
import type { HistoryEntry } from '@/lib/delivery/types';

function groupByDay(rows: readonly HistoryEntry[]): Array<[string, HistoryEntry[]]> {
  const map = new Map<string, HistoryEntry[]>();
  for (const row of rows) {
    const key = row.completedAt.slice(0, 10);
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [row]);
    else bucket.push(row);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

export function HistoryView() {
  const { value, loading, isSample, endpoint, refetch } = useRiderHistory();

  const sorted = [...value].sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
  const days = groupByDay(sorted);

  return (
    <>
      <h1 className={styles.h1}>History</h1>

      {isSample ? <FixtureBanner endpoints={[endpoint]} onRetry={refetch} /> : null}

      {loading && value.length === 0 ? (
        <div className={styles.skeleton} style={{ height: '10rem' }} aria-hidden="true" />
      ) : null}

      {!loading && sorted.length === 0 ? (
        <div className={styles.resting}>
          <IconList size={56} className={styles.restingMark} />
          <p className={styles.lede}>No completed deliveries yet.</p>
        </div>
      ) : null}

      {days.map(([day, rows]) => {
        const dayTotal = rows.reduce((sum, row) => sum + row.payoutPaise, 0);
        return (
          <section key={day}>
            <div className={styles.dayHead}>
              <span>{dayLabel(day)}</span>
              <span className={styles.rowValue}>{money(dayTotal)}</span>
            </div>
            <div className={styles.rows} style={{ marginTop: '0.5rem' }}>
              {rows.map((row) => {
                const failed = row.status === 'DELIVERY_FAILED';
                return (
                  <article
                    key={row.orderId}
                    className={`${styles.row} ${failed ? styles.rowFailed : ''}`}
                  >
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>{row.dropLabel}</div>
                      <div className={styles.rowMeta}>
                        {timeOfDay(row.completedAt)} · {distance(row.distanceMeters)}
                        {row.orderNo === undefined ? '' : ` · ${row.orderNo}`}
                        {failed ? ' · not delivered' : ''}
                      </div>
                    </div>
                    <div className={styles.rowValue}>{money(row.payoutPaise)}</div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
