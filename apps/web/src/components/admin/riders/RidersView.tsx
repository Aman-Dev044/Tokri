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
import { useDebounced } from '@/hooks';
import { formatCount, formatPct } from '@/lib/admin/format';

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
import { Presence } from './Presence';
import { RIDERS_FIXTURE, VEHICLE_LABEL, type RiderRow } from './fixtures';

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
      return VEHICLE_LABEL[row.vehicleType];
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
        presence: filters.presence,
        fleet: filters.fleet,
        status: filters.status,
        page,
        limit: LIMIT,
      }),
    [debouncedQ, filters.presence, filters.fleet, filters.status, page],
  );

  const { rows, loading, isSample, refetch } = useSourcedList<RiderRow>(
    ENDPOINT,
    params,
    RIDERS_FIXTURE,
  );

  const filtered = useMemo(() => {
    const matched = rows.filter((row) => {
      if (!matchesSearch([row.name, row.phone, row.vendorName ?? undefined, row.city], debouncedQ)) {
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

  const visible = useMemo(() => paginate(filtered, page, LIMIT), [filtered, page]);

  const kpis = useMemo(() => {
    const online = rows.filter((r) => r.isOnline);
    const free = online.filter((r) => r.isAvailable);
    const onRun = online.length - free.length;
    const rated = rows.filter((r) => r.rating > 0);
    return {
      online: online.length,
      free: free.length,
      onRun,
      utilisationPct: online.length === 0 ? 0 : (onRun / online.length) * 100,
      avgRating:
        rated.length === 0
          ? 0
          : Math.round((rated.reduce((s, r) => s + r.rating, 0) / rated.length) * 10) / 10,
    };
  }, [rows]);

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
          value={kpis.online}
          tone={kpis.online === 0 ? 'crit' : 'good'}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Free to accept"
          value={kpis.free}
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="On a run"
          value={kpis.onRun}
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Fleet utilisation"
          value={Math.round(kpis.utilisationPct)}
          unit="%"
          deltaLabel={`${formatPct(kpis.utilisationPct)} of riders online are mid-delivery`}
          loading={loading}
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
        pageCount={pageCount(filtered.length, LIMIT)}
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
                <span className={styles.strong}>{row.name}</span>
                <span className={`${styles.subtle} ${styles.mono}`}>{row.phone}</span>
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
            render: (row: RiderRow) => VEHICLE_LABEL[row.vehicleType],
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
              row.activeOrderNo === null ? (
                <span className={styles.muted}>—</span>
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
            key: 'lastSeenAt',
            header: 'Last seen',
            width: '9rem',
            render: (row: RiderRow) => <RelativeTime value={row.lastSeenAt} />,
          },
        ]}
      />
    </AdminPage>
  );
}
