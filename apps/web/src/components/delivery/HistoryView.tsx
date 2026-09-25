'use client';

/**
 * Completed deliveries, newest first, grouped by day.
 *
 * This screen has no primary action — it is a record, not a task — so the nav
 * keeps the dock. Every number is mono and tabular so a column of payouts
 * reads as a column.
 *
 * `GET /delivery/history?page&limit` is live. The previous build called
 * `GET /delivery/orders?status=DELIVERED&limit=50&sort=-updatedAt`, which does
 * not exist — a 404 that the sample banner made look intentional.
 *
 * ── WHAT A ROW ACTUALLY HAS ─────────────────────────────────────────────────
 * The API returns `city` and `pincode`, not a drop label and not a full
 * address. `deliveredAt` is NULL on a failed attempt — a failed attempt never
 * reached a delivery time — so those rows are grouped under "Not delivered"
 * rather than being dated with a fabricated timestamp.
 */

import styles from './delivery.module.css';
import { FixtureBanner, Notice } from './Banners';
import { IconList } from './icons';
import { RowsSkeleton } from './Skeletons';
import { dayLabel, distanceKm, money, timeOfDay } from '@/lib/delivery/format';
import { useRiderHistory } from '@/lib/delivery/useRiderData';
import type { DeliveryHistoryRow } from '@/lib/delivery/types';

/** The bucket a dateless row lands in. Sorts last, because it has no date. */
const UNDATED = '';

function groupByDay(rows: readonly DeliveryHistoryRow[]): Array<[string, DeliveryHistoryRow[]]> {
  const map = new Map<string, DeliveryHistoryRow[]>();
  for (const row of rows) {
    const key = row.deliveredAt === null ? UNDATED : row.deliveredAt.slice(0, 10);
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [row]);
    else bucket.push(row);
  }
  return [...map.entries()].sort((a, b) => {
    if (a[0] === UNDATED) return 1;
    if (b[0] === UNDATED) return -1;
    return a[0] < b[0] ? 1 : -1;
  });
}

/** "Bengaluru 560034", or whichever half of it the order actually had. */
function placeLine(row: DeliveryHistoryRow): string {
  const parts = [row.city, row.pincode].filter((part) => part !== '');
  return parts.length === 0 ? 'Delivery' : parts.join(' ');
}

export function HistoryView() {
  const { value, loading, isSample, error, endpoint, refetch } = useRiderHistory();

  const sorted = [...value].sort((a, b) => {
    const left = a.deliveredAt ?? '';
    const right = b.deliveredAt ?? '';
    return left < right ? 1 : left > right ? -1 : 0;
  });
  const days = groupByDay(sorted);

  return (
    <>
      <h1 className={styles.h1}>History</h1>

      {isSample ? <FixtureBanner endpoints={[endpoint]} onRetry={refetch} /> : null}
      {error === null ? null : (
        <Notice tone="crit" title="Could not load your history">
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

      {loading && sorted.length === 0 ? <RowsSkeleton rows={5} /> : null}

      {!loading && error === null && sorted.length === 0 ? (
        <div className={styles.resting}>
          <IconList size={56} className={styles.restingMark} />
          <p className={styles.lede}>
            No completed deliveries yet. Every job you finish lands here with what it
            paid.
          </p>
        </div>
      ) : null}

      {days.map(([day, rows]) => {
        const dayTotal = rows.reduce((sum, row) => sum + row.payoutPaise, 0);
        return (
          <section key={day === UNDATED ? 'undated' : day}>
            <div className={styles.dayHead}>
              <span>{day === UNDATED ? 'Not delivered' : dayLabel(day)}</span>
              <span className={styles.rowValue}>{money(dayTotal)}</span>
            </div>
            <div className={styles.rows} style={{ marginTop: '0.5rem' }}>
              {rows.map((row) => {
                const failed = row.status !== 'DELIVERED';
                return (
                  <article
                    key={row.orderId}
                    className={`${styles.row} ${failed ? styles.rowFailed : ''}`}
                  >
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>{placeLine(row)}</div>
                      <div className={styles.rowMeta}>
                        {row.deliveredAt === null ? '—' : timeOfDay(row.deliveredAt)} ·{' '}
                        {distanceKm(row.distanceKm)}
                        {row.orderNo === '' ? '' : ` · ${row.orderNo}`}
                        {failed ? ' · not delivered' : ''}
                      </div>
                      {row.codCollectedPaise > 0 ? (
                        <div className={styles.rowMeta}>
                          Cash collected {money(row.codCollectedPaise)}
                        </div>
                      ) : null}
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
