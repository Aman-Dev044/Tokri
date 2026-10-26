'use client';

/**
 * Vendors — the approval queue and the marketplace roster in one table.
 *
 * ── THE ONE INTERACTION THAT MATTERS ────────────────────────────────────────
 * Approving a vendor puts a shop in front of customers; suspending one takes it
 * away mid-trading. Both go through <ConfirmDialog>, and the dialog stays open
 * with its buttons disabled until the PATCH resolves — so a failure is visible
 * at the moment of the decision rather than as a toast the operator has already
 * scrolled past. See overlays.tsx for why that is not optimistic.
 *
 * Row actions are hidden for a plain ADMIN on nothing here — approving vendors
 * is ordinary admin work. Commission, which is money, is super-admin only and
 * lives on the detail page.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminMutation, useAdminQuery, useDebounced } from '@/hooks';
import { formatCount, formatPct } from '@/lib/admin/format';
import { toSortParam, VENDOR_SORT } from '@/lib/admin/sort';
import type { Paginated, VendorListRow, VendorStatus } from '@/lib/admin/types';
import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
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

const FILTERS: FilterDef[] = [
  { key: 'q', label: 'Search', type: 'search', placeholder: 'Store, owner or city…' },
  {
    key: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { label: 'All statuses', value: 'all' },
      { label: 'Pending approval', value: 'pending' },
      { label: 'Approved', value: 'approved' },
      { label: 'Suspended', value: 'suspended' },
    ],
  },
];

const EMPTY: FilterValues = { q: '', status: 'all' };

type PendingAction = {
  vendor: VendorListRow;
  next: Extract<VendorStatus, 'approved' | 'suspended'>;
};

export default function AdminVendorsPage() {
  const router = useRouter();

  const [values, setValues] = useState<FilterValues>(EMPTY);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState>({ key: 'gmv', dir: 'desc' });
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Required by `UpdateVendorStatusDto` when suspending; unused for approval.
  const [reason, setReason] = useState('');

  // The input stays instant; only the value that reaches the API waits.
  const q = useDebounced(values.q ?? '', 300);

  const query = useAdminQuery<Paginated<VendorListRow>>('/admin/vendors', {
    q: q || undefined,
    status: values.status === 'all' ? undefined : values.status,
    page,
    limit: 20,
    sort: toSortParam(sort, VENDOR_SORT),
  });

  const statusMutation = useAdminMutation<{ status: VendorStatus; reason?: string }, VendorListRow>(
    '/admin/vendors/:id/status',
    'PATCH',
  );

  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;

  const columns: Column<VendorListRow>[] = useMemo(
    () => [
      {
        key: 'storeName',
        header: 'Store',
        sortable: true,
        render: (row) => (
          <Link className="adm-table__link" href={`/admin/vendors/${row.id}`}>
            {row.storeName}
            {/* The list row carries no owner — that join is the detail
                page's. City and pincode are what an operator scans for. */}
            <span className="adm-table__sub">
              {row.address.city} · {row.address.pincode}
            </span>
          </Link>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <span className="adm-row">
            <StatusPill status={row.status} kind="vendor" />
            {row.status === 'approved' ? (
              <span className="adm-table__sub" style={{ display: 'inline' }}>
                {row.isOpen ? 'open' : 'closed'}
              </span>
            ) : null}
          </span>
        ),
      },
      {
        key: 'commissionPct',
        header: 'Commission',
        align: 'right',
        sortable: true,
        render: (row) => <span className="adm-num">{formatPct(row.commissionPct)}</span>,
      },
      {
        key: 'orderCount',
        header: 'Orders',
        align: 'right',
        sortable: true,
        render: (row) => <span className="adm-num">{formatCount(row.orderCount)}</span>,
      },
      {
        key: 'gmv',
        header: 'GMV',
        align: 'right',
        sortable: true,
        render: (row) => <Money value={row.gmv} />,
      },
      {
        key: 'rating',
        header: 'Rating',
        align: 'right',
        sortable: true,
        render: (row) =>
          // 0 is the schema default, not a score: an unrated store reads as
          // a dash, never "0.0".
          row.rating === 0 ? (
            <span style={{ color: 'var(--adm-dim)' }}>—</span>
          ) : (
            <span className="adm-num">{row.rating.toFixed(1)}</span>
          ),
      },
      {
        key: 'createdAt',
        header: 'Joined',
        align: 'right',
        sortable: true,
        render: (row) =>
          row.createdAt ? (
            <RelativeTime value={row.createdAt} live={false} />
          ) : (
            <span style={{ color: 'var(--adm-dim)' }}>—</span>
          ),
      },
      {
        key: 'actions',
        header: '',
        align: 'right',
        render: (row) => (
          <span
            className="adm-row"
            style={{ justifyContent: 'flex-end' }}
            /* The row itself navigates; the buttons must not. */
            onClick={(event) => event.stopPropagation()}
          >
            {row.status !== 'approved' ? (
              <button
                type="button"
                className="adm-btn adm-btn--sm"
                onClick={() => setPending({ vendor: row, next: 'approved' })}
              >
                Approve
              </button>
            ) : null}
            {row.status !== 'suspended' ? (
              <button
                type="button"
                className="adm-btn adm-btn--sm adm-btn--danger"
                onClick={() => setPending({ vendor: row, next: 'suspended' })}
              >
                Suspend
              </button>
            ) : null}
          </span>
        ),
      },
    ],
    [],
  );

  const applyFilters = (next: FilterValues) => {
    setValues(next);
    // Page 3 of the old filter is meaningless under the new one.
    setPage(1);
  };

  const closeDialog = () => {
    setPending(null);
    setReason('');
  };

  const confirmAction = async () => {
    if (!pending) return;
    await statusMutation.mutate(
      pending.next === 'suspended'
        ? { status: pending.next, reason: reason.trim() }
        : { status: pending.next },
      {
        params: { id: pending.vendor.id },
        invalidate: ['/admin/vendors', '/admin/analytics'],
        onSuccess: closeDialog,
      },
    );
  };

  return (
    <AdminPage
      title="Vendors"
      description="Every shop on the marketplace. Approve new ones, suspend ones that are causing harm, and see what each is actually selling."
      isFixture={query.isFixture}
      fixturePaths={query.isFixture ? ['/admin/vendors'] : undefined}
      actions={
        <button
          type="button"
          className="adm-btn adm-btn--sm"
          onClick={() => applyFilters({ ...EMPTY, status: 'pending' })}
        >
          Show the approval queue
        </button>
      }
    >
      <FilterBar filters={FILTERS} values={values} onChange={applyFilters} onReset={() => applyFilters(EMPTY)} />

      <Toolbar>
        <span style={{ color: 'var(--adm-dim)' }}>
          {meta ? `${formatCount(meta.total)} vendors` : 'Loading…'}
        </span>
        <Toolbar.Spacer />
        {statusMutation.error ? (
          <span className="adm-pill" data-tone="crit">
            <span className="adm-pill__glyph" aria-hidden="true" />
            {statusMutation.error.friendlyMessage}
          </span>
        ) : null}
      </Toolbar>

      <AdminSection>
        <DataTable
          columns={columns}
          rows={rows}
          loading={query.loading && !query.hasLoadedOnce}
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/admin/vendors/${row.id}`)}
          sort={sort}
          onSortChange={setSort}
          page={meta?.page ?? page}
          pageCount={meta?.pages ?? 1}
          total={meta?.total}
          onPageChange={setPage}
        />
      </AdminSection>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.next === 'approved' ? 'Approve this vendor?' : 'Suspend this vendor?'}
        destructive={pending?.next === 'suspended'}
        confirmLabel={pending?.next === 'approved' ? 'Approve' : 'Suspend'}
        loading={statusMutation.loading}
        // The API 400s a suspension with no reason; this only says so first.
        confirmDisabled={pending?.next === 'suspended' && reason.trim().length < 3}
        onCancel={closeDialog}
        onConfirm={() => void confirmAction()}
        body={
          pending?.next === 'approved' ? (
            <>
              <strong>{pending.vendor.storeName}</strong> becomes visible to customers in{' '}
              {pending.vendor.address.city} and can start accepting orders immediately.
            </>
          ) : (
            <>
              <p>
                <strong>{pending?.vendor.storeName}</strong> disappears from search and can no
                longer accept orders. Orders already in flight are <em>not</em> cancelled — they
                still have to be fulfilled or refunded.
              </p>
              <label className="adm-field">
                <span className="adm-field__label">Reason</span>
                <input
                  className="adm-input"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  placeholder="Stored on the vendor and in the audit log"
                  disabled={statusMutation.loading}
                />
              </label>
            </>
          )
        }
      />
    </AdminPage>
  );
}
