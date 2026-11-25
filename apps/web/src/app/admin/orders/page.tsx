'use client';

/**
 * Orders — every order, across every vendor.
 *
 * ── "LIVE-ISH" ──────────────────────────────────────────────────────────────
 * The board polls every 20 seconds through `useAdminQuery`'s `refreshMs`, and
 * that polling pauses while the tab is hidden. It is deliberately NOT a socket:
 * the admin board is a cross-vendor firehose, and the socket contract (plan
 * §6.3) scopes rooms per order, per vendor and per user precisely so that no
 * client receives everything. A 20-second poll is the honest way to watch a
 * firehose without inventing a room that breaks the isolation model.
 *
 * The refresh keeps the current page and filters; rows re-stagger on change, so
 * a new arrival is visible without the table jumping under the cursor.
 */

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminQuery, useDebounced } from '@/hooks';
import { formatCount } from '@/lib/admin/format';
import type { OrderListRow, Paginated, VendorListRow } from '@/lib/admin/types';
import {
  AdminPage,
  AdminSection,
  DataTable,
  FilterBar,
  Money,
  RelativeTime,
  StatusPill,
  Toolbar,
  type Column,
  type FilterDef,
  type FilterValues,
  type SortState,
} from '@/components/admin';

const STATUS_OPTIONS = [
  { label: 'All statuses', value: 'all' },
  { label: 'Placed', value: 'PLACED' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Packing', value: 'PACKING' },
  { label: 'Ready for pickup', value: 'READY_FOR_PICKUP' },
  { label: 'Assigned', value: 'ASSIGNED' },
  { label: 'Picked up', value: 'PICKED_UP' },
  { label: 'Out for delivery', value: 'OUT_FOR_DELIVERY' },
  { label: 'Delivered', value: 'DELIVERED' },
  { label: 'Delivery failed', value: 'DELIVERY_FAILED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Cancelled', value: 'CANCELLED' },
];

/**
 * `useSearchParams` opts a route into client-side rendering, and Next refuses
 * to prerender a page that reads it without a Suspense boundary above. The
 * boundary is here rather than around a fragment of the page because there is
 * nothing meaningful to show before the filters are known — a board rendered
 * unfiltered and then re-filtered is worse than a board that arrives correct.
 */
export default function AdminOrdersPage() {
  return (
    <Suspense fallback={<OrdersFallback />}>
      <OrdersBoard />
    </Suspense>
  );
}

function OrdersFallback() {
  return (
    <div className="adm-stack" aria-busy="true">
      <span className="adm-skel adm-skel--line" style={{ width: 220, height: 24 }} />
      <span className="adm-skel adm-skel--chart" />
    </div>
  );
}

function OrdersBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep links from the Overview's attention panel land here with filters
  // already set — `?status=DELIVERY_FAILED` has to arrive as a filtered board,
  // not as an unfiltered one the operator then has to re-filter by hand.
  const [values, setValues] = useState<FilterValues>(() => ({
    q: '',
    status: searchParams.get('status') ?? 'all',
    vendorId: searchParams.get('vendorId') ?? 'all',
    placedAt: '',
    placedAtTo: '',
  }));

  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: 'placedAt', dir: 'desc' });

  const q = useDebounced(values.q ?? '', 300);

  const query = useAdminQuery<Paginated<OrderListRow>>(
    '/admin/orders',
    {
      q: q || undefined,
      status: values.status === 'all' ? undefined : values.status,
      vendorId: values.vendorId === 'all' ? undefined : values.vendorId,
      from: values.placedAt || undefined,
      to: values.placedAtTo || undefined,
      page,
      limit: 20,
      sort: `${sort.dir === 'desc' ? '-' : ''}${sort.key}`,
    },
    { refreshMs: 20_000 },
  );

  // The vendor filter sends `vendorId`, which the API validates as a Mongo
  // id — so the options must be real vendor ids, read from the vendor list
  // (100 is that endpoint's page cap). This used to be a hard-coded fixture
  // list whose ids 400'd the moment one was picked against the real API.
  const vendorList = useAdminQuery<Paginated<VendorListRow>>('/admin/vendors', {
    limit: 100,
    sort: 'storeName',
  });
  const vendorRows = vendorList.data?.data;

  const filters: FilterDef[] = useMemo(
    () => [
      // The API matches `q` against the order number only.
      { key: 'q', label: 'Search', type: 'search', placeholder: 'Order no…' },
      { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
      {
        key: 'vendorId',
        label: 'Vendor',
        type: 'select',
        options: [
          { label: 'All vendors', value: 'all' },
          ...(vendorRows ?? []).map((v) => ({ label: v.storeName, value: v.id })),
        ],
      },
      { key: 'placedAt', label: 'Placed between', type: 'daterange' },
    ],
    [vendorRows],
  );

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;

  const columns: Column<OrderListRow>[] = useMemo(
    () => [
      {
        key: 'orderNo',
        header: 'Order',
        sortable: true,
        render: (row) => (
          <Link className="adm-table__link adm-num" href={`/admin/orders/${row.id}`}>
            {row.orderNo}
            <span className="adm-table__sub">
              {row.itemCount} {row.itemCount === 1 ? 'item' : 'items'}
            </span>
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        sortable: true,
        render: (row) => <StatusPill status={row.status} kind="order" />,
      },
      {
        key: 'vendorName',
        header: 'Vendor',
        render: (row) => (
          <Link className="adm-table__link" href={`/admin/vendors/${row.vendorId}`}>
            {row.vendorName ?? 'Not resolved'}
          </Link>
        ),
      },
      {
        key: 'customerName',
        header: 'Customer',
        render: (row) => row.customerName ?? 'Not resolved',
      },
      {
        key: 'payment',
        header: 'Payment',
        render: (row) => (
          <span className="adm-row">
            <StatusPill status={row.payment.status} kind="payment" />
            <span className="adm-table__sub" style={{ display: 'inline' }}>
              {row.payment.method === 'cod' ? 'COD' : 'online'}
            </span>
          </span>
        ),
      },
      {
        key: 'pricing',
        header: 'Total',
        align: 'right',
        render: (row) => <Money value={row.pricing.grandTotal} />,
      },
      {
        key: 'placedAt',
        header: 'Placed',
        align: 'right',
        sortable: true,
        render: (row) => <RelativeTime value={row.placedAt} />,
      },
    ],
    [],
  );

  const applyFilters = (next: FilterValues) => {
    setValues(next);
    setPage(1);
  };

  return (
    <AdminPage
      title="Orders"
      description="Every order on the platform, newest first. Refreshes every 20 seconds while this tab is in front."
      isFixture={query.isFixture || vendorList.isFixture}
      fixturePaths={
        query.isFixture || vendorList.isFixture
          ? [
              ...(query.isFixture ? ['/admin/orders'] : []),
              ...(vendorList.isFixture ? ['/admin/vendors'] : []),
            ]
          : undefined
      }
      actions={
        <button type="button" className="adm-btn adm-btn--sm" onClick={query.refetch}>
          Refresh now
        </button>
      }
    >
      <FilterBar
        filters={filters}
        values={values}
        onChange={applyFilters}
        onReset={() =>
          applyFilters({ q: '', status: 'all', vendorId: 'all', placedAt: '', placedAtTo: '' })
        }
      />

      <Toolbar>
        <span style={{ color: 'var(--adm-dim)' }}>
          {meta ? `${formatCount(meta.total)} orders` : 'Loading…'}
        </span>
        <Toolbar.Spacer />
        {query.loading && query.hasLoadedOnce ? (
          <span style={{ color: 'var(--adm-dim)', fontSize: 'var(--adm-fs-sm)' }}>updating…</span>
        ) : null}
      </Toolbar>

      <AdminSection>
        <DataTable
          columns={columns}
          rows={rows}
          loading={query.loading && !query.hasLoadedOnce}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/admin/orders/${row.id}`)}
          sort={sort}
          onSortChange={setSort}
          page={meta?.page ?? page}
          pageCount={meta?.pages ?? 1}
          total={meta?.total}
          onPageChange={setPage}
        />
      </AdminSection>
    </AdminPage>
  );
}
