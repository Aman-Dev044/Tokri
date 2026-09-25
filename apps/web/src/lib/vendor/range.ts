/**
 * ★ "Today / 7 days / 30 days" — computed HERE, not asked for.
 *
 * The panel used to send `?range=day` and `?window=today`. Neither parameter
 * exists: every vendor endpoint that takes a window takes `from` and `to` as
 * ISO-8601 instants (`VendorDateRangeQueryDto`), and with
 * `forbidNonWhitelisted: true` an unknown query key is a hard 400 rather than
 * an ignored extra. So a period switcher in the UI is a client-side
 * computation, not a server vocabulary.
 *
 * ── LOCAL MIDNIGHT, NOT UTC MIDNIGHT ────────────────────────────────────────
 * "Today" means the shop's today. `new Date(y, m, d)` is local midnight, which
 * in IST is 18:30 UTC the previous day — exactly what `GET /vendor/dashboard`
 * reports as its `today`. Using `toISOString().slice(0, 10)` instead would
 * start the day five and a half hours late and quietly drop the evening's
 * orders out of the "today" figures.
 */

import type { SalesGroupBy } from './types';

/** The periods the UI offers. Purely a client-side vocabulary. */
export type PeriodKey = 'today' | 'week' | 'month';

export interface DateWindow {
  /** ISO-8601 instant, inclusive. */
  from: string;
  /** ISO-8601 instant, inclusive. */
  to: string;
}

const DAY_MS = 86_400_000;

/** Midnight local time on the day containing `at`. */
export function startOfLocalDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

/** One millisecond before tomorrow's local midnight. */
export function endOfLocalDay(at: Date): Date {
  return new Date(startOfLocalDay(at).getTime() + DAY_MS - 1);
}

/**
 * `today` is this local day. `week` and `month` are the last 7 / 30 days
 * INCLUDING today — a shop owner reading "7 days" on a Tuesday means the last
 * seven days of trading, not the calendar week so far.
 */
export function windowFor(period: PeriodKey, now: Date = new Date()): DateWindow {
  const to = endOfLocalDay(now);
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  const from = new Date(startOfLocalDay(now).getTime() - (days - 1) * DAY_MS);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Just today, for the dashboard's "orders today" board. */
export function todayWindow(now: Date = new Date()): DateWindow {
  return windowFor('today', now);
}

/**
 * The bucket size that keeps a chart readable over each period.
 *
 * `day` for everything at or under a month: 30 daily bars is a shape a person
 * can read, and the API has no finer grain than a day — there is no hourly
 * grouping, so a one-day chart is a single bar and the page says so rather
 * than inventing `groupBy=hour`.
 */
export function groupByFor(period: PeriodKey): SalesGroupBy {
  return period === 'month' ? 'day' : 'day';
}

/** Human copy for the period, used in chart captions and tile footnotes. */
export const PERIOD_WORD: Record<PeriodKey, string> = {
  today: 'today',
  week: 'over the last 7 days',
  month: 'over the last 30 days',
};

export const PERIOD_OPTIONS: ReadonlyArray<{ value: PeriodKey; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
];
