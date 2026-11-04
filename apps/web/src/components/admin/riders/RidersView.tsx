'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  AdminPage,
  DataTable,
  FilterBar,
  KpiTile,
  RelativeTime,
  StatusPill,
} from '@/components/admin';
import { useAdminQuery, useDebounced } from '@/hooks';
import { formatCount, formatPct } from '@/lib/admin/format';
import { RIDER_SORT, toSortParam } from '@/lib/admin/sort';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import {
  cleanParams,
  matchesSearch,
  pageCount,
  paginate,
  sortRows,
  useSourcedList,
  type ListEnvelope,
  type QueryParams,
  type SortState,
} from '../_shared-pages/useSourced';
import { Presence } from './Presence';
import { RIDERS_FIXTURE, vehicleLabel, type RiderRow } from './fixtures';

const ENDPOINT = '/admin/delivery-partners';
const LIMIT = 10;

const PRESENCE_OPTIONS = [
  { label: 'Anyone', value: '' },
  { label: 'Online', value: 'online' },
  { label: 'Online & free', value: 'available' },
  { label: 'On a run', value: 'busy' },
  { label: 'Offline', value: 'offline' },
];

const FLEET_OPTIONS = [
  { label: 'All fleets', value: '' },
  { label: 'Vendor fleet', value: 'vendor' },
  { label: 'Platform pool', value: 'pool' },
];

const STATUS_OPTIONS = [
  { label: 'All accounts', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Pending', value: 'pending' },
];

interface Filters {
  q: string;
  presence: string;
  fleet: string;
  status: string;
}

const EMPTY_FILTERS: Filters = { q: '', presence: '', fleet: '', status: '' };

/**
 * "Presence" is one control on screen and two booleans on the API. Sending
 * `presence=` verbatim was a 400 under `forbidNonWhitelisted` — and a 400
 * is an error, not sample data, so every filtered view failed outright.
 */
const PRESENCE_PARAMS: Readonly<Record<string, { isOnline?: string; isAvailable?: string }>> = {
  online: { isOnline: 'true' },
  available: { isOnline: 'true', isAvailable: 'true' },
  busy: { isOnline: 'true', isAvailable: 'false' },
  offline: { isOnline: 'false' },
};

/*
 * The fleet-wide counts behind the KPI row. The table is one server page, so
 * counting its rows would report "3 online" for page 2 of a 40-rider fleet.
 * `limit=1` and the envelope's `meta.total` is the count, for one row's cost.
 */
const ONLINE_COUNT: QueryParams = { isOnline: 'true', limit: '1' };
const FREE_COUNT: QueryParams = { isOnline: 'true', isAvailable: 'true', limit: '1' };

function useFleetCount(params: QueryParams): number | null {
  const { data } = useAdminQuery<ListEnvelope<RiderRow>>(ENDPOINT, params);
  const total = data?.meta?.total;
  return typeof total === 'number' ? total : null;
}

function matchesPresence(row: RiderRow, presence: string): boolean {
  switch (presence) {
    case 'online':
      return row.isOnline;
    case 'available':
      return row.isOnline && row.isAvailable;
    case 'busy':
      return row.isOnline && !row.isAvailable;
    case 'offline':
      return !row.isOnline;
    default:
      return true;
  }
}

function sortValue(row: RiderRow, key: string): string | number | null {
  switch (key) {
    case 'name':
      return row.name;
    case 'vehicle':
      return vehicleLabel(row.vehicleType);
    case 'vendor':
      return row.vendorName ?? '';
    case 'completed':
      return row.completedCount;
    case 'rating':
      return row.rating;
    case 'status':
      return row.status;
    default:
      return null;
  }
}

export function RidersView() {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>({ key: 'completed', dir: 'desc' });

  const debouncedQ = useDebounced(filters.q, 300);

  const params = useMemo(
    () =>
      cleanParams({
        q: debouncedQ,
        ...PRESENCE_PARAMS[filters.presence],
        fleet: filters.fleet,
        status: filters.status,
        page,
        limit: LIMIT,
        sort: toSortParam(sort, RIDER_SORT),
      }),
    [debouncedQ, filters.presence, filters.fleet, filters.status, page, sort],
  );

  const { rows, meta, loading, isSample, refetch } = useSourcedList<RiderRow>(
    ENDPOINT,
    params,
    RIDERS_FIXTURE,
  );

  const onlineCount = useFleetCount(ONLINE_COUNT);
  const freeCount = useFleetCount(FREE_COUNT);

  const filtered = useMemo(() => {
    const matched = rows.filter((row) => {
      if (
        !matchesSearch(
          [row.name ?? undefined, row.phone ?? undefined, row.vendorName ?? undefined],
          debouncedQ,
        )
      ) {
        return false;
      }
      if (!matchesPresence(row, filters.presence)) return false;
      if (filters.fleet === 'vendor' && row.vendorId === null) return false;
      if (filters.fleet === 'pool' && row.vendorId !== null) return false;
      if (filters.status !== '' && row.status !== filters.status) return false;
      return true;
    });
    return sortRows(matched, sort, sortValue);
  }, [rows, debouncedQ, filters.presence, filters.fleet, filters.status, sort]);

  // Live, the server has already paged: `rows` IS page N, and slicing it
  // again for page 2 would show an empty table. Only the fixture path pages
  // on the client.
  const visible = useMemo(
    () => (isSample ? paginate(filtered, page, LIMIT) : filtered),
    [isSample, filtered, page],
  );
  const pages = isSample ? pageCount(filtered.length, LIMIT) : Math.max(1, meta.pages);

  const kpis = useMemo(() => {
    const online = isSample ? rows.filter((r) => r.isOnline).length : onlineCount;
    const free = isSample ? rows.filter((r) => r.isOnline && r.isAvailable).length : freeCount;
    if (online === null || free === null) return null;
    const onRun = online - free;
    return {
      online,
      free,
      onRun,
      utilisationPct: online === 0 ? 0 : (onRun / online) * 100,
    };
  }, [isSample, rows, onlineCount, freeCount]);

  const kpiLoading = loading || kpis === null;

  return (
    <AdminPage
      title="Riders"
      description="Every delivery partner on the platform — vendor fleets and the shared pool."
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Riders', href: '/admin/riders' },
      ]}
    >
      {isSample ? <SampleBanner endpoint={ENDPOINT} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Online now"
          value={kpis?.online ?? 0}
          tone={kpis?.online === 0 ? 'crit' : 'good'}
          loading={kpiLoading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Free to accept"
          value={kpis?.free ?? 0}
          loading={kpiLoading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="On a run"
          value={kpis?.onRun ?? 0}
          loading={kpiLoading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Fleet utilisation"
          value={Math.round(kpis?.utilisationPct ?? 0)}
          unit="%"
          deltaLabel={`${formatPct(kpis?.utilisationPct ?? 0)} of riders online are mid-delivery`}
          loading={kpiLoading}
        />
      </div>

      <FilterBar
        filters={[
          { key: 'q', label: 'Search', type: 'search' },
          { key: 'presence', label: 'Presence', type: 'select', options: PRESENCE_OPTIONS },
          { key: 'fleet', label: 'Fleet', type: 'select', options: FLEET_OPTIONS },
          { key: 'status', label: 'Account', type: 'select', options: STATUS_OPTIONS },
        ]}
        values={filters}
        onChange={(next) => {
          setFilters({
            q: next.q ?? '',
            presence: next.presence ?? '',
            fleet: next.fleet ?? '',
            status: next.status ?? '',
          });
          setPage(1);
        }}
        onReset={() => {
          setFilters(EMPTY_FILTERS);
          setPage(1);
        }}
      />

      <DataTable
        rowKey={(row: RiderRow) => row.id}
        rows={visible}
        loading={loading}
        empty="No rider matches those filters."
        onRowClick={(row: RiderRow) => router.push(`/admin/riders/${row.id}`)}
        page={page}
        pageCount={pages}
        onPageChange={setPage}
        sort={sort}
        onSortChange={setSort}
        columns={[
          {
            key: 'name',
            header: 'Rider',
            sortable: true,
            render: (row: RiderRow) => (
              <span className={styles.twoLine}>
                {row.name === null ? (
                  <span className={styles.nullish}>name not set</span>
                ) : (
                  <span className={styles.strong}>{row.name}</span>
                )}
                <span className={`${styles.subtle} ${styles.mono}`}>{row.phone ?? '—'}</span>
              </span>
            ),
          },
          {
            key: 'presence',
            header: 'Presence',
            width: '11rem',
            render: (row: RiderRow) => (
              <Presence online={row.isOnline} available={row.isAvailable} />
            ),
          },
          {
            key: 'vehicle',
            header: 'Vehicle',
            width: '8rem',
            sortable: true,
            // The insurance flag rides under the vehicle it belongs to. Read
            // optionally: an API not yet redeployed sends no standing, and
            // silence is the honest rendering of "unknown".
            render: (row: RiderRow) =>
              row.vehicleInsuranceStatus === 'expired' ||
              row.vehicleInsuranceStatus === 'expiring_soon' ? (
                <span className={styles.twoLine}>
                  <span>{vehicleLabel(row.vehicleType)}</span>
                  <span
                    className={styles.tag}
                    title="Vehicle insurance — see the rider's KYC panel for the date"
                  >
                    {row.vehicleInsuranceStatus === 'expired' ? (
                      <span className={styles.crit}>insurance expired</span>
                    ) : (
                      <span className={styles.warn}>insurance ≤30d</span>
                    )}
                  </span>
                </span>
              ) : (
                vehicleLabel(row.vehicleType)
              ),
          },
          {
            key: 'vendor',
            header: 'Fleet',
            sortable: true,
            render: (row: RiderRow) =>
              row.vendorName === null ? (
                <span className={styles.tag}>platform pool</span>
              ) : (
                <span className={styles.truncate}>{row.vendorName}</span>
              ),
          },
          {
            key: 'active',
            header: 'Active order',
            width: '11rem',
            render: (row: RiderRow) =>
              row.activeOrderId === null ? (
                <span className={styles.muted}>—</span>
              ) : (row.activeOrderNo ?? null) === null ? (
                // Holding an order id that no longer resolves to an order —
                // worth seeing, so it is not rendered as "no order".
                <span className={styles.warn} title={row.activeOrderId}>
                  unresolved order
                </span>
              ) : (
                <span className={styles.mono}>{row.activeOrderNo}</span>
              ),
          },
          {
            key: 'completed',
            header: 'Completed',
            align: 'right',
            width: '7rem',
            sortable: true,
            render: (row: RiderRow) => (
              <span className={styles.num}>{formatCount(row.completedCount)}</span>
            ),
          },
          {
            key: 'rating',
            header: 'Rating',
            align: 'right',
            width: '6rem',
            sortable: true,
            render: (row: RiderRow) =>
              row.rating === 0 ? (
                <span className={styles.muted}>—</span>
              ) : (
                <span
                  className={`${styles.num} ${row.rating < 4 ? styles.warn : ''}`}
                  title={`${row.rating.toFixed(1)} out of 5`}
                >
                  {row.rating.toFixed(1)}
                </span>
              ),
          },
          {
            key: 'status',
            header: 'Account',
            width: '8rem',
            sortable: true,
            render: (row: RiderRow) => <StatusPill status={row.status} kind="user" />,
          },
          {
            // The API's `locationAt`: the last GPS ping, which is the only
            // "last seen" the platform actually records.
            key: 'locationAt',
            header: 'Last ping',
            width: '9rem',
            render: (row: RiderRow) =>
              row.locationAt === null ? (
                <span className={styles.nullish}>never</span>
              ) : (
                <RelativeTime value={row.locationAt} />
              ),
          },
        ]}
      />
    </AdminPage>
  );
}
