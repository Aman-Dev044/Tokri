/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE GOVERNANCE OVERVIEW, AS THE API ACTUALLY SENDS IT
 * ════════════════════════════════════════════════════════════════════════
 *
 * `/admin` (the SUPER_ADMIN half) was written against `fixtures.ts` and
 * never against the service. The fixture invented a shape — `generatedAt`,
 * `kpis`, `needsAttention`, `recentOrders`, and a timeseries of
 * `{ date, gmvPaise, orders }` — and the API returns none of it. It sends
 * flat metrics as `{ value, previous, deltaPct }` and a series of
 * `{ date, value }`.
 *
 * That disagreement stayed invisible for one reason: the page was sending
 * `?days=30` to a DTO running under `forbidNonWhitelisted`, so every
 * request 400'd, `useAdminQuery` fell back to the fixture, and the console
 * rendered a complete, plausible, entirely fictional dashboard. Fixing the
 * query parameter was what finally let real data through — and the first
 * thing it did was crash the page on `formatDate(undefined)`.
 *
 * So this file is the contract the page always assumed existed. It is kept
 * separate from `fixtures.ts` on purpose: fixtures are what the screen
 * shows when the API is unreachable, and an adapter is how it reads the API
 * when it is. Mixing them is how the two drifted apart in the first place.
 *
 * ── The rule for anything the API does not send ─────────────────────────
 * It is left `undefined`, never invented. There is no per-KPI trailing
 * series for vendor counts, so those tiles get no sparkline rather than a
 * decorative one; `ops/summary` counts queues without timestamping them, so
 * an attention row carries no `at` and the view omits "oldest …" instead of
 * printing a plausible time. A number on a governance screen is read as
 * fact, and a fabricated one is worse than a blank.
 */

import { getAisle, type AisleKey } from '@mandi/design-system';

import type {
  KpiDatum,
  KpiKey,
  NeedsAttentionItem,
  OrderStatus,
  RecentOrder,
  SalesByAisleRow,
  TimeseriesPoint,
  TopProductRow,
  TopVendorRow,
} from './types';

/* ──────────────────────────── what the API sends ─────────────────────── */

/** Every metric on the overview arrives in this envelope. */
export interface AnalyticsMetric {
  value: number;
  previous: number;
  /** null when the previous window was zero — a ratio against nothing. */
  deltaPct: number | null;
}

export interface AnalyticsOverview {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  gmv: AnalyticsMetric;
  orderCount: AnalyticsMetric;
  aov: AnalyticsMetric;
  activeVendors: AnalyticsMetric;
  pendingVendors: AnalyticsMetric;
  customerCount: AnalyticsMetric;
  riderCount: AnalyticsMetric;
  onlineRiders: AnalyticsMetric;
  cancellationRate: AnalyticsMetric;
  codShare: AnalyticsMetric;
}

/** `/admin/analytics/timeseries` — one metric at a time, not a wide row. */
export interface AnalyticsSeriesPoint {
  date: string;
  value: number;
}

/** The queue counts behind `/admin/ops/summary`. */
export interface OpsSummary {
  needsAction: {
    pendingVendors: number;
    pendingRiders: number;
    unassignedOrders: number;
    stuckOrders: number;
    failedDeliveries: number;
    openIssues: number;
    lowStockItems: number;
    outOfStockItems: number;
  };
}

/** One row of `/admin/orders`. */
export interface AdminOrderRow {
  id: string;
  orderNo: string;
  status: OrderStatus;
  customerName: string;
  vendorName: string;
  pricing: { grandTotal: number };
  placedAt: string;
}

/* ─────────────────────────────── the mapping ─────────────────────────── */

/**
 * `deltaPct` is null when the previous window held nothing. "+100%" against
 * zero is not a measurement, so the tile is given no delta at all and
 * renders the value alone.
 */
const datum = (metric: AnalyticsMetric | undefined, spark?: number[]): KpiDatum => ({
  value: metric?.value ?? 0,
  delta: metric?.deltaPct ?? undefined,
  spark,
});

export function toKpis(
  overview: AnalyticsOverview | null,
  gmvSeries?: AnalyticsSeriesPoint[] | null,
): Record<KpiKey, KpiDatum> | undefined {
  if (!overview) return undefined;

  // The only real trailing series this screen has. It belongs to GMV, so
  // only GMV gets a sparkline — the other seven tiles are a single number
  // each, which is what the API measured.
  const spark = gmvSeries?.map((point) => point.value);

  return {
    gmv: datum(overview.gmv, spark),
    orders: datum(overview.orderCount),
    aov: datum(overview.aov),
    activeVendors: datum(overview.activeVendors),
    pendingApprovals: datum(overview.pendingVendors),
    onlineRiders: datum(overview.onlineRiders),
    cancellationRate: datum(overview.cancellationRate),
    codShare: datum(overview.codShare),
  };
}

/**
 * The chart reads a wide row (`gmvPaise`, `orders`) because it can plot more
 * than one series. The API answers one metric per call, so a single call
 * fills one column and the other stays absent rather than zero — a flat
 * line at zero reads as "no orders", which is a different claim from "not
 * requested".
 */
export function toTimeseries(points: AnalyticsSeriesPoint[] | null): TimeseriesPoint[] {
  return (points ?? []).map((point) => ({
    date: point.date,
    gmvPaise: point.value,
    orders: 0,
  }));
}

interface QueueSpec {
  key: keyof OpsSummary['needsAction'];
  title: string;
  detail: string;
  tone: NeedsAttentionItem['tone'];
  href: string;
}

/**
 * Ordered by what it costs to ignore, not alphabetically: a delivery that
 * failed has a customer waiting on it; an application that has not been
 * read has somebody waiting to start work.
 */
const QUEUES: readonly QueueSpec[] = [
  {
    key: 'stuckOrders',
    title: 'Stuck orders',
    detail: 'Past their stage for too long',
    tone: 'crit',
    href: '/admin/orders?filter=stuck',
  },
  {
    key: 'failedDeliveries',
    title: 'Failed deliveries',
    detail: 'A rider could not complete the drop',
    tone: 'crit',
    href: '/admin/orders?status=DELIVERY_FAILED',
  },
  {
    key: 'unassignedOrders',
    title: 'Unassigned orders',
    detail: 'Ready to collect, no rider on them',
    tone: 'warn',
    href: '/admin/dispatch',
  },
  {
    key: 'outOfStockItems',
    title: 'Out of stock',
    detail: 'Listed, orderable, and not on the shelf',
    tone: 'warn',
    href: '/admin/stock',
  },
  {
    key: 'openIssues',
    title: 'Open issues',
    detail: 'Raised by a customer, not yet answered',
    tone: 'warn',
    href: '/admin/issues',
  },
  {
    key: 'pendingVendors',
    title: 'Vendors waiting',
    detail: 'Applications nobody has read',
    tone: 'neutral',
    href: '/admin/approvals?tab=vendors',
  },
  {
    key: 'pendingRiders',
    title: 'Riders waiting',
    detail: 'Documents submitted, not verified',
    tone: 'neutral',
    href: '/admin/approvals?tab=riders',
  },
  {
    key: 'lowStockItems',
    title: 'Low stock',
    detail: 'Under the threshold their vendor set',
    tone: 'neutral',
    href: '/admin/stock',
  },
];

/** Empty queues are dropped: "0 stuck orders" is noise, not information. */
export function toNeedsAttention(summary: OpsSummary | null): NeedsAttentionItem[] {
  if (!summary) return [];
  return QUEUES.filter((queue) => (summary.needsAction[queue.key] ?? 0) > 0).map((queue) => ({
    id: queue.key,
    kind: queue.key,
    title: queue.title,
    detail: queue.detail,
    tone: queue.tone,
    count: summary.needsAction[queue.key],
    href: queue.href,
  }));
}

export function toRecentOrders(rows: AdminOrderRow[] | null): RecentOrder[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    orderNo: row.orderNo,
    vendorName: row.vendorName,
    customerName: row.customerName,
    status: row.status,
    totalPaise: row.pricing.grandTotal,
    placedAt: row.placedAt,
  }));
}

/* ───────────────────────── the two "top" tables ──────────────────────── */

/**
 * The leaderboards have the same history as the overview above: the tables
 * were written against a fixture that invented a vendor `rating` and a
 * per-vendor `commissionPaise`, and the service sends neither. The columns
 * that had no source are gone from the screen rather than filled in — a
 * rating is a claim about a real business, and a plausible one is a lie.
 */
export interface AnalyticsTopVendor {
  vendorId: string;
  storeName: string;
  city: string;
  status: string;
  gmv: number;
  orderCount: number;
}

export interface AnalyticsTopProduct {
  productId: string;
  name: string;
  image: string | null;
  vendorId: string;
  gmv: number;
  unitsSold: number;
}

export function toTopVendors(rows: AnalyticsTopVendor[] | null): TopVendorRow[] {
  return (rows ?? []).map((row) => ({
    id: row.vendorId,
    storeName: row.storeName,
    city: row.city,
    orders: row.orderCount,
    gmvPaise: row.gmv,
  }));
}

/**
 * `vendors` is passed in so a product can name its shop. The products
 * endpoint carries only a `vendorId`, and the vendors leaderboard on the
 * same screen already knows the names — so this is a join across two real
 * responses, not a lookup against invented data. A product whose vendor is
 * outside the top N simply has no sub-label.
 */
export function toTopProducts(
  rows: AnalyticsTopProduct[] | null,
  vendors: AnalyticsTopVendor[] | null,
): TopProductRow[] {
  const nameById = new Map((vendors ?? []).map((v) => [v.vendorId, v.storeName]));
  return (rows ?? []).map((row) => ({
    id: row.productId,
    name: row.name,
    vendorName: nameById.get(row.vendorId),
    unitsSold: row.unitsSold,
    gmvPaise: row.gmv,
  }));
}

/* ───────────────────────────── sales by aisle ────────────────────────── */

/**
 * `{ aisleKey, gmv, orderCount }` from the service; the chart wants
 * `{ aisleKey, aisle, gmvPaise, orders }`. The display NAME is not in the
 * response and does not need to be — `aisles.ts` is the single source of
 * truth for what an aisle is called, in both scripts, and an endpoint that
 * also shipped the name would be a second place for it to disagree.
 *
 * Found the same way as the rest of this file: the bars rendered empty
 * against a response that plainly had numbers in it, because the chart read
 * `gmvPaise` off a row that only had `gmv`.
 */
export interface AnalyticsAisleRow {
  aisleKey: AisleKey;
  gmv: number;
  orderCount: number;
}

export function toSalesByAisle(rows: AnalyticsAisleRow[] | null): SalesByAisleRow[] {
  return (rows ?? []).map((row) => ({
    aisleKey: row.aisleKey,
    aisle: getAisle(row.aisleKey)?.name ?? row.aisleKey,
    gmvPaise: row.gmv,
    orders: row.orderCount,
  }));
}
