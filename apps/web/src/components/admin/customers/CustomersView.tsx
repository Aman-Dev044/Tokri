'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  AdminPage,
  DataTable,
  FilterBar,
  KpiTile,
  Money,
  RelativeTime,
  StatusPill,
} from '@/components/admin';
import { useDebounced } from '@/hooks';
import { formatCount } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import {
  cleanParams,
  matchesSearch,
  pageCount,
  paginate,
  sortRows,
  useSourcedList,
  type SortState,
} from '../_shared-pages/useSourced';
import { CUSTOMERS_FIXTURE, type CustomerRow } from './fixtures';

const ENDPOINT = '/admin/customers';
const LIMIT = 10;

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Pending', value: 'pending' },
];

interface Filters {
  q: string;
  status: string;
}

const EMPTY_FILTERS: Filters = { q: '', status: '' };

/** Sort accessor, kept beside the columns so the two cannot drift apart. */
function sortValue(row: CustomerRow, key: string): string | number | null {
  switch (key) {
    case 'name':
      return row.name;
    case 'orders':
      return row.ordersCount;
    case 'spend':
      return row.totalSpendPaise;
    case 'lastOrder':
      return row.lastOrderAt === null ? null : Date.parse(row.lastOrderAt);
    case 'status':
      return row.status;
    default:
      return null;
  }
}

export function CustomersView() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>({ key: 'spend', dir: 'desc' });

  // The search box drives a network request, so it is debounced. The status
  // select is not — a click is already a deliberate, low-frequency action.
  const debouncedQ = useDebounced(filters.q, 300);

  const params = useMemo(
    () =>
      cleanParams({
        q: debouncedQ,
        status: filters.status,
        page,
        limit: LIMIT,
        sort: sort === null ? undefined : `${sort.dir === 'desc' ? '-' : ''}${sort.key}`,
      }),
    [debouncedQ, filters.status, page, sort],
  );

  const { rows, loading, isSample, refetch } = useSourcedList<CustomerRow>(
    ENDPOINT,
    params,
    CUSTOMERS_FIXTURE,
  );

  /*
   * Filtering and paging happen here as well as on the server. On the live path
   * this is a no-op the server has already done; on the fixture path it is the
   * only thing making the controls work. Doing it in both cases keeps one code
   * path instead of two that drift.
   */
  const filtered = useMemo(() => {
    const matched = rows.filter(
      (row) =>
        matchesSearch([row.name, row.phone, row.email ?? undefined, row.city], debouncedQ) &&
        (filters.status === '' || row.status === filters.status),
    );
    return sortRows(matched, sort, sortValue);
  }, [rows, debouncedQ, filters.status, sort]);

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);

  const kpis = useMemo(() => {
    const active = rows.filter((r) => r.status === 'active').length;
    const suspended = rows.filter((r) => r.status === 'suspended').length;
    const withOrders = rows.filter((r) => r.ordersCount > 0);
    const lifetime = withOrders.reduce((sum, r) => sum + r.totalSpendPaise, 0);
    return {
      total: rows.length,
      active,
      suspended,
      avgLifetimePaise:
        withOrders.length === 0 ? 0 : Math.round(lifetime / withOrders.length),
    };
  }, [rows]);

  return (
    <AdminPage
      title="Customers"
      description="Everyone who has ever placed an order, and everyone who signed up and has not."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Customers', href: '/admin/customers' },
      ]}
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Customers"
          value={kpis.total}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Active"
          value={kpis.active}
          tone="good"
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Suspended"
          value={kpis.suspended}
          tone={kpis.suspended > 0 ? 'warn' : 'neutral'}
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Avg lifetime value"
          value={kpis.avgLifetimePaise}
          unit="paise"
          loading={loading}
        />
      </div>

      <FilterBar
        filters={[
          { key: 'q', label: 'Search', type: 'search' },
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({ q: next.q ?? '', status: next.status ?? '' });
          setPage(1);
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      />

      <DataTable
        rowKey={(row: CustomerRow) => row.id}
        rows={visible}
        loading={loading}
        empty="No customer matches those filters."
        onRowClick={(row: CustomerRow) => router.push(`/admin/customers/${row.id}`)}
        page={page}
        pageCount={pageCount(filtered.length, LIMIT)}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        columns={[
          {
            key: 'name',
            header: 'Customer',
            sortable: true,
            render: (row: CustomerRow) => (
              <span className={styles.twoLine}>
                <span className={styles.strong}>{row.name}</span>
                <span className={styles.subtle}>{row.email ?? `${row.city} · no email`}</span>
              </span>
            ),
          },
          {
            key: 'phone',
            header: 'Phone',
            width: '12rem',
            render: (row: CustomerRow) => <span className={styles.mono}>{row.phone}</span>,
          },
          {
            key: 'orders',
            header: 'Orders',
            align: 'right',
            width: '6rem',
            sortable: true,
            render: (row: CustomerRow) => (
              <span className={styles.num}>{formatCount(row.ordersCount)}</span>
            ),
          },
          {
            key: 'spend',
            header: 'Total spend',
            align: 'right',
            width: '9rem',
            sortable: true,
            render: (row: CustomerRow) => <Money value={row.totalSpendPaise} />,
          },
          {
            key: 'lastOrder',
            header: 'Last order',
            width: '10rem',
            sortable: true,
            render: (row: CustomerRow) =>
              row.lastOrderAt === null ? (
                <span className={styles.muted}>never</span>
              ) : (
                <RelativeTime value={row.lastOrderAt} />
              ),
          },
          {
            key: 'status',
            header: 'Status',
            width: '8rem',
            sortable: true,
            render: (row: CustomerRow) => <StatusPill status={row.status} kind="user" />,
          },
        ]}
      />
    </AdminPage>
  );
}
