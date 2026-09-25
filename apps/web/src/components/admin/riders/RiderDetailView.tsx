'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  DataTable,
  KpiTile,
  Money,
  RelativeTime,
  StatusPill,
} from '@/components/admin';
import { useAdminMutation } from '@/hooks';
import { formatCount, formatDate, formatPct } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { safeArray, useSourcedOne } from '../_shared-pages/useSourced';
import { Presence } from './Presence';
import {
  riderDetailFixture,
  VEHICLE_LABEL,
  type RiderDeliveryRow,
  type RiderDetail,
} from './fixtures';

interface StatusBody {
  status: 'active' | 'suspended';
  reason: string;
}

export function RiderDetailView({ riderId }: { riderId: string }) {
  const router = useRouter();
  const endpoint = `/admin/delivery-partners/${riderId}`;

  const { value, loading, isSample, refetch } = useSourcedOne<RiderDetail>(
    endpoint,
    riderDetailFixture(riderId),
  );

  const [confirming, setConfirming] = useState(false);
  const { mutate, loading: saving, error } = useAdminMutation<StatusBody, RiderDetail>(
    `${endpoint}/status`,
    'PATCH',
  );

  const deliveries = safeArray(value.deliveries);
  const suspended = value.status === 'suspended';
  const onARun = value.currentAssignment !== null;

  async function applyStatus() {
    await mutate({
      status: suspended ? 'active' : 'suspended',
      reason: suspended ? 'Reinstated by admin' : 'Suspended by admin',
    });
    setConfirming(false);
    refetch();
  }

  return (
    <AdminPage
      title={value.name}
      description={`${VEHICLE_LABEL[value.vehicleType]} · ${
        value.vendorName ?? 'platform pool'
      } · ${value.city}`}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Riders', href: '/admin/riders' },
        { label: value.name, href: `/admin/riders/${riderId}` },
      ]}
      actions={
        <button
          type="button"
          className={`${styles.btn} ${suspended ? '' : styles.btnDanger}`}
          onClick={() => setConfirming(true)}
          disabled={saving}
        >
          {suspended ? 'Reinstate rider' : 'Suspend rider'}
        </button>
      }
    >
      {isSample ? <SampleBanner endpoint={endpoint} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Completed"
          value={value.completedCount}
          spark={value.performance.spark}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="On time"
          value={Math.round(value.performance.onTimePct)}
          unit="%"
          tone={value.performance.onTimePct >= 90 ? 'good' : 'warn'}
          deltaLabel={formatPct(value.performance.onTimePct)}
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Average run"
          value={value.performance.avgMinutes}
          unit="min"
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Failed deliveries"
          value={value.performance.failedCount}
          tone={value.performance.failedCount > 5 ? 'warn' : 'neutral'}
          loading={loading}
        />
      </div>

      <div className={`${styles.split} ${styles.split2}`}>
        <div className={styles.stack}>
          <AdminSection title="Current assignment">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                {value.currentAssignment === null ? (
                  <p className={styles.subtle}>
                    {value.isOnline
                      ? 'Online and waiting for an offer. No order is assigned.'
                      : 'Offline. The assignment engine will not offer this rider anything.'}
                  </p>
                ) : (
                  <dl className={styles.defList}>
                    <dt className={styles.dt}>Order</dt>
                    <dd className={styles.dd}>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnGhost} ${styles.btnSmall} ${styles.mono}`}
                        onClick={() =>
                          router.push(`/admin/orders/${value.currentAssignment?.orderId ?? ''}`)
                        }
                      >
                        {value.currentAssignment.orderNo}
                      </button>
                    </dd>

                    <dt className={styles.dt}>Status</dt>
                    <dd className={styles.dd}>
                      <StatusPill status={value.currentAssignment.status} kind="order" />
                    </dd>

                    <dt className={styles.dt}>Customer</dt>
                    <dd className={styles.dd}>{value.currentAssignment.customerName}</dd>

                    <dt className={styles.dt}>Pickup</dt>
                    <dd className={styles.dd}>{value.currentAssignment.pickup}</dd>

                    <dt className={styles.dt}>Drop</dt>
                    <dd className={styles.dd}>
                      {value.currentAssignment.dropCity}{' '}
                      <span className={styles.mono}>{value.currentAssignment.dropPincode}</span>
                    </dd>

                    <dt className={styles.dt}>Assigned</dt>
                    <dd className={styles.dd}>
                      <RelativeTime value={value.currentAssignment.assignedAt} />
                    </dd>

                    <dt className={styles.dt}>ETA</dt>
                    <dd className={`${styles.dd} ${styles.num}`}>
                      {value.currentAssignment.etaMinutes} min
                    </dd>
                  </dl>
                )}
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Delivery history">
            <DataTable
              rowKey={(row: RiderDeliveryRow) => row.id}
              rows={deliveries}
              loading={loading}
              empty="No completed delivery yet."
              columns={[
                {
                  key: 'orderNo',
                  header: 'Order',
                  render: (row: RiderDeliveryRow) => (
                    <span className={styles.mono}>{row.orderNo}</span>
                  ),
                },
                { key: 'vendorName', header: 'Vendor' },
                {
                  key: 'distanceKm',
                  header: 'Distance',
                  align: 'right',
                  width: '7rem',
                  render: (row: RiderDeliveryRow) => (
                    <span className={styles.num}>{row.distanceKm.toFixed(1)} km</span>
                  ),
                },
                {
                  key: 'minutes',
                  header: 'Time',
                  align: 'right',
                  width: '6rem',
                  render: (row: RiderDeliveryRow) => (
                    <span
                      className={`${styles.num} ${row.minutes > 30 ? styles.warn : ''}`}
                    >
                      {row.minutes} min
                    </span>
                  ),
                },
                {
                  key: 'earnedPaise',
                  header: 'Earned',
                  align: 'right',
                  width: '7rem',
                  render: (row: RiderDeliveryRow) => <Money value={row.earnedPaise} />,
                },
                {
                  key: 'status',
                  header: 'Outcome',
                  width: '10rem',
                  render: (row: RiderDeliveryRow) => (
                    <StatusPill status={row.status} kind="order" />
                  ),
                },
                {
                  key: 'deliveredAt',
                  header: 'When',
                  width: '9rem',
                  render: (row: RiderDeliveryRow) => <RelativeTime value={row.deliveredAt} />,
                },
              ]}
            />
          </AdminSection>
        </div>

        <div className={styles.stack}>
          <AdminSection title="Rider">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                <dl className={styles.defList}>
                  <dt className={styles.dt}>Presence</dt>
                  <dd className={styles.dd}>
                    <Presence online={value.isOnline} available={value.isAvailable} />
                  </dd>

                  <dt className={styles.dt}>Account</dt>
                  <dd className={styles.dd}>
                    <StatusPill status={value.status} kind="user" />
                  </dd>

                  <dt className={styles.dt}>Phone</dt>
                  <dd className={`${styles.dd} ${styles.mono}`}>{value.phone}</dd>

                  <dt className={styles.dt}>Vehicle</dt>
                  <dd className={styles.dd}>{VEHICLE_LABEL[value.vehicleType]}</dd>

                  <dt className={styles.dt}>Fleet</dt>
                  <dd className={styles.dd}>
                    {value.vendorName ?? <span className={styles.tag}>platform pool</span>}
                  </dd>

                  <dt className={styles.dt}>Rating</dt>
                  <dd className={`${styles.dd} ${styles.num}`}>
                    {value.rating === 0 ? '—' : `${value.rating.toFixed(1)} / 5`}
                  </dd>

                  <dt className={styles.dt}>Joined</dt>
                  <dd className={styles.dd}>{formatDate(value.joinedAt, 'long')}</dd>

                  <dt className={styles.dt}>Last seen</dt>
                  <dd className={styles.dd}>
                    <RelativeTime value={value.lastSeenAt} />
                  </dd>
                </dl>
              </div>
            </div>
          </AdminSection>

          <AdminSection title="Performance">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                <dl className={styles.defList}>
                  <dt className={styles.dt}>Accept rate</dt>
                  <dd className={`${styles.dd} ${styles.num}`}>
                    {formatPct(value.performance.acceptRatePct)}
                  </dd>

                  <dt className={styles.dt}>On time</dt>
                  <dd className={`${styles.dd} ${styles.num}`}>
                    {formatPct(value.performance.onTimePct)}
                  </dd>

                  <dt className={styles.dt}>Deliveries</dt>
                  <dd className={`${styles.dd} ${styles.num}`}>
                    {formatCount(value.completedCount)}
                  </dd>

                  <dt className={styles.dt}>Earnings</dt>
                  <dd className={styles.dd}>
                    <Money value={value.performance.earningsPaise} />
                  </dd>
                </dl>
              </div>
            </div>
          </AdminSection>
        </div>
      </div>

      {error === null || error === undefined ? null : (
        <p className={styles.fieldError} role="alert">
          The status change did not go through. Nothing was saved.
        </p>
      )}

      {/*
        Showing or hiding this button is UX. The API's RolesGuard decides
        whether a suspension is actually allowed.
      */}
      <ConfirmDialog
        open={confirming}
        title={suspended ? 'Reinstate this rider?' : 'Suspend this rider?'}
        body={
          suspended
            ? `${value.name} will be able to go online and accept offers again.`
            : onARun
              ? `${value.name} is mid-delivery on ${
                  value.currentAssignment?.orderNo ?? 'an order'
                }. Suspending now takes them offline; that order must be reassigned by hand.`
              : `${value.name} will be taken offline and will stop receiving offers.`
        }
        confirmLabel={suspended ? 'Reinstate' : 'Suspend'}
        destructive={!suspended}
        loading={saving}
        onConfirm={() => {
          void applyStatus();
        }}
        onCancel={() => setConfirming(false)}
      />
    </AdminPage>
  );
}
