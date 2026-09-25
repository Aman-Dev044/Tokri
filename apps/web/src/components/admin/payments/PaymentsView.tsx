'use client';

import { useMemo, useState } from 'react';

import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  DataTable,
  DonutChart,
  FilterBar,
  KpiTile,
  Money,
  RelativeTime,
  StatusPill,
} from '@/components/admin';
import { useAdminMutation, useDebounced } from '@/hooks';
import { formatPaise, formatPct } from '@/lib/admin/format';

import { NEUTRAL_SERIES } from '../_shared-pages/aisles';
import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import {
  cleanParams,
  matchesSearch,
  pageCount,
  paginate,
  sortRows,
  useSourcedList,
  withinRange,
  type SortState,
} from '../_shared-pages/useSourced';
import { PAYMENTS_FIXTURE, type PaymentRow } from './fixtures';

const ENDPOINT = '/admin/payments';
const LIMIT = 12;

const METHOD_OPTIONS = [
  { label: 'All methods', value: '' },
  { label: 'Online', value: 'online' },
  { label: 'Cash on delivery', value: 'cod' },
];

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Paid', value: 'paid' },
  { label: 'Authorized', value: 'authorized' },
  { label: 'Pending', value: 'pending' },
  { label: 'Failed', value: 'failed' },
  { label: 'Refunded', value: 'refunded' },
  { label: 'Partially refunded', value: 'partially_refunded' },
];

interface Filters {
  q: string;
  method: string;
  status: string;
  /** <FilterBar>'s daterange occupies two keys: `range` and `rangeTo`. */
  range: string;
  rangeTo: string;
}

const EMPTY_FILTERS: Filters = { q: '', method: '', status: '', range: '', rangeTo: '' };

/** A refund is only meaningful once money has actually moved. */
function isRefundable(row: PaymentRow): boolean {
  if (row.status === 'refunded') return false;
  if (row.status !== 'paid' && row.status !== 'partially_refunded') return false;
  return row.amountPaise - row.refundedPaise > 0;
}

function sortValue(row: PaymentRow, key: string): string | number | null {
  switch (key) {
    case 'orderNo':
      return row.orderNo;
    case 'customer':
      return row.customerName;
    case 'method':
      return row.method;
    case 'status':
      return row.status;
    case 'amount':
      return row.amountPaise;
    case 'at':
      return Date.parse(row.at);
    default:
      return null;
  }
}

export function PaymentsView() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>({ key: 'at', dir: 'desc' });
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);

  const debouncedQ = useDebounced(filters.q, 300);

  const params = useMemo(
    () =>
      cleanParams({
        q: debouncedQ,
        method: filters.method,
        status: filters.status,
        from: filters.range,
        to: filters.rangeTo,
        page,
        limit: LIMIT,
      }),
    [debouncedQ, filters.method, filters.status, filters.range, filters.rangeTo, page],
  );

  const { rows, loading, isSample, refetch } = useSourcedList<PaymentRow>(
    ENDPOINT,
    params,
    PAYMENTS_FIXTURE,
  );

  const refund = useAdminMutation<{ amountPaise: number; reason: string }, PaymentRow>(
    refunding === null ? ENDPOINT : `${ENDPOINT}/${refunding.id}/refund`,
    'POST',
  );

  const filtered = useMemo(() => {
    const matched = rows.filter((row) => {
      if (
        !matchesSearch(
          [row.orderNo, row.customerName, row.vendorName, row.gatewayRef ?? undefined],
          debouncedQ,
        )
      ) {
        return false;
      }
      if (filters.method !== '' && row.method !== filters.method) return false;
      if (filters.status !== '' && row.status !== filters.status) return false;
      if (!withinRange(row.at, filters.range, filters.rangeTo)) return false;
      return true;
    });
    return sortRows(matched, sort, sortValue);
  }, [rows, debouncedQ, filters.method, filters.status, filters.range, filters.rangeTo, sort]);

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);

  const totals = useMemo(() => {
    let collected = 0;
    let codOutstanding = 0;
    let refunded = 0;
    let settled = 0;
    let succeeded = 0;
    let onlinePaise = 0;
    let codPaise = 0;

    for (const row of rows) {
      const paid = row.status === 'paid' || row.status === 'partially_refunded';
      if (paid) {
        collected += row.amountPaise;
        if (row.method === 'online') onlinePaise += row.amountPaise;
        else codPaise += row.amountPaise;
      }
      // COD that has not been collected yet is money the platform is carrying.
      if (row.method === 'cod' && row.status === 'pending') codOutstanding += row.amountPaise;
      refunded += row.refundedPaise;
      // Success rate is measured over attempts that reached a terminal answer.
      if (row.status === 'paid' || row.status === 'failed' || row.status === 'refunded') {
        settled += 1;
        if (row.status !== 'failed') succeeded += 1;
      }
    }

    return {
      collected,
      codOutstanding,
      refunded,
      successPct: settled === 0 ? 0 : (succeeded / settled) * 100,
      onlinePaise,
      codPaise,
    };
  }, [rows]);

  const maxRefundPaise =
    refunding === null ? 0 : refunding.amountPaise - refunding.refundedPaise;

  async function applyRefund() {
    if (refunding === null) return;
    await refund.mutate({
      amountPaise: maxRefundPaise,
      reason: 'Refunded from the admin console',
    });
    setRefunding(null);
    refetch();
  }

  return (
    <AdminPage
      title="Payments"
      description="Every transaction across every vendor — the gateway leg and the cash leg, in one ledger."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Payments', href: '/admin/payments' },
      ]}
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Total collected"
          value={totals.collected}
          unit="paise"
          tone="good"
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="COD outstanding"
          value={totals.codOutstanding}
          unit="paise"
          tone={totals.codOutstanding > 0 ? 'warn' : 'neutral'}
          deltaLabel="cash not yet handed in"
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Refunded"
          value={totals.refunded}
          unit="paise"
          tone={totals.refunded > 0 ? 'warn' : 'neutral'}
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Success rate"
          value={Math.round(totals.successPct)}
          unit="%"
          tone={totals.successPct >= 95 ? 'good' : 'warn'}
          deltaLabel={`${formatPct(totals.successPct)} of settled attempts`}
          loading={loading}
        />
      </div>

      <div className={`${styles.split} ${styles.split2}`}>
        <div>
          <FilterBar
            filters={[
              { key: 'q', label: 'Search', type: 'search' },
              { key: 'method', label: 'Method', type: 'select', options: METHOD_OPTIONS },
              { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
              { key: 'range', label: 'Date', type: 'daterange' },
            ]}
            values={filters}
            onChange={(next) => {
              setFilters({
                q: next.q ?? '',
                method: next.method ?? '',
                status: next.status ?? '',
                range: next.range ?? '',
                rangeTo: next.rangeTo ?? '',
              });
              setPage(1);
            }}
            onReset={() => {
              setFilters(EMPTY_FILTERS);
              setPage(1);
            }}
          />

          <DataTable
            rowKey={(row: PaymentRow) => row.id}
            rows={visible}
            loading={loading}
            empty="No transaction matches those filters."
            page={page}
            pageCount={pageCount(filtered.length, LIMIT)}
            onPageChange={setPage}
            sort={sort}
            onSortChange={setSort}
            columns={[
              {
                key: 'orderNo',
                header: 'Order',
                sortable: true,
                render: (row: PaymentRow) => (
                  <span className={styles.twoLine}>
                    <span className={styles.mono}>{row.orderNo}</span>
                    <span className={styles.subtle}>{row.vendorName}</span>
                  </span>
                ),
              },
              {
                key: 'customer',
                header: 'Customer',
                sortable: true,
                render: (row: PaymentRow) => (
                  <span className={styles.truncate}>{row.customerName}</span>
                ),
              },
              {
                key: 'method',
                header: 'Method',
                width: '7rem',
                sortable: true,
                render: (row: PaymentRow) => (
                  <span className={styles.tag}>{row.method === 'cod' ? 'COD' : 'Online'}</span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                width: '11rem',
                sortable: true,
                render: (row: PaymentRow) => (
                  <StatusPill status={row.status} kind="payment" />
                ),
              },
              {
                key: 'amount',
                header: 'Amount',
                align: 'right',
                width: '9rem',
                sortable: true,
                render: (row: PaymentRow) => (
                  <span className={styles.twoLine}>
                    <Money value={row.amountPaise} />
                    {row.refundedPaise > 0 ? (
                      <span className={`${styles.subtle} ${styles.warn}`}>
                        −<Money value={row.refundedPaise} /> refunded
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'gatewayRef',
                header: 'Gateway ref',
                width: '13rem',
                render: (row: PaymentRow) =>
                  row.gatewayRef === null ? (
                    <span className={styles.muted}>— no gateway leg</span>
                  ) : (
                    <span className={`${styles.mono} ${styles.truncate}`}>{row.gatewayRef}</span>
                  ),
              },
              {
                key: 'at',
                header: 'When',
                width: '9rem',
                sortable: true,
                render: (row: PaymentRow) => <RelativeTime value={row.at} />,
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                width: '6rem',
                render: (row: PaymentRow) =>
                  isRefundable(row) ? (
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSmall} ${styles.btnDanger}`}
                      onClick={() => setRefunding(row)}
                    >
                      Refund
                    </button>
                  ) : null,
              },
            ]}
          />
        </div>

        <AdminSection title="Collected by method">
          <div className={styles.panel}>
            <div className={styles.panelBody}>
              {/*
                A two-slice donut of *collected* money, not of attempt counts —
                the question an admin asks here is how much cash the riders are
                carrying, not how many taps happened. Neutral series colours:
                this is not a breakdown by aisle, so the aisle hues stay out.
              */}
              <DonutChart
                height={220}
                data={[
                  { label: 'Online', value: totals.onlinePaise, color: NEUTRAL_SERIES[0] },
                  { label: 'Cash on delivery', value: totals.codPaise, color: NEUTRAL_SERIES[2] },
                ]}
              />
              <dl className={styles.defList}>
                <dt className={styles.dt}>Online</dt>
                <dd className={styles.dd}>
                  <Money value={totals.onlinePaise} />
                </dd>
                <dt className={styles.dt}>Cash on delivery</dt>
                <dd className={styles.dd}>
                  <Money value={totals.codPaise} />
                </dd>
                <dt className={styles.dt}>COD share</dt>
                <dd className={`${styles.dd} ${styles.num}`}>
                  {formatPct(
                    totals.collected === 0 ? 0 : (totals.codPaise / totals.collected) * 100,
                  )}
                </dd>
              </dl>
            </div>
          </div>
        </AdminSection>
      </div>

      {/*
        The refund button is a UI convenience. The API decides whether this
        admin may refund, and the gateway decides whether the refund succeeds;
        neither trusts anything decided here.
      */}
      <ConfirmDialog
        open={refunding !== null}
        title="Refund this payment?"
        body={
          refunding === null
            ? ''
            : `This refunds the full remaining ${formatPaise(maxRefundPaise)} on ${
                refunding.orderNo
              } to ${refunding.customerName}. ${
                refunding.method === 'cod'
                  ? 'This order was paid in cash — the refund is recorded against the vendor ledger and must be settled out of band.'
                  : `Razorpay will be asked to reverse ${refunding.gatewayRef ?? 'the capture'}. Gateway refunds are not instant and cannot be cancelled once accepted.`
              }`
        }
        confirmLabel="Refund in full"
        destructive
        loading={refund.loading}
        onConfirm={() => {
          void applyRefund();
        }}
        onCancel={() => setRefunding(null)}
      />

      {refund.error === null || refund.error === undefined ? null : (
        <p className={styles.fieldError} role="alert">
          The refund was not accepted. No money moved.
        </p>
      )}
    </AdminPage>
  );
}
