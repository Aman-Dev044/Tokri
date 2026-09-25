'use client';

/**
 * The morning screen.
 *
 * A shop owner opens this once, reads it in about four seconds, and then lives
 * in the orders board for the rest of the day. So it answers exactly five
 * questions and stops: how much have I taken today, how many orders, is anyone
 * waiting on me, what is about to run out, and what do customers think of me.
 *
 * ── THE NEEDS-ACTION STRIP ──────────────────────────────────────────────────
 * The only part of this page that is not a number: a short list of things that
 * are wrong RIGHT NOW, each one a link straight to the screen that fixes it. A
 * dashboard that reports a problem without a route to its solution just makes
 * the reader feel worse.
 *
 * It is ordered by cost, not by category: an unaccepted order outranks a
 * low-stock warning, because one is a customer watching a spinner and the other
 * is a problem for tomorrow.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  AdminPage,
  AdminSection,
  BarChart,
  IconChevronRight,
  IconInbox,
  EmptyState,
  KpiTile,
  Money,
  RelativeTime,
  StatusPill,
  type ChartRow,
} from '@/components/admin';
import { useFreshness, useVendorQuery } from '@/hooks';
import { formatDate, formatPaiseCompact } from '@/lib/admin/format';
import type {
  EarningsSummary,
  InventoryRow,
  OrderStatus,
  Paged,
  SalesReport,
  VendorOrder,
  VendorProfile,
} from '@/lib/vendor/types';
import { ORDER_POLL_MS, useVendorAlerts } from '../VendorAlertProvider';
import { FreshLine } from '../primitives';

/** Statuses that are still the shop's problem. */
const OPEN_STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PACKING',
  'READY_FOR_PICKUP',
];

export function DashboardView() {
  const profile = useVendorQuery<VendorProfile>('/vendor/profile');
  const today = useVendorQuery<Paged<VendorOrder>>(
    '/vendor/orders',
    { window: 'today', limit: 100 },
    { refreshMs: ORDER_POLL_MS },
  );
  const earnings = useVendorQuery<EarningsSummary>('/vendor/earnings', { range: 'day' });
  const week = useVendorQuery<SalesReport>('/vendor/reports/sales', { range: 'week' });
  const lowStock = useVendorQuery<Paged<InventoryRow>>('/vendor/inventory', {
    lowStock: 'true',
    limit: 50,
  });

  const alerts = useVendorAlerts();
  const freshness = useFreshness(today.marker, ORDER_POLL_MS * 2.5);

  /* ---- today's shape ---- */
  const orders = useMemo(() => today.data?.data ?? [], [today.data]);

  const byStatus = useMemo(() => {
    const counts = new Map<OrderStatus, number>();
    for (const order of orders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
    return counts;
  }, [orders]);

  const statusRows: ChartRow[] = useMemo(
    () =>
      [...byStatus.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => ({ status, count })),
    [byStatus],
  );

  const openCount = orders.filter((order) => OPEN_STATUSES.includes(order.status)).length;
  const deliveredToday = byStatus.get('DELIVERED') ?? 0;

  /* ---- the 7-day trend, as paise ---- */
  const spark = useMemo(
    () => (week.data?.points ?? []).map((point) => point.revenue),
    [week.data],
  );

  const salesRows: ChartRow[] = useMemo(
    () =>
      (week.data?.points ?? []).map((point) => ({
        day: formatDate(point.bucket, 'day'),
        revenue: point.revenue,
      })),
    [week.data],
  );

  const lowRows = lowStock.data?.data ?? [];
  const outOfStock = lowRows.filter((row) => row.stock <= 0).length;

  const fixturePaths = [
    profile.isFixture ? '/vendor/profile' : null,
    today.isFixture ? '/vendor/orders' : null,
    earnings.isFixture ? '/vendor/earnings' : null,
    week.isFixture ? '/vendor/reports/sales' : null,
    lowStock.isFixture ? '/vendor/inventory' : null,
  ].filter((value): value is string => value !== null);

  const loading = today.loading && !today.hasLoadedOnce;

  return (
    <AdminPage
      title={profile.data?.storeName ?? 'Your store'}
      description="Today, in the order it matters. Everything here links to the screen that fixes it."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={<FreshLine freshness={freshness} everyMs={ORDER_POLL_MS} onRefresh={today.refetch} />}
    >
      {/* ---------------------------------------- needs action ---- */}
      <AdminSection
        title="Needs you now"
        description="Ordered by what it costs to ignore, not by category."
      >
        <div className="ven-needs">
          <NeedCard
            href="/vendor/orders"
            tone={alerts.pendingCount > 0 ? 'crit' : 'good'}
            count={alerts.pendingCount}
            label={alerts.pendingCount === 1 ? 'order to accept' : 'orders to accept'}
            detail={
              alerts.pendingCount > 0
                ? 'A customer is watching a spinner right now.'
                : 'Everything that came in has been answered.'
            }
          />
          <NeedCard
            href="/vendor/orders"
            tone={openCount > 0 ? 'warn' : 'good'}
            count={openCount}
            label="in progress"
            detail="Accepted, packing or waiting for a rider."
          />
          <NeedCard
            href="/vendor/inventory?lowStock=true"
            tone={outOfStock > 0 ? 'crit' : lowRows.length > 0 ? 'warn' : 'good'}
            count={lowRows.length}
            label={lowRows.length === 1 ? 'product low' : 'products low'}
            detail={
              outOfStock > 0
                ? `${outOfStock} already at zero — those are lost sales, not warnings.`
                : 'Nothing has hit its threshold.'
            }
          />
          <NeedCard
            href="/vendor/settings"
            tone={profile.data?.isOpen ? 'good' : 'crit'}
            count={null}
            label={profile.data?.isOpen ? 'Store is open' : 'Store is closed'}
            detail={
              profile.data?.isOpen
                ? 'Customers can order from you.'
                : 'Nobody can place an order while this is off.'
            }
          />
        </div>
      </AdminSection>

      {/* ------------------------------------------------ KPIs ---- */}
      <AdminSection>
        <div className="adm-grid adm-grid--3">
          <KpiTile
            label="Revenue today"
            value={earnings.data?.grossSales ?? 0}
            unit="paise"
            spark={spark}
            tone="good"
            index={0}
            loading={earnings.loading && !earnings.hasLoadedOnce}
            isFixture={earnings.isFixture}
          />
          <KpiTile
            label="Orders today"
            value={orders.length}
            tone="neutral"
            index={1}
            loading={loading}
            isFixture={today.isFixture}
          />
          <KpiTile
            label="Delivered today"
            value={deliveredToday}
            tone="good"
            index={2}
            loading={loading}
            isFixture={today.isFixture}
          />
          <KpiTile
            label="Waiting for you"
            value={alerts.pendingCount}
            tone={alerts.pendingCount > 0 ? 'crit' : 'neutral'}
            index={3}
            loading={alerts.loading}
            isFixture={alerts.isFixture}
          />
          <KpiTile
            label="Low or out of stock"
            value={lowRows.length}
            tone={lowRows.length > 0 ? 'warn' : 'neutral'}
            index={4}
            loading={lowStock.loading && !lowStock.hasLoadedOnce}
            isFixture={lowStock.isFixture}
          />
          {/*
            Rating is the one tile that is NOT a <KpiTile>. That component
            formats a plain number as a count, and a 4.6 rendered as "5" is a
            lie that would take a year to notice. One decimal or nothing.
          */}
          <article className="adm-tile" data-fixture={profile.isFixture ? 'true' : undefined}>
            <p className="adm-tile__label">Store rating</p>
            <p className="adm-tile__value">
              <span className="adm-num">{(profile.data?.rating ?? 0).toFixed(1)}</span>
              <span className="adm-tile__unit">★</span>
            </p>
            <div className="adm-tile__foot">
              <span className="adm-delta__label">
                {profile.data
                  ? `from ${profile.data.ratingCount.toLocaleString('en-IN')} ratings`
                  : 'no ratings yet'}
              </span>
            </div>
          </article>
        </div>
      </AdminSection>

      {/* ---------------------------------------------- charts ---- */}
      <div className="adm-grid adm-grid--split">
        <AdminSection
          title="Last 7 days"
          description="Revenue per day, in rupees. The shape matters more than any single bar."
          panel
        >
          <div className="adm-panel--pad">
            {week.loading && !week.hasLoadedOnce ? (
              <div className="adm-skel adm-skel--chart" />
            ) : (
              <BarChart
                data={salesRows}
                xKey="day"
                series={[{ key: 'revenue', label: 'Revenue' }]}
                formatValue={formatPaiseCompact}
                label="Daily revenue for the last seven days"
              />
            )}
          </div>
        </AdminSection>

        <AdminSection
          title="Today by status"
          description="Where today's orders currently sit."
          panel
        >
          <div className="adm-panel--pad">
            {loading ? (
              <div className="adm-skel adm-skel--chart" />
            ) : statusRows.length === 0 ? (
              <EmptyState
                title="No orders yet today"
                body="They will appear here as they come in."
                icon={<IconInbox />}
              />
            ) : (
              <BarChart
                data={statusRows}
                xKey="status"
                series={[{ key: 'count', label: 'Orders' }]}
                horizontal
                label="Today's orders grouped by status"
              />
            )}
          </div>
        </AdminSection>
      </div>

      {/* ---------------------------------------------- recent ---- */}
      <AdminSection
        title="Latest orders"
        description="The six most recent, whatever state they are in."
      >
        <div className="adm-panel">
          {orders.slice(0, 6).map((order, index) => (
            <Link
              className="adm-feed__item"
              key={order.id}
              href={`/vendor/orders/${order.id}`}
              style={{ ['--adm-i' as string]: String(index) }}
            >
              <span>
                <span className="adm-feed__no">{order.orderNo}</span>
                <span className="adm-feed__meta">
                  {' '}
                  · {order.customerName} · {order.itemCount} items
                </span>
                <br />
                <span className="adm-feed__meta">
                  <RelativeTime value={order.placedAt} live={false} />
                </span>
              </span>
              <span className="adm-row">
                <StatusPill status={order.status} kind="order" />
                <Money value={order.total} />
              </span>
            </Link>
          ))}
          {orders.length === 0 && !loading ? (
            <EmptyState
              title="Nothing today yet"
              body="Orders land here the moment a customer checks out."
              icon={<IconInbox />}
            />
          ) : null}
        </div>
      </AdminSection>
    </AdminPage>
  );
}

/* ================================================================== */
/* Need card                                                           */
/* ================================================================== */

function NeedCard({
  href,
  tone,
  count,
  label,
  detail,
}: {
  href: string;
  tone: 'crit' | 'warn' | 'good';
  count: number | null;
  label: string;
  detail: string;
}) {
  return (
    <Link className="ven-need" href={href} data-tone={tone}>
      {count === null ? null : <span className="ven-need__count">{count}</span>}
      <span className="ven-need__label">
        {label} <IconChevronRight style={{ width: 12, height: 12, verticalAlign: '-1px' }} />
      </span>
      <span className="ven-need__detail">{detail}</span>
    </Link>
  );
}
