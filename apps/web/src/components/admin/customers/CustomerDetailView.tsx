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
import { formatCount, formatDate } from '@/lib/admin/format';

import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { safeArray, useSourcedOne } from '../_shared-pages/useSourced';
import { customerDetailFixture, type CustomerDetail, type CustomerOrderRow } from './fixtures';

interface StatusBody {
  status: 'active' | 'suspended';
  reason: string;
}

export function CustomerDetailView({ customerId }: { customerId: string }) {
  const router = useRouter();
  const endpoint = `/admin/customers/${customerId}`;

  const { value, loading, isSample, refetch } = useSourcedOne<CustomerDetail>(
    endpoint,
    customerDetailFixture(customerId),
  );

  const [confirming, setConfirming] = useState(false);
  const { mutate, loading: saving, error } = useAdminMutation<StatusBody, CustomerDetail>(
    `${endpoint}/status`,
    'PATCH',
  );

  const orders = safeArray(value.orders);
  const addresses = safeArray(value.addresses);
  const suspended = value.status === 'suspended';

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
      description={`Customer since ${formatDate(value.createdAt, 'long')}`}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Customers', href: '/admin/customers' },
        { label: value.name, href: `/admin/customers/${customerId}` },
      ]}
      actions={
        <button
          type="button"
          className={`${styles.btn} ${suspended ? '' : styles.btnDanger}`}
          onClick={() => setConfirming(true)}
          disabled={saving}
        >
          {suspended ? 'Reinstate account' : 'Suspend account'}
        </button>
      }
    >
      {isSample ? <SampleBanner endpoint={endpoint} onRetry={refetch} /> : null}

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Lifetime value"
          value={value.lifetime.grossPaise}
          unit="paise"
          spark={value.lifetime.spark}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Orders"
          value={value.lifetime.ordersCount}
          loading={loading}
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Average order"
          value={value.lifetime.avgOrderPaise}
          unit="paise"
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Refunded"
          value={value.lifetime.refundedPaise}
          unit="paise"
          tone={value.lifetime.refundedPaise > 0 ? 'warn' : 'neutral'}
          loading={loading}
        />
      </div>

      <div className={`${styles.split} ${styles.split2}`}>
        <div className={styles.stack}>
          <AdminSection title="Order history">
            <DataTable
              rowKey={(row: CustomerOrderRow) => row.id}
              rows={orders}
              loading={loading}
              empty="This customer has never placed an order."
              onRowClick={(row: CustomerOrderRow) => router.push(`/admin/orders/${row.id}`)}
              columns={[
                {
                  key: 'orderNo',
                  header: 'Order',
                  render: (row: CustomerOrderRow) => (
                    <span className={styles.mono}>{row.orderNo}</span>
                  ),
                },
                { key: 'vendorName', header: 'Vendor' },
                {
                  key: 'itemCount',
                  header: 'Items',
                  align: 'right',
                  width: '5rem',
                  render: (row: CustomerOrderRow) => (
                    <span className={styles.num}>{formatCount(row.itemCount)}</span>
                  ),
                },
                {
                  key: 'totalPaise',
                  header: 'Total',
                  align: 'right',
                  width: '8rem',
                  render: (row: CustomerOrderRow) => <Money value={row.totalPaise} />,
                },
                {
                  key: 'status',
                  header: 'Status',
                  width: '10rem',
                  render: (row: CustomerOrderRow) => (
                    <StatusPill status={row.status} kind="order" />
                  ),
                },
                {
                  key: 'placedAt',
                  header: 'Placed',
                  width: '9rem',
                  render: (row: CustomerOrderRow) => <RelativeTime value={row.placedAt} />,
                },
              ]}
            />
          </AdminSection>
        </div>

        <div className={styles.stack}>
          <AdminSection title="Profile">
            <div className={styles.panel}>
              <div className={styles.panelBody}>
                <dl className={styles.defList}>
                  <dt className={styles.dt}>Status</dt>
                  <dd className={styles.dd}>
                    <StatusPill status={value.status} kind="user" />
                  </dd>

                  <dt className={styles.dt}>Phone</dt>
                  <dd className={`${styles.dd} ${styles.mono}`}>{value.phone}</dd>

                  <dt className={styles.dt}>Email</dt>
                  <dd className={styles.dd}>
                    {value.email ?? <span className={styles.nullish}>not provided</span>}
                  </dd>

                  <dt className={styles.dt}>Joined</dt>
                  <dd className={styles.dd}>{formatDate(value.createdAt, 'long')}</dd>

                  <dt className={styles.dt}>First order</dt>
                  <dd className={styles.dd}>
                    {value.lifetime.firstOrderAt === null ? (
                      <span className={styles.nullish}>never ordered</span>
                    ) : (
                      formatDate(value.lifetime.firstOrderAt, 'long')
                    )}
                  </dd>

                  <dt className={styles.dt}>Cancelled</dt>
                  <dd className={`${styles.dd} ${styles.num}`}>
                    {formatCount(value.lifetime.cancelledCount)}
                  </dd>
                </dl>
              </div>
            </div>
          </AdminSection>

          <AdminSection title={`Addresses (${addresses.length})`}>
            <div className={styles.stack}>
              {addresses.map((address) => (
                <div key={address.id} className={styles.panel}>
                  <div className={styles.panelBody}>
                    <div className={styles.rowWrap}>
                      <span className={styles.strong}>{address.label}</span>
                      {address.isDefault ? <span className={styles.tag}>default</span> : null}
                    </div>
                    <p className={styles.dd}>
                      {address.line1}
                      {address.line2 === null ? null : <>, {address.line2}</>}
                      <br />
                      {address.city} <span className={styles.mono}>{address.pincode}</span>
                    </p>
                    <p className={`${styles.subtle} ${styles.mono}`}>{address.phone}</p>
                  </div>
                </div>
              ))}
              {addresses.length === 0 ? (
                <p className={styles.subtle}>No saved address.</p>
              ) : null}
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
        The button above is hidden/disabled for UX only. A suspension is a real
        privilege decision and the API's RolesGuard is what enforces it.
      */}
      <ConfirmDialog
        open={confirming}
        title={suspended ? 'Reinstate this customer?' : 'Suspend this customer?'}
        body={
          suspended
            ? `${value.name} will be able to sign in and place orders again.`
            : `${value.name} will be signed out and blocked from placing new orders. Orders already in flight are not cancelled.`
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
