'use client';

/**
 * ★ EARNINGS — and the arithmetic, printed.
 *
 * A vendor opens this screen with one question: where did my money go. Three
 * tiles that happen to be related do not answer it. An equation does:
 *
 *     gross  −  commission  −  refunds  =  what you receive
 *
 * So that is literally what the top of the page is — the terms left to right,
 * the operators visible, every figure in the mono face so the digits line up
 * under each other and the subtraction can be checked by eye. If the numbers do
 * not add up on screen, the reader can see that they do not, which is the whole
 * point of showing the working.
 *
 * ── COMMISSION IS A SNAPSHOT ────────────────────────────────────────────────
 * The rate is copied onto each order when it is placed (plan §5.1) — an admin
 * changing the platform rate today does not retroactively re-price last week.
 * The page says so out loud, because "my commission changed and so did my old
 * orders" is a support ticket that writes itself otherwise.
 *
 * ── PAISE ───────────────────────────────────────────────────────────────────
 * Every figure here arrives as integer paise and is handed to `<Money/>`
 * untouched. Nothing on this page divides by 100.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AdminPage,
  AdminSection,
  BarChart,
  DataTable,
  EmptyState,
  IconInbox,
  KpiTile,
  LineChart,
  Money,
  RelativeTime,
  StatusPill,
  type ChartRow,
  type Column,
} from '@/components/admin';
import { useVendorQuery } from '@/hooks';
import { formatDate, formatPaise, formatPaiseCompact } from '@/lib/admin/format';
import type {
  EarningsRange,
  EarningsSummary,
  LedgerEntryRow,
  SalesReport,
  SettlementRow,
} from '@/lib/vendor/types';
import { Segmented } from '../primitives';

const RANGE_OPTIONS = [
  { value: 'day' as const, label: 'Today' },
  { value: 'week' as const, label: '7 days' },
  { value: 'month' as const, label: '30 days' },
];

const RANGE_WORD: Record<EarningsRange, string> = {
  day: 'today',
  week: 'over the last 7 days',
  month: 'over the last 30 days',
};

export function EarningsView() {
  const [range, setRange] = useState<EarningsRange>('week');

  const earnings = useVendorQuery<EarningsSummary>('/vendor/earnings', { range });
  const sales = useVendorQuery<SalesReport>('/vendor/reports/sales', { range });

  const data = earnings.data;

  const salesRows: ChartRow[] = useMemo(
    () =>
      (sales.data?.points ?? []).map((point) => ({
        bucket: range === 'day' ? formatDate(point.bucket, 'time') : formatDate(point.bucket, 'day'),
        revenue: point.revenue,
        orders: point.orders,
      })),
    [sales.data, range],
  );

  const topRows: ChartRow[] = useMemo(
    () =>
      (data?.topProducts ?? []).map((product) => ({
        name: product.name,
        revenue: product.revenue,
      })),
    [data],
  );

  const fixturePaths = [
    earnings.isFixture ? '/vendor/earnings' : null,
    sales.isFixture ? '/vendor/reports/sales' : null,
  ].filter((value): value is string => value !== null);

  /**
   * The reconciliation check, run in the browser.
   *
   * If the API's own `netEarnings` does not equal gross − commission − refunds,
   * something is wrong on the server and the vendor deserves to be told rather
   * than shown a figure that quietly disagrees with the subtraction printed
   * above it.
   */
  const reconciles =
    data === null ||
    data.netEarnings === data.grossSales - data.totalCommission - data.refunds;

  const loading = earnings.loading && !earnings.hasLoadedOnce;

  return (
    <AdminPage
      title="Earnings"
      description="What you sold, what Mandi took, and what lands in your account."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={
        <Segmented label="Period" value={range} options={RANGE_OPTIONS} onChange={setRange} />
      }
    >
      {/* ------------------------------------------- equation ---- */}
      <AdminSection>
        {loading ? (
          <div className="adm-skel adm-skel--tile" />
        ) : data === null ? (
          <EmptyState
            title="No earnings data"
            body="Nothing has been recorded for this period."
            icon={<IconInbox />}
          />
        ) : (
          <>
            <div className="ven-eq">
              <div className="ven-eq__term">
                <span className="ven-eq__label">Gross sales</span>
                <span className="ven-eq__value">{formatPaise(data.grossSales)}</span>
                <span className="ven-eq__note">
                  {data.orderCount} delivered {data.orderCount === 1 ? 'order' : 'orders'}{' '}
                  {RANGE_WORD[range]}
                </span>
              </div>

              <span className="ven-eq__op" aria-hidden="true">
                −
              </span>

              <div className="ven-eq__term" data-role="minus">
                <span className="ven-eq__label">Mandi commission</span>
                <span className="ven-eq__value">{formatPaise(data.totalCommission)}</span>
                <span className="ven-eq__note">
                  {data.commissionPct}% — fixed on each order when it was placed
                </span>
              </div>

              <span className="ven-eq__op" aria-hidden="true">
                −
              </span>

              <div className="ven-eq__term" data-role="minus">
                <span className="ven-eq__label">Refunds</span>
                <span className="ven-eq__value">{formatPaise(data.refunds)}</span>
                <span className="ven-eq__note">Cancellations and short orders</span>
              </div>

              <span className="ven-eq__op" aria-hidden="true">
                =
              </span>

              <div className="ven-eq__term" data-role="net">
                <span className="ven-eq__label">You receive</span>
                <span className="ven-eq__value">{formatPaise(data.netEarnings)}</span>
                <span className="ven-eq__note">
                  <Money value={data.paidOut} /> already paid ·{' '}
                  <Money value={data.pendingPayout} /> pending
                </span>
              </div>
            </div>

            {!reconciles ? (
              <p className="ven-field__error" role="alert" style={{ marginTop: 'var(--s-2)' }}>
                These figures do not reconcile: gross − commission − refunds comes to{' '}
                {formatPaise(data.grossSales - data.totalCommission - data.refunds)}, but the
                server reports {formatPaise(data.netEarnings)}. Do not act on this screen — report
                it.
              </p>
            ) : null}
          </>
        )}
      </AdminSection>

      {/* ----------------------------------------------- KPIs ---- */}
      <AdminSection>
        <div className="adm-grid adm-grid--3">
          <KpiTile
            label="Gross sales"
            value={data?.grossSales ?? 0}
            unit="paise"
            tone="good"
            index={0}
            loading={loading}
            isFixture={earnings.isFixture}
          />
          <KpiTile
            label="Average order"
            value={data?.averageOrderValue ?? 0}
            unit="paise"
            index={1}
            loading={loading}
            isFixture={earnings.isFixture}
          />
          <KpiTile
            label="Orders"
            value={data?.orderCount ?? 0}
            index={2}
            loading={loading}
            isFixture={earnings.isFixture}
          />
          <KpiTile
            label="Commission taken"
            value={data?.totalCommission ?? 0}
            unit="paise"
            tone="warn"
            index={3}
            loading={loading}
            isFixture={earnings.isFixture}
          />
          <KpiTile
            label="Awaiting payout"
            value={data?.pendingPayout ?? 0}
            unit="paise"
            tone="neutral"
            index={4}
            loading={loading}
            isFixture={earnings.isFixture}
          />
          <KpiTile
            label="Refunded"
            value={data?.refunds ?? 0}
            unit="paise"
            tone="crit"
            invertDelta
            index={5}
            loading={loading}
            isFixture={earnings.isFixture}
          />
        </div>
      </AdminSection>

      {/* --------------------------------------------- charts ---- */}
      <div className="adm-grid adm-grid--split">
        <AdminSection
          title="Sales"
          description={`Revenue ${RANGE_WORD[range]}.`}
          panel
        >
          <div className="adm-panel--pad">
            {sales.loading && !sales.hasLoadedOnce ? (
              <div className="adm-skel adm-skel--chart" />
            ) : (
              <LineChart
                data={salesRows}
                xKey="bucket"
                series={[{ key: 'revenue', label: 'Revenue' }]}
                formatValue={formatPaiseCompact}
                area
                label={`Revenue ${RANGE_WORD[range]}`}
              />
            )}
          </div>
        </AdminSection>

        <AdminSection title="Top products" description="By revenue, not by units." panel>
          <div className="adm-panel--pad">
            {loading ? (
              <div className="adm-skel adm-skel--chart" />
            ) : topRows.length === 0 ? (
              <EmptyState title="Nothing sold yet" icon={<IconInbox />} />
            ) : (
              <BarChart
                data={topRows}
                xKey="name"
                series={[{ key: 'revenue', label: 'Revenue' }]}
                horizontal
                formatValue={formatPaiseCompact}
                label="Top products by revenue"
              />
            )}
          </div>
        </AdminSection>
      </div>

      {/* --------------------------------------------- ledger ---- */}
      <AdminSection
        title="Ledger"
        description="Every entry the server wrote. A commission is a negative amount against the sale it came from — the two lines belong to the same order."
      >
        <LedgerTable rows={data?.ledger ?? []} loading={loading} />
      </AdminSection>

      <AdminSection
        title="Settlements"
        description="A settlement is a window closed off and paid. Until it says paid, the money is still with Mandi."
      >
        <SettlementTable rows={data?.settlements ?? []} loading={loading} />
      </AdminSection>
    </AdminPage>
  );
}

/* ================================================================== */
/* Tables                                                              */
/* ================================================================== */

function LedgerTable({ rows, loading }: { rows: LedgerEntryRow[]; loading: boolean }) {
  const columns: Column<LedgerEntryRow>[] = [
    {
      key: 'createdAt',
      header: 'When',
      render: (row) => <RelativeTime value={row.createdAt} live={false} />,
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <span className="adm-pill" data-tone={toneForLedger(row.type)}>
          <span className="adm-pill__glyph" aria-hidden="true" />
          {row.type}
        </span>
      ),
    },
    {
      key: 'orderNo',
      header: 'Order',
      numeric: true,
      render: (row) =>
        row.orderId && row.orderNo ? (
          <Link href={`/vendor/orders/${row.orderId}`}>{row.orderNo}</Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={row.amount} />,
    },
    {
      key: 'settlementId',
      header: 'Settled in',
      numeric: true,
      render: (row) => row.settlementId ?? 'not yet',
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(row) => row.id}
      skeletonRows={6}
      empty={
        <EmptyState
          title="No ledger entries"
          body="Sales, commissions, refunds and payouts all land here."
          icon={<IconInbox />}
        />
      }
    />
  );
}

function toneForLedger(type: LedgerEntryRow['type']): string {
  switch (type) {
    case 'sale':
      return 'good';
    case 'commission':
      return 'warn';
    case 'refund':
      return 'crit';
    case 'payout':
      return 'info';
    default:
      return 'neutral';
  }
}

function SettlementTable({ rows, loading }: { rows: SettlementRow[]; loading: boolean }) {
  const columns: Column<SettlementRow>[] = [
    {
      key: 'period',
      header: 'Period',
      render: (row) => (
        <span className="adm-num">
          {formatDate(row.periodStart, 'day')} → {formatDate(row.periodEnd, 'day')}
        </span>
      ),
    },
    {
      key: 'grossSales',
      header: 'Gross',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={row.grossSales} />,
    },
    {
      key: 'totalCommission',
      header: 'Commission',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={-row.totalCommission} />,
    },
    {
      key: 'refunds',
      header: 'Refunds',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={-row.refunds} />,
    },
    {
      key: 'netPayable',
      header: 'Net payable',
      align: 'right',
      numeric: true,
      render: (row) => (
        <strong>
          <Money value={row.netPayable} />
        </strong>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <StatusPill status={row.status} kind="settlement" />,
    },
    {
      key: 'reference',
      header: 'Reference',
      numeric: true,
      render: (row) => row.reference ?? '—',
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(row) => row.id}
      skeletonRows={4}
      empty={
        <EmptyState
          title="No settlements yet"
          body="The first one closes at the end of the current cycle."
          icon={<IconInbox />}
        />
      }
    />
  );
}
