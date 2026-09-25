'use client';

/**
 * The morning screen.
 *
 * A shop owner opens this once, reads it in about four seconds, and then lives
 * in the orders board for the rest of the day. So it answers exactly five
 * questions and stops: how much have I taken today, how many orders, is anyone
 * waiting on me, what is about to run out, and what do customers think of me.
 *
 * ── ONE CALL, NOT FIVE ──────────────────────────────────────────────────────
 * `GET /vendor/dashboard` already computes every one of those: the status
 * breakdown, today's revenue split into gross/commission/net, the pending and
 * in-flight counts, the low and out-of-stock counts, the rating, and a 7-day
 * sparkline. This screen used to assemble the same picture from four separate
 * queries — one of which asked for `?window=today`, a parameter that has never
 * existed and is a hard 400 under `forbidNonWhitelisted`.
 *
 * The orders list is still fetched, but only for the "latest orders" feed at
 * the bottom, and with parameters the DTO actually accepts.
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
import { todayWindow } from '@/lib/vendor/range';
import type {
  OrderStatus,
  Paged,
  VendorDashboard,
  VendorOrder,
} from '@/lib/vendor/types';
import { ORDER_POLL_MS, useVendorAlerts } from '../VendorAlertProvider';
import { EndpointError, FreshLine } from '../primitives';

export function DashboardView() {
  // `from`/`to` for the local day, computed here. The API has no `window`
  // parameter and never had one.
  const today = useMemo(() => todayWindow(), []);

  const dashboard = useVendorQuery<VendorDashboard>('/vendor/dashboard', undefined, {
    refreshMs: ORDER_POLL_MS,
  });

  const recent = useVendorQuery<Paged<VendorOrder>>(
    '/vendor/orders',
    { from: today.from, to: today.to, limit: 6, sort: '-placedAt' },
    { refreshMs: ORDER_POLL_MS },
  );

  const alerts = useVendorAlerts();
  const freshness = useFreshness(dashboard.marker, ORDER_POLL_MS * 2.5);

  const data = dashboard.data;

  /* ---- today's shape, straight from the server ---- */
  const statusRows: ChartRow[] = useMemo(() => {
    const byStatus = data?.ordersToday.byStatus;
    if (!byStatus) return [];
    return (Object.entries(byStatus) as Array<[OrderStatus, number]>)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count }));
  }, [data]);

  const spark = useMemo(
    () => (data?.sparkline ?? []).map((point) => point.revenue),
    [data],
  );

  const salesRows: ChartRow[] = useMemo(
    () =>
      (data?.sparkline ?? []).map((point) => ({
        day: formatDate(point.date, 'day'),
        revenue: point.revenue,
      })),
    [data],
  );

  const orders = recent.data?.data ?? [];

  const fixturePaths = [
    dashboard.isFixture ? '/vendor/dashboard' : null,
    recent.isFixture ? '/vendor/orders' : null,
  ].filter((value): value is string => value !== null);

  const loading = dashboard.loading && !dashboard.hasLoadedOnce;

  /* ---- a failed dashboard is an error state, never a blank page ---- */
  if (dashboard.error && data === null) {
    return (
      <AdminPage title="Your store" description="Today’s numbers could not be loaded.">
        <EndpointError
          path="/vendor/dashboard"
          message={dashboard.error.friendlyMessage}
          status={dashboard.error.status}
          onRetry={dashboard.refetch}
        />
      </AdminPage>
    );
  }

  const lowOrOut = (data?.lowStockCount ?? 0) + (data?.outOfStockCount ?? 0);
  const outOfStock = data?.outOfStockCount ?? 0;

  return (
    <AdminPage
      title={data?.storeName ?? 'Your store'}
      description="Today, in the order it matters. Everything here links to the screen that fixes it."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={
        <FreshLine freshness={freshness} everyMs={ORDER_POLL_MS} onRefresh={dashboard.refetch} />
      }
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
            tone={(data?.inFlightCount ?? 0) > 0 ? 'warn' : 'good'}
            count={data?.inFlightCount ?? 0}
            label="in progress"
            detail="Accepted, packing or waiting for a rider."
          />
          <NeedCard
            href="/vendor/inventory?lowStock=true"
            tone={outOfStock > 0 ? 'crit' : lowOrOut > 0 ? 'warn' : 'good'}
            count={lowOrOut}
            label={lowOrOut === 1 ? 'product low' : 'products low'}
            detail={
              outOfStock > 0
                ? `${outOfStock} already at zero — those are lost sales, not warnings.`
                : 'Nothing has hit its threshold.'
            }
          />
          <NeedCard
            href="/vendor/settings"
            tone={data?.isOpen ? 'good' : 'crit'}
            count={null}
            label={data?.isOpen ? 'Store is open' : 'Store is closed'}
            detail={
              data?.isOpen
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
            value={data?.revenueToday.gross ?? 0}
            unit="paise"
            spark={spark}
            tone="good"
            index={0}
            loading={loading}
            isFixture={dashboard.isFixture}
          />
          <KpiTile
            label="Orders today"
            value={data?.ordersToday.total ?? 0}
            tone="neutral"
            index={1}
            loading={loading}
            isFixture={dashboard.isFixture}
          />
          <KpiTile
            label="Delivered today"
            value={data?.ordersToday.byStatus.DELIVERED ?? 0}
            tone="good"
            index={2}
            loading={loading}
            isFixture={dashboard.isFixture}
          />
          <KpiTile
            label="Waiting for you"
            value={data?.pendingCount ?? 0}
            tone={(data?.pendingCount ?? 0) > 0 ? 'crit' : 'neutral'}
            index={3}
            loading={loading}
            isFixture={dashboard.isFixture}
          />
          <KpiTile
            label="Low or out of stock"
            value={lowOrOut}
            tone={lowOrOut > 0 ? 'warn' : 'neutral'}
            index={4}
            loading={loading}
            isFixture={dashboard.isFixture}
          />
          {/*
            Rating is the one tile that is NOT a <KpiTile>. That component
            formats a plain number as a count, and a 4.6 rendered as "5" is a
            lie that would take a year to notice. One decimal or nothing.

            The API sends `rating` and NOTHING ELSE about ratings — there is no
            `ratingCount`. Reading one is what used to crash this page, so the
            footnote below says what the number is, not how many votes made it.
          */}
          <article className="adm-tile" data-fixture={dashboard.isFixture ? 'true' : undefined}>
            <p className="adm-tile__label">Store rating</p>
            <p className="adm-tile__value">
              <span className="adm-num">{(data?.rating ?? 0).toFixed(1)}</span>
              <span className="adm-tile__unit">★</span>
            </p>
            <div className="adm-tile__foot">
              <span className="adm-delta__label">
                {data === null
                  ? 'not loaded yet'
                  : data.rating > 0
                    ? 'average across your delivered orders'
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
            {loading ? (
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
        description="The six most recent today, whatever state they are in."
      >
        <div className="adm-panel">
          {recent.error && recent.data === null ? (
            <EndpointError
              path="/vendor/orders"
              message={recent.error.friendlyMessage}
              status={recent.error.status}
              onRetry={recent.refetch}
            />
          ) : (
            orders.map((order, index) => (
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
                    · {order.customer.name ?? 'Customer'} · {order.itemCount} items
                  </span>
                  <br />
                  <span className="adm-feed__meta">
                    {order.placedAt === null ? (
                      'time unknown'
                    ) : (
                      <RelativeTime value={order.placedAt} live={false} />
                    )}
                  </span>
                </span>
                <span className="adm-row">
                  <StatusPill status={order.status} kind="order" />
                  <Money value={order.grandTotal} />
                </span>
              </Link>
            ))
          )}
          {orders.length === 0 && !recent.loading && recent.error === null ? (
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
