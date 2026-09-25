/**
 * The KPI arithmetic, deliberately kept pure.
 *
 * Nothing here touches Mongo, Nest or the clock (the clock is always an
 * argument). That is what makes `test/unit/analytics.spec.ts` able to pin
 * the edge cases — division by zero, a period with no predecessor, a
 * window that lands on a DST-free UTC boundary — without a database.
 *
 * Every money value is INTEGER PAISE, in and out.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export const DEFAULT_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

/**
 * Resolves `?from&to` into a concrete, inclusive window.
 *
 * Rules:
 *  - neither given  -> the last DEFAULT_WINDOW_DAYS, ending now
 *  - only `from`    -> from .. now
 *  - only `to`      -> the DEFAULT_WINDOW_DAYS ending at `to`
 *  - reversed pair  -> swapped, because a reversed range silently matches
 *                      nothing and renders an empty dashboard that looks
 *                      like "no sales" rather than "bad input"
 */
export function resolveRange(
  from?: string,
  to?: string,
  now: Date = new Date(),
): DateRange {
  const end = to ? new Date(to) : new Date(now);
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    // The DTO validates ISO-8601 before this is reached; this is the
    // belt-and-braces path for a programmatic caller.
    const fallbackEnd = new Date(now);
    return {
      from: new Date(fallbackEnd.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY),
      to: fallbackEnd,
    };
  }

  return start.getTime() <= end.getTime()
    ? { from: start, to: end }
    : { from: end, to: start };
}

/**
 * The equal-length window immediately preceding `range`.
 *
 * It ends one millisecond before `range.from`, so the two windows are
 * adjacent and never double-count an order that sits exactly on the
 * boundary (both windows are inclusive at each end).
 */
export function previousPeriod(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime();
  const end = new Date(range.from.getTime() - 1);
  return { from: new Date(end.getTime() - span), to: end };
}

/**
 * Percentage change, rounded to one decimal place.
 *
 * Returns `null` when there is no comparable base — a previous value of
 * zero. "+100%" and "+Infinity%" are both lies there: going from 0 to 7
 * orders is not a percentage change, it is a start. The UI renders null
 * as a dash, which is the honest answer.
 */
export function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return round1(((current - previous) / previous) * 100);
}

/** Average order value in INTEGER PAISE. Zero orders means zero, not NaN. */
export function aov(gmvPaise: number, orderCount: number): number {
  if (orderCount <= 0) return 0;
  return Math.round(gmvPaise / orderCount);
}

/** A share expressed as a percentage, one decimal place. 0/0 is 0. */
export function ratePct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return round1((numerator / denominator) * 100);
}

export const round1 = (value: number): number =>
  Math.round(value * 10) / 10;

export type Interval = 'day' | 'week' | 'month';

export interface SeriesPoint {
  /** Bucket start, `YYYY-MM-DD` (UTC). */
  date: string;
  value: number;
}

/** `YYYY-MM-DD` in UTC, matching what `$dateToString` produces. */
export const utcDay = (date: Date): string =>
  date.toISOString().slice(0, 10);

/**
 * Zero-fills a sparse aggregation result across the whole window.
 *
 * A chart fed only the buckets that happen to have data draws a
 * continuous line through a three-day outage, which reads as "steady
 * trade" instead of "we were down". Every bucket in the range is present
 * in the output, in order.
 */
export function fillSeries(
  rows: readonly SeriesPoint[],
  range: DateRange,
  interval: Interval = 'day',
): SeriesPoint[] {
  const byDate = new Map(rows.map((row) => [row.date, row.value]));
  const out: SeriesPoint[] = [];

  let cursor = bucketStart(range.from, interval);
  const last = bucketStart(range.to, interval);

  // Bounded so a pathological range can never spin: 3 years of days.
  for (let guard = 0; cursor <= last && guard < 1200; guard += 1) {
    const key = utcDay(cursor);
    out.push({ date: key, value: byDate.get(key) ?? 0 });
    cursor = nextBucket(cursor, interval);
  }

  return out;
}

/** Start of the bucket containing `date`, in UTC. */
export function bucketStart(date: Date, interval: Interval): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  if (interval === 'week') {
    // ISO weeks start on Monday. getUTCDay(): 0 = Sunday.
    const shift = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - shift);
  } else if (interval === 'month') {
    d.setUTCDate(1);
  }
  return d;
}

function nextBucket(date: Date, interval: Interval): Date {
  const d = new Date(date);
  if (interval === 'day') d.setUTCDate(d.getUTCDate() + 1);
  else if (interval === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

/** One KPI tile: the value now, and how it moved against the last window. */
export interface Kpi {
  value: number;
  previous: number;
  deltaPct: number | null;
}

export const kpi = (value: number, previous: number): Kpi => ({
  value,
  previous,
  deltaPct: deltaPct(value, previous),
});
