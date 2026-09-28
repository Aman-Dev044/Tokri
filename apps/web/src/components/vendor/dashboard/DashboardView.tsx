'use client';

/**
 * The morning screen — a KPI-tile surface, alongside earnings.
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
import { useFreshness, useVendorQuery } from '@/hooks';
import { todayWindow } from '@/lib/vendor/range';
import type { OrderStatus, Paged, VendorDashboard, VendorOrder } from '@/lib/vendor/types';
import { BarChart, RankedBars, type BarDatum } from '../charts';
import { formatCount, formatDate, formatPaiseCompact, humanise } from '../format';
import { IconChevronRight, IconInbox } from '../icons';
import { VenPage, VenSection } from '../Page';
import {
  ChartPanel,
  EmptyState,
  EndpointError,
  FreshLine,
  KpiCell,
  Money,
  OrderStatusPill,
  RelativeTime,
  SkelChart,
  SkelStat,
} from '../primitives';
import { ORDER_POLL_MS, useVendorAlerts } from '../VendorAlertProvider';

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
  const statusRows: BarDatum[] = useMemo(() => {
    const byStatus = data?.ordersToday.byStatus;
    if (!byStatus) return [];
    return (Object.entries(byStatus) as Array<[OrderStatus, number]>)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ label: humanise(status), value: count }));
  }, [data]);

  const spark = useMemo(() => (data?.sparkline ?? []).map((point) => point.revenue), [data]);

  const salesRows: BarDatum[] = useMemo(
    () =>
      (data?.sparkline ?? []).map((point) => ({
        label: formatDate(point.date, 'day'),
        value: point.revenue,
        fullLabel: formatDate(point.date, 'long'),
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
      <VenPage title="Your store" description="Today’s numbers could not be loaded.">
        <EndpointError
          path="/vendor/dashboard"
          message={dashboard.error.friendlyMessage}
          status={dashboard.error.status}
          onRetry={dashboard.refetch}
        />
      </VenPage>
    );
  }

  const lowOrOut = (data?.lowStockCount ?? 0) + (data?.outOfStockCount ?? 0);
  const outOfStock = data?.outOfStockCount ?? 0;
  const rating = data?.rating ?? 0;

  return (
    <VenPage
      title={data?.storeName ?? 'Your store'}
      description="Today, in the order it matters. Everything here links to the screen that fixes it."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={
        <FreshLine freshness={freshness} everyMs={ORDER_POLL_MS} onRefresh={dashboard.refetch} />
      }
    >
      {/* ---------------------------------------- needs action ---- */}
      <VenSection
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
      </VenSection>

      {/* ------------------------------------------------ KPIs ---- */}
      <VenSection>
        {loading ? (
          <div className="ven-needs">
            <SkelStat index={0} />
            <SkelStat index={1} />
            <SkelStat index={2} />
            <SkelStat index={3} />
            <SkelStat index={4} />
            <SkelStat index={5} />
          </div>
        ) : (
          <div className="ven-kpigrid">
            <KpiCell
              label="Revenue today"
              value={data?.revenueToday.gross ?? 0}
              format={formatPaiseCompact}
              spark={spark}
              tone="good"
              index={0}
            />
            <KpiCell
              label="Orders today"
              value={data?.ordersToday.total ?? 0}
              format={formatCount}
              tone="plain"
              index={1}
            />
            <KpiCell
              label="Delivered today"
              value={data?.ordersToday.byStatus.DELIVERED ?? 0}
              format={formatCount}
              tone="good"
              index={2}
            />
            <KpiCell
              label="Waiting for you"
              value={data?.pendingCount ?? 0}
              format={formatCount}
              tone={(data?.pendingCount ?? 0) > 0 ? 'crit' : 'plain'}
              index={3}
            />
            <KpiCell
              label="Low or out of stock"
              value={lowOrOut}
              format={formatCount}
              tone={lowOrOut > 0 ? 'warn' : 'plain'}
              index={4}
            />
            {/*
              Rating is deliberately not driven off a plain count formatter — a
              4.6 rendered as "5" is a lie that would take a year to notice.
              The API sends `rating` and NOTHING ELSE about ratings — there is
              no `ratingCount`, so the note says what the number is rather than
              how many votes made it.
            */}
            <KpiCell
              label="Store rating"
              value={Math.round(rating * 10)}
              format={(tenths) => `${(tenths / 10).toFixed(1)} ★`}
              tone="plain"
              index={5}
              note={
                data === null
                  ? 'not loaded yet'
                  : rating > 0
                    ? 'average across your delivered orders'
                    : 'no ratings yet'
              }
            />
          </div>
        )}
      </VenSection>

      {/* ---------------------------------------------- charts ---- */}
      <div className="ven-chartgrid">
        <ChartPanel title="Last 7 days" eyebrow="Revenue">
          <p className="ven-dim">Revenue per day, in rupees. The shape matters more than any single bar.</p>
          {loading ? (
            <SkelChart />
          ) : (
            <BarChart
              data={salesRows}
              format={formatPaiseCompact}
              label="Daily revenue for the last seven days"
              tone="pop-2"
            />
          )}
        </ChartPanel>

        <ChartPanel title="Today by status" eyebrow="Breakdown">
          <p className="ven-dim">Where today&rsquo;s orders currently sit.</p>
          {loading ? (
            <SkelChart />
          ) : statusRows.length === 0 ? (
            <EmptyState
              title="No orders yet today"
              body="They will appear here as they come in."
              icon={<IconInbox />}
              tight
            />
          ) : (
            <RankedBars data={statusRows} format={formatCount} label="Today's orders grouped by status" />
          )}
        </ChartPanel>
      </div>

      {/* ---------------------------------------------- recent ---- */}
      <VenSection
        title="Latest orders"
        description="The six most recent today, whatever state they are in."
      >
        <div className="ven-panel">
          {recent.error && recent.data === null ? (
            <div className="ven-panel--pad">
              <EndpointError
                path="/vendor/orders"
                message={recent.error.friendlyMessage}
                status={recent.error.status}
                onRetry={recent.refetch}
              />
            </div>
          ) : (
            <div className="ven-feed">
              {orders.map((order, index) => (
                <Link
                  className="ven-feed__item"
                  key={order.id}
                  href={`/vendor/orders/${order.id}`}
                  style={{ ['--i' as string]: index }}
                >
                  <span>
                    <span className="ven-feed__no">{order.orderNo}</span>
                    <span className="ven-feed__meta">
                      {' '}
                      · {order.customer.name ?? 'Customer'} · {order.itemCount} items
                    </span>
                    <br />
                    <span className="ven-feed__meta">
                      {order.placedAt === null ? (
                        'time unknown'
                      ) : (
                        <RelativeTime value={order.placedAt} live={false} />
                      )}
                    </span>
                  </span>
                  <span className="ven-row">
                    <OrderStatusPill status={order.status} />
                    <Money value={order.grandTotal} />
                  </span>
                </Link>
              ))}
            </div>
          )}
          {orders.length === 0 && !recent.loading && recent.error === null ? (
            <EmptyState
              title="Nothing today yet"
              body="Orders land here the moment a customer checks out."
              icon={<IconInbox />}
            />
          ) : null}
        </div>
      </VenSection>
    </VenPage>
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
