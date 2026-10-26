/**
 * The report arithmetic that does not need a database.
 *
 * Kept pure for the same reason `analytics/kpi.util.ts` is: the bucket
 * boundaries and the slab labels are where a report quietly goes wrong
 * (a week that starts on Sunday, a `to` that drops its own last day), and
 * `test/unit/admin-reports.spec.ts` pins them without a Mongo instance.
 *
 * Every bucket is a UTC calendar day, week or month — the same convention
 * as the dashboard's time series, so the two never disagree about which
 * day an order belongs to.
 */

import { Paginated, paginate } from '../../../common/dto/paginated';
import {
  DateRange,
  Interval,
  bucketStart,
  resolveRange,
  utcDay,
} from '../analytics/kpi.util';
import { inclusiveTo } from '../common/dto';

export const REPORT_KEYS = [
  'sales',
  'vendor_performance',
  'product_performance',
  'delivery_performance',
  'tax_summary',
] as const;

export type ReportKey = (typeof REPORT_KEYS)[number];

/**
 * The groupings each report can honestly produce, first one the default.
 *
 * Mirrors `REPORTS[].groupings` in the web console. A grouping is listed
 * only when its rows fit the report's columns: "vendor performance by
 * city" would have to put a city name in the Vendor column, and "delivery
 * by city" a city in the Date column, so neither exists.
 */
export const REPORT_GROUPINGS: Readonly<Record<ReportKey, readonly string[]>> = {
  sales: ['day', 'week', 'month'],
  vendor_performance: ['vendor'],
  product_performance: ['aisle'],
  delivery_performance: ['day'],
  tax_summary: ['slab'],
};

/** Every grouping any report accepts — the DTO's allowlist. */
export const ALL_GROUPINGS: readonly string[] = [
  ...new Set(Object.values(REPORT_GROUPINGS).flat()),
];

export type TimeGrouping = Interval;

/**
 * One report row. Values are raw (paise, counts, 0–100 percentages);
 * `null` means "not measurable for this row" — an average over zero
 * deliveries — and is never written as 0.
 */
export type ReportRow = Record<string, string | number | null>;

/**
 * The window a report covers.
 *
 * `resolveRange`'s rules (30-day default, reversed pair swapped), with a
 * bare `YYYY-MM-DD` `to` widened to the end of that UTC day — the date
 * pickers send exactly that, and "to the 24th" must include the 24th.
 */
export function reportWindow(
  from?: string,
  to?: string,
  now: Date = new Date(),
): DateRange {
  return resolveRange(
    from,
    to ? inclusiveTo(to).toISOString() : undefined,
    now,
  );
}

/**
 * The bucket a UTC `YYYY-MM-DD` day falls in, labelled by its first day:
 * the day itself, the Monday of its ISO week, or the 1st of its month.
 * Delegates to the dashboard's own `bucketStart`, so a "week" means the
 * same seven days on both screens.
 */
export function bucketOf(day: string, grouping: TimeGrouping): string {
  return utcDay(bucketStart(new Date(`${day}T00:00:00.000Z`), grouping));
}

/**
 * The GST slab an order was ACTUALLY charged at: `taxes ÷ taxable value`,
 * as a whole percent. Read from what the order stored, never from today's
 * platform rate, so a rate change cannot re-label history.
 */
export function slabLabel(ratePct: number | null): string {
  return ratePct === null ? 'No taxable value' : `${ratePct}%`;
}

/**
 * Reports are not paged — a window of days, the stores, the aisles or the
 * slabs is already a bounded set — but they answer in the same envelope as
 * every list endpoint, so the console reads them with the same hook.
 */
export function reportEnvelope(rows: ReportRow[]): Paginated<ReportRow> {
  return paginate(rows, rows.length, 1, rows.length);
}
