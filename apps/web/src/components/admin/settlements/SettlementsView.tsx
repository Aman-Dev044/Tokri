'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  AdminPage,
  ConfirmDialog,
  DataTable,
  FilterBar,
  KpiTile,
  Money,
  StatusPill,
} from '@/components/admin';
import { useAdminMutation, useDebounced } from '@/hooks';
import { formatDate } from '@/lib/admin/format';

import { useAdminRole } from '../_shared-pages/role';
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
import { SETTLEMENTS_FIXTURE, type SettlementRow } from './fixtures';

const ENDPOINT = '/admin/settlements';
const LIMIT = 12;

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Processing', value: 'processing' },
  { label: 'Paid', value: 'paid' },
  { label: 'Failed', value: 'failed' },
];

interface Filters {
  q: string;
  status: string;
  /** <FilterBar>'s daterange occupies two keys: `range` and `rangeTo`. */
  range: string;
  rangeTo: string;
}

const EMPTY_FILTERS: Filters = { q: '', status: '', range: '', rangeTo: '' };

function sortValue(row: SettlementRow, key: string): string | number | null {
  switch (key) {
    case 'vendor':
      return row.vendorName;
    case 'period':
      return Date.parse(row.periodStart);
    case 'gross':
      return row.grossSalesPaise;
    case 'commission':
      return row.totalCommissionPaise;
    case 'refunds':
      return row.refundsPaise;
    case 'net':
      return row.netPayablePaise;
    case 'status':
      return row.status;
    default:
      return null;
  }
}

/** True when the row's own arithmetic holds. Surfaced per row, not hidden. */
function reconciles(row: SettlementRow): boolean {
  return row.grossSalesPaise - row.totalCommissionPaise - row.refundsPaise === row.netPayablePaise;
}

export function SettlementsView() {
  const router = useRouter();
  const { isSuperAdmin } = useAdminRole();

  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>({ key: 'period', dir: 'desc' });
  const [generating, setGenerating] = useState(false);
  const [paying, setPaying] = useState<SettlementRow | null>(null);

  const debouncedQ = useDebounced(filters.q, 300);

  const params = useMemo(
    () =>
      cleanParams({
        q: debouncedQ,
        status: filters.status,
        from: filters.range,
        to: filters.rangeTo,
        page,
        limit: LIMIT,
      }),
    [debouncedQ, filters.status, filters.range, filters.rangeTo, page],
  );

  const { rows, loading, isSample, refetch } = useSourcedList<SettlementRow>(
    ENDPOINT,
    params,
    SETTLEMENTS_FIXTURE,
  );

  const generate = useAdminMutation<{ periodEnd: string }, { created: number }>(
    `${ENDPOINT}/generate`,
    'POST',
  );
  const markPaid = useAdminMutation<{ reference: string }, SettlementRow>(
    paying === null ? ENDPOINT : `${ENDPOINT}/${paying.id}/pay`,
    'POST',
  );

  const filtered = useMemo(() => {
    const matched = rows.filter((row) => {
      if (!matchesSearch([row.vendorName, row.reference ?? undefined], debouncedQ)) return false;
      if (filters.status !== '' && row.status !== filters.status) return false;
      // The window filters on the period START, which is how a payout run is
      // identified — not on when it happened to be paid.
      if (!withinRange(row.periodStart, filters.range, filters.rangeTo)) return false;
      return true;
    });
    return sortRows(matched, sort, sortValue);
  }, [rows, debouncedQ, filters.status, filters.range, filters.rangeTo, sort]);

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);

  const totals = useMemo(() => {
    let gross = 0;
    let commission = 0;
    let refunds = 0;
    let outstanding = 0;
    let broken = 0;
    for (const row of rows) {
      gross += row.grossSalesPaise;
      commission += row.totalCommissionPaise;
      refunds += row.refundsPaise;
      if (row.status !== 'paid') outstanding += row.netPayablePaise;
      if (!reconciles(row)) broken += 1;
    }
    return { gross, commission, refunds, outstanding, broken };
  }, [rows]);

  async function runGenerate() {
    await generate.mutate({ periodEnd: new Date().toISOString() });
    setGenerating(false);
    refetch();
  }

  async function runMarkPaid() {
    if (paying === null) return;
    await markPaid.mutate({ reference: paying.reference ?? '' });
    setPaying(null);
    refetch();
  }

  return (
    <AdminPage
      title="Settlements"
      description="What each vendor is owed for a period, and the arithmetic that gets there."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Settlements', href: '/admin/settlements' },
      ]}
      actions={
        /*
          Generating a settlement run creates money movements, so it is a
          SUPER_ADMIN action. Hiding it from a plain admin is UX only — the
          API's RolesGuard is what actually refuses the request.
        */
        isSuperAdmin ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setGenerating(true)}
            disabled={generate.loading}
          >
            Generate settlements
          </button>
        ) : null
      }
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Gross sales"
          value={totals.gross}
          unit="paise"
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Commission earned"
          value={totals.commission}
          unit="paise"
          tone="good"
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Refunds"
          value={totals.refunds}
          unit="paise"
          tone={totals.refunds > 0 ? 'warn' : 'neutral'}
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Outstanding payable"
          value={totals.outstanding}
          unit="paise"
          tone={totals.outstanding > 0 ? 'warn' : 'good'}
          deltaLabel="not yet paid out"
          loading={loading}
        />
      </div>

      {totals.broken > 0 ? (
        <p className={`${styles.readOnlyNote} ${styles.crit}`} role="alert">
          {totals.broken} settlement{totals.broken === 1 ? '' : 's'} below do not reconcile —
          gross minus commission minus refunds does not equal the stored net payable. Open the row
          to see the ledger before paying anything out.
        </p>
      ) : null}

      <FilterBar
        filters={[
          { key: 'q', label: 'Search', type: 'search' },
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
          { key: 'range', label: 'Period', type: 'daterange' },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({
            q: next.q ?? '',
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
        rowKey={(row: SettlementRow) => row.id}
        rows={visible}
        loading={loading}
        empty="No settlement for that period."
        onRowClick={(row: SettlementRow) => router.push(`/admin/settlements/${row.id}`)}
        page={page}
        pageCount={pageCount(filtered.length, LIMIT)}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        columns={[
          {
            key: 'vendor',
            header: 'Vendor',
            sortable: true,
            render: (row: SettlementRow) => (
              <span className={styles.twoLine}>
                <span className={styles.strong}>{row.vendorName}</span>
                <span className={styles.subtle}>
                  {row.orderCount} orders · {row.commissionPct}% commission
                </span>
              </span>
            ),
          },
          {
            key: 'period',
            header: 'Period',
            width: '12rem',
            sortable: true,
            render: (row: SettlementRow) => (
              <span className={styles.mono}>
                {formatDate(row.periodStart, 'day')} – {formatDate(row.periodEnd, 'day')}
              </span>
            ),
          },
          {
            key: 'gross',
            header: 'Gross',
            align: 'right',
            width: '9rem',
            sortable: true,
            render: (row: SettlementRow) => <Money value={row.grossSalesPaise} />,
          },
          {
            key: 'commission',
            header: '− Commission',
            align: 'right',
            width: '9rem',
            sortable: true,
            render: (row: SettlementRow) => (
              <span className={styles.muted}>
                <Money value={row.totalCommissionPaise} />
              </span>
            ),
          },
          {
            key: 'refunds',
            header: '− Refunds',
            align: 'right',
            width: '9rem',
            sortable: true,
            render: (row: SettlementRow) =>
              row.refundsPaise === 0 ? (
                <span className={styles.muted}>—</span>
              ) : (
                <span className={styles.warn}>
                  <Money value={row.refundsPaise} />
                </span>
              ),
          },
          {
            key: 'net',
            header: '= Net payable',
            align: 'right',
            width: '10rem',
            sortable: true,
            render: (row: SettlementRow) => (
              <span className={styles.twoLine}>
                <span className={styles.strong}>
                  <Money value={row.netPayablePaise} />
                </span>
                {reconciles(row) ? null : (
                  <span className={`${styles.subtle} ${styles.crit}`}>does not reconcile</span>
                )}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            width: '9rem',
            sortable: true,
            render: (row: SettlementRow) => (
              <StatusPill status={row.status} kind="settlement" />
            ),
          },
          {
            key: 'actions',
            header: '',
            align: 'right',
            width: '7rem',
            render: (row: SettlementRow) =>
              isSuperAdmin && row.status !== 'paid' ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSmall}`}
                  onClick={() => setPaying(row)}
                >
                  Mark paid
                </button>
              ) : null,
          },
        ]}
      />

      <ConfirmDialog
        open={generating}
        title="Generate settlements for the closed period?"
        body="Every vendor with unsettled ledger entries gets one settlement row for the period. Existing rows are not touched, and nothing is paid out — this only computes what is owed."
        confirmLabel="Generate"
        loading={generate.loading}
        onConfirm={() => {
          void runGenerate();
        }}
        onCancel={() => setGenerating(false)}
      />

      <ConfirmDialog
        open={paying !== null}
        title="Mark this settlement as paid?"
        body={
          paying === null
            ? ''
            : `This records that ${paying.vendorName} has been paid their net payable for ${formatDate(
                paying.periodStart,
                'day',
              )} – ${formatDate(
                paying.periodEnd,
                'day',
              )}. It does not move any money — the bank transfer must already have happened. Marking it wrongly makes the vendor ledger disagree with the bank.`
        }
        confirmLabel="Mark paid"
        destructive
        loading={markPaid.loading}
        onConfirm={() => {
          void runMarkPaid();
        }}
        onCancel={() => setPaying(null)}
      />
    </AdminPage>
  );
}
