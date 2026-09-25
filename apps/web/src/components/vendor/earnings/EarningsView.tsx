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
 * point of showing the working. It sits inside a hero bento cell: this and the
 * dashboard are the two bento surfaces in the panel.
 *
 * ── FOUR ENDPOINTS, NOT ONE ─────────────────────────────────────────────────
 * This page used to expect a single fat `/vendor/earnings` payload carrying the
 * summary, the ledger, the settlements and the top products. It does not
 * exist. The API splits them, and rightly: the ledger and the settlements are
 * paginated lists that grow without bound, and welding them onto a summary
 * would make the one number a vendor opens this screen for wait on a thousand
 * ledger rows.
 *
 *     GET /vendor/earnings?from&to            → the summary
 *     GET /vendor/earnings/ledger?from&to     → paginated LedgerRow
 *     GET /vendor/settlements                 → paginated SettlementRow
 *     GET /vendor/reports/sales?from&to&groupBy
 *     GET /vendor/reports/top-products?from&to&limit
 *
 * ── THE PERIOD SWITCHER IS CLIENT-SIDE ──────────────────────────────────────
 * There is no `?range=day`. Every windowed endpoint takes `from` and `to` as
 * ISO instants, so "Today / 7 days / 30 days" is arithmetic this page does —
 * see `lib/vendor/range.ts`.
 *
 * ── COMMISSION IS A SNAPSHOT ────────────────────────────────────────────────
 * The rate is copied onto each order when it is placed — an admin changing the
 * platform rate today does not retroactively re-price last week. The page says
 * so out loud, because "my commission changed and so did my old orders" is a
 * support ticket that writes itself otherwise. The API sends no single
 * `commissionPct` on this payload — there isn't one, because different orders
 * in the same window can carry different rates. The EFFECTIVE rate is derived
 * and labelled as such.
 *
 * ── PAISE ───────────────────────────────────────────────────────────────────
 * Every figure here arrives as integer paise and is handed to `<Money/>`
 * untouched. Nothing on this page divides by 100.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BentoCard, BentoGrid, BentoHead } from '@mandi/design-system';
import { useVendorQuery } from '@/hooks';
import {
  PERIOD_OPTIONS,
  PERIOD_WORD,
  groupByFor,
  windowFor,
  type PeriodKey,
} from '@/lib/vendor/range';
import type {
  EarningsSummary,
  LedgerEntryRow,
  Paged,
  SalesReport,
  SettlementRow,
  TopProductsReport,
} from '@/lib/vendor/types';
import { AreaChart, RankedBars, type BarDatum } from '../charts';
import { formatCount, formatDate, formatPaise, formatPaiseCompact } from '../format';
import { IconInbox } from '../icons';
import { VenPage, VenSection } from '../Page';
import {
  EmptyState,
  EndpointError,
  KpiCell,
  Money,
  Pill,
  Segmented,
  SettlementStatusPill,
  SkelChart,
  SkelStat,
} from '../primitives';
import { type Column, VenTable } from '../table';

const LEDGER_LIMIT = 25;
const SETTLEMENT_LIMIT = 10;
const TOP_PRODUCTS_LIMIT = 8;

export function EarningsView() {
  const [period, setPeriod] = useState<PeriodKey>('week');

  // Recomputed only when the period changes, so a re-render does not move the
  // window by a few milliseconds and refire every query on the page.
  const range = useMemo(() => windowFor(period), [period]);
  const groupBy = groupByFor(period);

  const earnings = useVendorQuery<EarningsSummary>('/vendor/earnings', {
    from: range.from,
    to: range.to,
  });
  const sales = useVendorQuery<SalesReport>('/vendor/reports/sales', {
    from: range.from,
    to: range.to,
    groupBy,
  });
  const top = useVendorQuery<TopProductsReport>('/vendor/reports/top-products', {
    from: range.from,
    to: range.to,
    limit: TOP_PRODUCTS_LIMIT,
  });
  const ledger = useVendorQuery<Paged<LedgerEntryRow>>('/vendor/earnings/ledger', {
    from: range.from,
    to: range.to,
    limit: LEDGER_LIMIT,
  });
  // Settlements are NOT windowed by the period switcher: a payout for work done
  // last month is still the payout a vendor is waiting on today, and hiding it
  // behind a "7 days" filter is how "where is my money" becomes a phone call.
  const settlements = useVendorQuery<Paged<SettlementRow>>('/vendor/settlements', {
    limit: SETTLEMENT_LIMIT,
  });

  const data = earnings.data;

  const salesRows: BarDatum[] = useMemo(
    () =>
      (sales.data?.buckets ?? []).map((bucket) => ({
        label: formatDate(bucket.periodStart, 'day'),
        value: bucket.gross,
        fullLabel: formatDate(bucket.periodStart, 'long'),
      })),
    [sales.data],
  );

  const topRows: BarDatum[] = useMemo(
    () =>
      (top.data?.products ?? []).map((product) => ({
        label: product.name,
        value: product.revenue,
      })),
    [top.data],
  );

  const fixturePaths = [
    earnings.isFixture ? '/vendor/earnings' : null,
    sales.isFixture ? '/vendor/reports/sales' : null,
    top.isFixture ? '/vendor/reports/top-products' : null,
    ledger.isFixture ? '/vendor/earnings/ledger' : null,
    settlements.isFixture ? '/vendor/settlements' : null,
  ].filter((value): value is string => value !== null);

  /**
   * The reconciliation check, run in the browser.
   *
   * If the API's own `net` does not equal gross − commission − refunds,
   * something is wrong on the server and the vendor deserves to be told rather
   * than shown a figure that quietly disagrees with the subtraction printed
   * above it.
   */
  const reconciles =
    data === null || data.net === data.gross - data.commission - data.refunds;

  /**
   * The EFFECTIVE commission rate, derived — not a field.
   *
   * There is no `commissionPct` on this payload and there should not be: each
   * order carries its own snapshot rate, so a window spanning a rate change has
   * no single percentage. This is the blended rate actually charged, and the
   * caption says so.
   */
  const effectivePct =
    data === null || data.gross === 0 ? null : (data.commission / data.gross) * 100;

  /** Average order value. A division the page does, because the API does not. */
  const averageOrderValue =
    data === null || data.orderCount === 0 ? 0 : Math.round(data.gross / data.orderCount);

  const loading = earnings.loading && !earnings.hasLoadedOnce;

  return (
    <VenPage
      title="Earnings"
      description="What you sold, what Mandi took, and what lands in your account."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={
        <Segmented label="Period" value={period} options={PERIOD_OPTIONS} onChange={setPeriod} />
      }
    >
      {/* ------------------------------------------- equation ---- */}
      <BentoGrid dense>
        <BentoCard span="hero" index={0}>
          {loading ? (
            <SkelStat />
          ) : earnings.error && data === null ? (
            <EndpointError
              path="/vendor/earnings"
              message={earnings.error.friendlyMessage}
              status={earnings.error.status}
              onRetry={earnings.refetch}
            />
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
                  <span className="ven-eq__value">{formatPaise(data.gross)}</span>
                  <span className="ven-eq__note">
                    {data.orderCount} delivered {data.orderCount === 1 ? 'order' : 'orders'}{' '}
                    {PERIOD_WORD[period]}
                  </span>
                </div>

                <span className="ven-eq__op" aria-hidden="true">
                  −
                </span>

                <div className="ven-eq__term" data-role="minus">
                  <span className="ven-eq__label">Mandi commission</span>
                  <span className="ven-eq__value">{formatPaise(data.commission)}</span>
                  <span className="ven-eq__note">
                    {effectivePct === null
                      ? 'fixed on each order when it was placed'
                      : `${effectivePct.toFixed(1)}% effective — each order keeps the rate it was placed at`}
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
                  <span className="ven-eq__value">{formatPaise(data.net)}</span>
                  <span className="ven-eq__note">
                    <Money value={data.payoutPending} /> still to be paid out
                    {data.lastSettlement === null
                      ? ' · nothing settled yet'
                      : ` · last settlement ${data.lastSettlement.status}`}
                  </span>
                </div>
              </div>

              {!reconciles ? (
                <p className="ven-field__error" role="alert" style={{ marginTop: 'var(--s-3)' }}>
                  These figures do not reconcile: gross − commission − refunds comes to{' '}
                  {formatPaise(data.gross - data.commission - data.refunds)}, but the server
                  reports {formatPaise(data.net)}. Do not act on this screen — report it.
                </p>
              ) : null}
            </>
          )}
        </BentoCard>
      </BentoGrid>

      {/* ----------------------------------------------- KPIs ---- */}
      <BentoGrid dense>
        <KpiCell
          label="Gross sales"
          value={data?.gross ?? 0}
          format={formatPaiseCompact}
          tone="good"
          index={0}
          loading={loading}
        />
        <KpiCell
          label="Average order"
          value={averageOrderValue}
          format={formatPaiseCompact}
          index={1}
          loading={loading}
        />
        <KpiCell
          label="Orders"
          value={data?.orderCount ?? 0}
          format={formatCount}
          index={2}
          loading={loading}
        />
        <KpiCell
          label="Commission taken"
          value={data?.commission ?? 0}
          format={formatPaiseCompact}
          tone="warn"
          index={3}
          loading={loading}
        />
        <KpiCell
          label="Awaiting payout"
          value={data?.payoutPending ?? 0}
          format={formatPaiseCompact}
          index={4}
          loading={loading}
        />
        <KpiCell
          label="Refunded"
          value={data?.refunds ?? 0}
          format={formatPaiseCompact}
          tone="crit"
          index={5}
          loading={loading}
        />
      </BentoGrid>

      {/* --------------------------------------------- charts ---- */}
      <BentoGrid dense>
        <BentoCard span="half" index={0}>
          <BentoHead title="Sales" eyebrow={`Revenue ${PERIOD_WORD[period]}, by day`} />
          {sales.loading && !sales.hasLoadedOnce ? (
            <SkelChart />
          ) : sales.error && sales.data === null ? (
            <EndpointError
              path="/vendor/reports/sales"
              message={sales.error.friendlyMessage}
              status={sales.error.status}
              onRetry={sales.refetch}
            />
          ) : salesRows.length === 0 ? (
            <EmptyState
              title="Nothing delivered in this window"
              body="Revenue is counted on delivery, not on placement."
              icon={<IconInbox />}
              tight
            />
          ) : (
            <AreaChart
              data={salesRows}
              format={formatPaiseCompact}
              label={`Revenue ${PERIOD_WORD[period]}`}
            />
          )}
        </BentoCard>

        <BentoCard span="half" index={1}>
          <BentoHead title="Top products" eyebrow="By revenue, not by units" />
          {top.loading && !top.hasLoadedOnce ? (
            <SkelChart />
          ) : top.error && top.data === null ? (
            <EndpointError
              path="/vendor/reports/top-products"
              message={top.error.friendlyMessage}
              status={top.error.status}
              onRetry={top.refetch}
            />
          ) : topRows.length === 0 ? (
            <EmptyState title="Nothing sold yet" icon={<IconInbox />} tight />
          ) : (
            <RankedBars data={topRows} format={formatPaiseCompact} label="Top products by revenue" />
          )}
        </BentoCard>
      </BentoGrid>

      {/* --------------------------------------------- ledger ---- */}
      <VenSection
        title="Ledger"
        description="Every entry the server wrote. A commission is a negative amount against the sale it came from — the two lines belong to the same order."
      >
        {ledger.error && ledger.data === null ? (
          <EndpointError
            path="/vendor/earnings/ledger"
            message={ledger.error.friendlyMessage}
            status={ledger.error.status}
            onRetry={ledger.refetch}
          />
        ) : (
          <LedgerTable
            rows={ledger.data?.data ?? []}
            loading={ledger.loading && !ledger.hasLoadedOnce}
          />
        )}
      </VenSection>

      <VenSection
        title="Settlements"
        description="A settlement is a window closed off and paid. Until it says paid, the money is still with Mandi. Shown in full, whatever period is selected above."
      >
        {settlements.error && settlements.data === null ? (
          <EndpointError
            path="/vendor/settlements"
            message={settlements.error.friendlyMessage}
            status={settlements.error.status}
            onRetry={settlements.refetch}
          />
        ) : (
          <SettlementTable
            rows={settlements.data?.data ?? []}
            loading={settlements.loading && !settlements.hasLoadedOnce}
          />
        )}
      </VenSection>
    </VenPage>
  );
}

/* ================================================================== */
/* Tables                                                              */
/* ================================================================== */

function LedgerTable({ rows, loading }: { rows: LedgerEntryRow[]; loading: boolean }) {
  const columns: Column<LedgerEntryRow>[] = [
    {
      key: 'at',
      header: 'When',
      render: (row) => (row.at === null ? '—' : formatDate(row.at, 'short')),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => <Pill tone={toneForLedger(row.type)}>{row.type}</Pill>,
    },
    {
      key: 'orderId',
      header: 'Order',
      numeric: true,
      // The ledger carries the order ID, not its number — linking by id is
      // truthful; printing a number the API never sent would not be.
      render: (row) =>
        row.orderId ? <Link href={`/vendor/orders/${row.orderId}`}>Open order</Link> : '—',
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={row.amount} />,
    },
    {
      key: 'note',
      header: 'Note',
      render: (row) => row.note ?? '—',
    },
    {
      key: 'settlementId',
      header: 'Settled in',
      numeric: true,
      render: (row) => row.settlementId ?? 'not yet',
    },
  ];

  return (
    <VenTable
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

function toneForLedger(type: LedgerEntryRow['type']): 'good' | 'warn' | 'crit' | 'info' | 'neutral' {
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
        <span className="ven-num">
          {row.periodStart === null ? '—' : formatDate(row.periodStart, 'day')} →{' '}
          {row.periodEnd === null ? '—' : formatDate(row.periodEnd, 'day')}
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
      render: (row) => (
        <span title={row.failureReason ?? undefined}>
          <SettlementStatusPill status={row.status} />
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      numeric: true,
      render: (row) => row.reference ?? '—',
    },
  ];

  return (
    <VenTable
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
