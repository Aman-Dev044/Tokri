'use client';

/**
 * ★ `/admin` — WHOSE LANDING PAGE IS THIS?
 *
 * One route, two products. The role decides which one renders:
 *
 *   SUPER_ADMIN → <GovernanceOverview/>, below, unchanged. GMV, the trend, the
 *                 aisle split, top vendors and products. It answers "is the
 *                 marketplace healthy?" over a 7/30/90-day window.
 *
 *   ADMIN       → <OpsDashboard/>. A work queue. It answers "what do I do
 *                 next?" over the last ten minutes.
 *
 * ── WHY A BRANCH AND NOT TWO ROUTES ─────────────────────────────────────────
 * Both roles bookmark `/admin`, both call it "the dashboard", and the server
 * already enforces which data each may read. A second route tree would mean
 * two URLs for one idea and thirteen duplicated sections behind them.
 *
 * ── WHY IT WAITS ────────────────────────────────────────────────────────────
 * While the role is still resolving, this renders a skeleton rather than
 * guessing. Guessing means one of the two roles watches the wrong dashboard
 * mount, flash, and get replaced — and the wrong one is always the one that
 * looks like a permissions bug.
 *
 * ── WHAT IT IS FOR (the governance half, below) ─────────────────────────────
 * Two questions, in this order:
 *   1. Is the marketplace healthy right now? (the KPI row, the trend)
 *   2. What needs me? (the attention panel)
 *
 * Everything else — the aisle split, the vendor and product tables, the live
 * feed — is context for those two. The layout says so: the row of numbers is
 * first, the attention panel sits beside the trend rather than below the fold,
 * and the tables come last.
 *
 * ── DATA ────────────────────────────────────────────────────────────────────
 * Six endpoints, six independent queries. They load in parallel and each one
 * degrades on its own: a broken /top-products does not blank the dashboard, it
 * blanks one panel. Any query that falls back to a fixture raises the amber
 * sample-data banner at the top (see lib/admin/fixtures.ts).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAdminQuery } from '@/hooks';
import {
  formatCompact,
  formatCount,
  formatDate,
  formatPaiseCompact,
  humanise,
} from '@/lib/admin/format';
import type {
  OrdersByStatusSlice,
  TopProductRow,
  TopVendorRow,
} from '@/lib/admin/types';
import {
  AISLE_SERIES_COLOR,
  AdminPage,
  AdminSection,
  BarChart,
  DataTable,
  DonutChart,
  IconChevronRight,
  IconInbox,
  KpiTile,
  LineChart,
  Money,
  RelativeTime,
  StatusPill,
  type Column,
} from '@/components/admin';
import { OpsDashboard } from '@/components/admin/ops';
import { useAdminRole } from '@/lib/admin/session';
import {
  toKpis,
  toSalesByAisle,
  toTopProducts,
  toTopVendors,
  toNeedsAttention,
  toRecentOrders,
  toTimeseries,
  type AdminOrderRow,
  type AnalyticsOverview,
  type AnalyticsAisleRow,
  type AnalyticsSeriesPoint,
  type AnalyticsTopProduct,
  type AnalyticsTopVendor,
  type OpsSummary,
} from '@/lib/admin/overview-adapter';

type Range = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Module scope, so the params object is referentially stable per render. */
const RECENT_ORDERS_QUERY = { limit: 8, sort: '-placedAt' } as const;

/**
 * Turn "the last N days" into the window the API actually accepts.
 *
 * Every analytics endpoint takes `?from=&to=` as ISO-8601, and its DTO runs
 * under `forbidNonWhitelisted`. This screen used to send `?days=30`, so all
 * SIX of its requests came back `400 property days should not exist` and the
 * governance overview rendered as an empty shell — no GMV, no trend, no
 * vendors — while looking like a dashboard that simply had no data yet.
 *
 * `days` stays the vocabulary of the UI, because every label on this page
 * says "the last 30 days" and a range picker that spoke in timestamps would
 * be unreadable. It is converted to a window exactly once, here.
 */
function windowFor(days: number): { from: string; to: string } {
  const to = new Date();
  return {
    from: new Date(to.getTime() - days * DAY_MS).toISOString(),
    to: to.toISOString(),
  };
}

export default function AdminHomePage() {
  const { isSuperAdmin, loading } = useAdminRole();

  if (loading) return <DashboardSkeleton />;

  // Least privilege by default: anything not positively known to be a super
  // admin gets the operations dashboard. See lib/admin/session.ts.
  return isSuperAdmin ? <GovernanceOverview /> : <OpsDashboard />;
}

/** Shaped like whichever dashboard is about to arrive: a title and a tile row. */
function DashboardSkeleton() {
  return (
    <div className="adm-page" aria-busy="true">
      <div className="adm-page__head">
        <div style={{ minWidth: 0 }}>
          <span className="adm-skel adm-skel--line" style={{ width: 180, height: 26 }} />
          <span
            className="adm-skel adm-skel--line"
            style={{ width: 320, marginTop: 8 }}
          />
        </div>
      </div>
      <div className="adm-kpirow">
        {[0, 1, 2, 3].map((i) => (
          <span className="adm-skel adm-skel--tile" key={i} />
        ))}
      </div>
      <span className="adm-sr">Loading your dashboard.</span>
    </div>
  );
}

/* ================================================================== */
/* SUPER_ADMIN — the governance overview. Unchanged.                   */
/* ================================================================== */

function GovernanceOverview() {
  const [range, setRange] = useState<Range>('30d');
  const days = RANGE_DAYS[range];

  // Memoised on `days`, not rebuilt per render: `useAdminQuery` keys its
  // effect on JSON.stringify(params), and a fresh `new Date()` every render
  // would produce a new `to` every time — six requests in an endless loop.
  const analyticsWindow = useMemo(() => windowFor(days), [days]);

  const overview = useAdminQuery<AnalyticsOverview>('/admin/analytics/overview', analyticsWindow);
  const series = useAdminQuery<AnalyticsSeriesPoint[]>(
    '/admin/analytics/timeseries',
    analyticsWindow,
  );

  // Two endpoints the governance screen always needed and never called: the
  // attention queues and the order feed came out of the fixture, which is
  // why both panels looked populated while the API was never asked.
  const ops = useAdminQuery<OpsSummary>('/admin/ops/summary');
  const recent = useAdminQuery<{ data: AdminOrderRow[] }>('/admin/orders', RECENT_ORDERS_QUERY);
  const byStatus = useAdminQuery<OrdersByStatusSlice[]>(
    '/admin/analytics/orders-by-status',
    analyticsWindow,
  );
  const byAisleRaw = useAdminQuery<AnalyticsAisleRow[]>(
    '/admin/analytics/sales-by-aisle',
    analyticsWindow,
  );
  const byAisleRows = useMemo(() => toSalesByAisle(byAisleRaw.data), [byAisleRaw.data]);
  const topVendorsParams = useMemo(() => ({ ...analyticsWindow, limit: 8 }), [analyticsWindow]);
  const topProductsParams = useMemo(() => ({ ...analyticsWindow, limit: 8 }), [analyticsWindow]);
  const topVendorsRaw = useAdminQuery<AnalyticsTopVendor[]>(
    '/admin/analytics/top-vendors',
    topVendorsParams,
  );
  const topProductsRaw = useAdminQuery<AnalyticsTopProduct[]>(
    '/admin/analytics/top-products',
    topProductsParams,
  );
  const topVendorRows = useMemo(() => toTopVendors(topVendorsRaw.data), [topVendorsRaw.data]);
  const topProductRows = useMemo(
    () => toTopProducts(topProductsRaw.data, topVendorsRaw.data),
    [topProductsRaw.data, topVendorsRaw.data],
  );

  const fixturePaths = [
    overview.isFixture ? 'overview' : null,
    series.isFixture ? 'timeseries' : null,
    byStatus.isFixture ? 'orders-by-status' : null,
    byAisleRaw.isFixture ? 'sales-by-aisle' : null,
    topVendorsRaw.isFixture ? 'top-vendors' : null,
    topProductsRaw.isFixture ? 'top-products' : null,
  ].filter((value): value is string => value !== null);

  const kpis = useMemo(
    () => toKpis(overview.data, series.data),
    [overview.data, series.data],
  );
  const needsAttention = useMemo(() => toNeedsAttention(ops.data), [ops.data]);
  const recentOrders = useMemo(() => toRecentOrders(recent.data?.data ?? null), [recent.data]);
  const timeseries = useMemo(
    () => ({ ...series, data: toTimeseries(series.data) }),
    [series],
  );
  const loadingKpis = overview.loading && !overview.data;

  /* ---- charts ---- */

  const donutData = useMemo(
    () =>
      (byStatus.data ?? []).map((slice) => ({
        label: humanise(slice.status),
        value: slice.count,
        // A status is not an aisle: this stays on the neutral ramp, with the
        // two that mean trouble picked out semantically.
        color:
          slice.status === 'DELIVERED'
            ? 'var(--good)'
            : slice.status === 'DELIVERY_FAILED'
              ? 'var(--crit)'
              : slice.status === 'CANCELLED'
                ? 'var(--warn)'
                : undefined,
      })),
    [byStatus.data],
  );

  const aisleSeries = useMemo(
    () => [{ key: 'gmvPaise', label: 'GMV' }],
    [],
  );

  /* ---- tables ---- */

  const vendorColumns: Column<TopVendorRow>[] = useMemo(
    () => [
      {
        key: 'storeName',
        header: 'Vendor',
        render: (row) => (
          <Link className="adm-table__link" href={`/admin/vendors/${row.id}`}>
            {row.storeName}
            <span className="adm-table__sub">{row.city}</span>
          </Link>
        ),
      },
      { key: 'orders', header: 'Orders', align: 'right', numeric: true },
      {
        key: 'gmvPaise',
        header: 'GMV',
        align: 'right',
        render: (row) => <Money value={row.gmvPaise} />,
      },
    ],
    [],
  );

  const productColumns: Column<TopProductRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Product',
        render: (row) => (
          <span className="adm-row">
            <span style={{ minWidth: 0 }}>
              {row.name}
              {row.vendorName !== undefined ? (
                <span className="adm-table__sub">{row.vendorName}</span>
              ) : null}
            </span>
          </span>
        ),
      },
      {
        key: 'unitsSold',
        header: 'Units',
        align: 'right',
        render: (row) => <span className="adm-num">{formatCount(row.unitsSold)}</span>,
      },
      {
        key: 'gmvPaise',
        header: 'GMV',
        align: 'right',
        render: (row) => <Money value={row.gmvPaise} />,
      },
    ],
    [],
  );

  return (
    <AdminPage
      title="Overview"
      description={
        overview.data
          ? `Marketplace health from ${formatDate(overview.data.range.from, 'short')} to ${formatDate(overview.data.range.to, 'short')}.`
          : `Marketplace health for the last ${days} days.`
      }
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={<RangeSwitcher value={range} onChange={setRange} />}
    >
      {/* ---------------------------------------------- KPI row ---- */}
      <AdminSection>
        <div className="adm-kpirow">
          <KpiTile
            index={0}
            label="GMV"
            value={kpis?.gmv.value ?? 0}
            unit="paise"
            delta={kpis?.gmv.delta}
            deltaLabel={`vs prev ${days}d`}
            spark={kpis?.gmv.spark}
            tone="neutral"
            loading={loadingKpis}
            isFixture={overview.isFixture}
          />
          <KpiTile
            index={1}
            label="Orders"
            value={kpis?.orders.value ?? 0}
            delta={kpis?.orders.delta}
            deltaLabel={`vs prev ${days}d`}
            spark={kpis?.orders.spark}
            loading={loadingKpis}
            isFixture={overview.isFixture}
          />
          <KpiTile
            index={2}
            label="Average order value"
            value={kpis?.aov.value ?? 0}
            unit="paise"
            delta={kpis?.aov.delta}
            spark={kpis?.aov.spark}
            loading={loadingKpis}
            isFixture={overview.isFixture}
          />
          <KpiTile
            index={3}
            label="Active vendors"
            value={kpis?.activeVendors.value ?? 0}
            delta={kpis?.activeVendors.delta}
            spark={kpis?.activeVendors.spark}
            loading={loadingKpis}
            isFixture={overview.isFixture}
          />
          <KpiTile
            index={4}
            label="Pending approvals"
            value={kpis?.pendingApprovals.value ?? 0}
            delta={kpis?.pendingApprovals.delta}
            spark={kpis?.pendingApprovals.spark}
            /* A queue nobody has cleared is a warning, not a statistic. */
            tone={(kpis?.pendingApprovals.value ?? 0) > 0 ? 'warn' : 'neutral'}
            invertDelta
            loading={loadingKpis}
            isFixture={overview.isFixture}
          />
          <KpiTile
            index={5}
            label="Riders online"
            value={kpis?.onlineRiders.value ?? 0}
            delta={kpis?.onlineRiders.delta}
            spark={kpis?.onlineRiders.spark}
            loading={loadingKpis}
            isFixture={overview.isFixture}
          />
          <KpiTile
            index={6}
            label="Cancellation rate"
            value={kpis?.cancellationRate.value ?? 0}
            unit="%"
            delta={kpis?.cancellationRate.delta}
            spark={kpis?.cancellationRate.spark}
            /* Up is bad here — see KpiTile's note on why this prop exists. */
            invertDelta
            tone={(kpis?.cancellationRate.value ?? 0) > 5 ? 'crit' : 'neutral'}
            loading={loadingKpis}
            isFixture={overview.isFixture}
          />
          <KpiTile
            index={7}
            label="COD share"
            value={kpis?.codShare.value ?? 0}
            unit="%"
            delta={kpis?.codShare.delta}
            spark={kpis?.codShare.spark}
            loading={loadingKpis}
            isFixture={overview.isFixture}
          />
        </div>
      </AdminSection>

      {/* -------------------------------- trend + attention ---- */}
      <div className="adm-grid adm-grid--split" style={{ marginBottom: 'var(--s-5)' }}>
        <AdminSection
          title="GMV and orders"
          description={`Daily, last ${days} days. Hover for a day.`}
        >
          <div className="adm-panel adm-panel--pad">
            {timeseries.loading && !timeseries.data ? (
              <div className="adm-skel adm-skel--chart" />
            ) : (
              <LineChart
                data={timeseries.data ?? []}
                xKey="date"
                height={252}
                series={[
                  { key: 'gmvPaise', label: 'GMV', color: 'var(--adm-series-1)' },
                  { key: 'orders', label: 'Orders', color: 'var(--adm-series-3)' },
                ]}
                formatValue={(value) => formatCompact(value)}
                formatX={(value) => formatDate(`${value}T00:00:00+05:30`, 'day')}
                label={`GMV in paise and order count per day over ${days} days`}
              />
            )}
            <p className="adm-section__desc" style={{ marginTop: 'var(--s-2)' }}>
              GMV is plotted in paise and compacted on the axis — the two series share one scale
              deliberately, so the shape of the relationship between value and volume is visible.
              Read exact figures from the tooltip.
            </p>
          </div>
        </AdminSection>

        <AdminSection title="Needs attention" description="Oldest first. Each one is a queue.">
          <div className="adm-panel">
            {ops.loading && !ops.data ? (
              <div style={{ padding: 'var(--s-3)' }}>
                {Array.from({ length: 4 }, (_, i) => (
                  <div className="adm-skel adm-skel--row" key={i} />
                ))}
              </div>
            ) : needsAttention.length === 0 ? (
              <div className="adm-empty">
                <IconInbox className="adm-empty__icon" />
                <p className="adm-empty__title">Nothing is waiting</p>
                <p className="adm-empty__body">
                  No pending approvals, failed deliveries, low stock or unpaid settlements.
                </p>
              </div>
            ) : (
              <div className="adm-attn">
                {needsAttention.map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="adm-attn__item"
                    data-tone={item.tone}
                  >
                    <span className="adm-attn__count">{formatCount(item.count)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="adm-attn__title">{item.title}</span>
                      <span className="adm-attn__detail">
                        {item.detail}
                        {item.at !== undefined ? (
                          <>
                            {' · oldest '}
                            <RelativeTime value={item.at} />
                          </>
                        ) : null}
                      </span>
                    </span>
                    <IconChevronRight className="adm-attn__chev" />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </AdminSection>
      </div>

      {/* -------------------------------- donut + aisle bars ---- */}
      <div className="adm-grid adm-grid--2" style={{ marginBottom: 'var(--s-5)' }}>
        <AdminSection title="Orders by status" description={`All orders in the last ${days} days.`}>
          <div className="adm-panel adm-panel--pad">
            {byStatus.loading && !byStatus.data ? (
              <div className="adm-skel adm-skel--chart" />
            ) : (
              <DonutChart
                data={donutData}
                height={200}
                caption="ORDERS"
                formatValue={(value) => formatCompact(value)}
                label="Orders split by status"
              />
            )}
          </div>
        </AdminSection>

        <AdminSection
          title="Sales by aisle"
          description="The one place this console uses the chromatic-aisle palette — here the hue is the data."
        >
          <div className="adm-panel adm-panel--pad">
            {byAisleRaw.loading && !byAisleRaw.data ? (
              <div className="adm-skel adm-skel--chart" />
            ) : (
              <BarChart
                data={byAisleRows}
                xKey="aisle"
                horizontal
                height={232}
                series={aisleSeries}
                /* Per-bar colour, from the row's own aisle — so each bar
                   matches the <AisleDot/> beside every product name elsewhere
                   on this page. This and AisleDot are the only two places the
                   chromatic palette appears in the console (plan §2.4). */
                colorByRow={(row) => {
                  const key = row.aisleKey;
                  return typeof key === 'string' && key in AISLE_SERIES_COLOR
                    ? AISLE_SERIES_COLOR[key as keyof typeof AISLE_SERIES_COLOR]
                    : undefined;
                }}
                formatValue={(value) => formatPaiseCompact(value)}
                label="Gross merchandise value by aisle"
              />
            )}
            <div className="adm-legend">
              {byAisleRows.map((row) => (
                <span className="adm-legend__item" key={row.aisleKey}>
                  <span
                    className="adm-swatch"
                    style={{ background: AISLE_SERIES_COLOR[row.aisleKey] }}
                  />
                  {row.aisle}
                </span>
              ))}
            </div>
          </div>
        </AdminSection>
      </div>

      {/* -------------------------------- tables + feed ---- */}
      <div className="adm-grid adm-grid--2" style={{ marginBottom: 'var(--s-5)' }}>
        <AdminSection
          title="Top vendors"
          description="By GMV in the selected window."
          actions={
            <Link className="adm-btn adm-btn--sm" href="/admin/vendors">
              All vendors
            </Link>
          }
        >
          <DataTable
            columns={vendorColumns}
            rows={topVendorRows}
            loading={topVendorsRaw.loading && !topVendorsRaw.data}
            rowKey={(row) => row.id}
            skeletonRows={6}
          />
        </AdminSection>

        <AdminSection title="Top products" description="By GMV in the selected window.">
          <DataTable
            columns={productColumns}
            rows={topProductRows}
            loading={topProductsRaw.loading && !topProductsRaw.data}
            rowKey={(row) => row.id}
            skeletonRows={6}
          />
        </AdminSection>
      </div>

      <AdminSection
        title="Recent orders"
        description="The last few, newest first."
        actions={
          <Link className="adm-btn adm-btn--sm" href="/admin/orders">
            All orders
          </Link>
        }
      >
        <div className="adm-panel">
          <div className="adm-feed">
            {recentOrders.map((order, i) => (
              <Link
                key={order.id}
                href={`/admin/orders/${order.id}`}
                className="adm-feed__item"
                style={{ ['--adm-i' as string]: String(Math.min(i, 14)) }}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="adm-feed__no">{order.orderNo}</span>
                  <span className="adm-feed__meta">
                    {order.vendorName} → {order.customerName} · <RelativeTime value={order.placedAt} />
                  </span>
                </span>
                <span className="adm-row" style={{ justifyContent: 'flex-end' }}>
                  <StatusPill status={order.status} kind="order" />
                  <Money value={order.totalPaise} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </AdminSection>
    </AdminPage>
  );
}

/* ------------------------------------------------------------------ */

function RangeSwitcher({ value, onChange }: { value: Range; onChange: (next: Range) => void }) {
  return (
    <div className="adm-segmented" role="group" aria-label="Date range">
      {(['7d', '30d', '90d'] as const).map((option) => (
        <button
          key={option}
          type="button"
          className="adm-segmented__btn"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
