'use client';

import { useMemo, useState } from 'react';

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

import { useAdminRole } from '../_shared-pages/role';
import { SampleBanner } from '../_shared-pages/SampleBanner';
import styles from '../_shared-pages/pages.module.css';
import { safeArray, useSourcedOne } from '../_shared-pages/useSourced';
import { Reconciliation } from './Reconciliation';
import {
  LEDGER_TYPE_LABEL,
  ledgerNet,
  settlementDetailFixture,
  type LedgerEntryRow,
  type SettlementDetail,
} from './fixtures';

export function SettlementDetailView({ settlementId }: { settlementId: string }) {
  const { isSuperAdmin, restrictedNote } = useAdminRole();
  const endpoint = `/admin/settlements/${settlementId}`;

  const { value, loading, isSample, refetch } = useSourcedOne<SettlementDetail>(
    endpoint,
    settlementDetailFixture(settlementId),
  );

  const [paying, setPaying] = useState(false);
  const markPaid = useAdminMutation<{ reference: string }, SettlementDetail>(
    `${endpoint}/pay`,
    'POST',
  );

  const entries = useMemo(() => safeArray(value.entries), [value.entries]);

  const ledger = useMemo(() => {
    const sum = ledgerNet(entries);
    return { sum, agrees: sum === value.netPayablePaise };
  }, [entries, value.netPayablePaise]);

  async function runMarkPaid() {
    await markPaid.mutate({ reference: value.reference ?? '' });
    setPaying(false);
    refetch();
  }

  return (
    <AdminPage
      title={value.vendorName}
      description={`Settlement for ${formatDate(value.periodStart, 'long')} – ${formatDate(
        value.periodEnd,
        'long',
      )}`}
      breadcrumbs={[
        { label: 'Admin', href: '/admin' },
        { label: 'Settlements', href: '/admin/settlements' },
        { label: value.vendorName, href: `/admin/settlements/${settlementId}` },
      ]}
      actions={
        /* SUPER_ADMIN only — see the note in `_shared-pages/role.ts`. */
        isSuperAdmin && value.status !== 'paid' ? (
          <button
            type="button"
            className={`${styles.btn} ${styles.btnPrimary}`}
            onClick={() => setPaying(true)}
            disabled={markPaid.loading}
          >
            Mark paid
          </button>
        ) : null
      }
    >
      {isSample ? <SampleBanner endpoint={endpoint} onRetry={refetch} /> : null}

      {isSuperAdmin ? null : <p className={styles.readOnlyNote}>{restrictedNote}</p>}

      <AdminSection title="How this settlement is composed">
        <div className={styles.panel}>
          <div className={styles.panelBody}>
            <Reconciliation
              grossPaise={value.grossSalesPaise}
              commissionPaise={value.totalCommissionPaise}
              refundsPaise={value.refundsPaise}
              netPayablePaise={value.netPayablePaise}
              commissionPct={value.commissionPct}
            />
          </div>
        </div>
      </AdminSection>

      <div className={styles.kpiRow}>
        <KpiTile
          index={0}
          isFixture={isSample}
          label="Orders in period"
          value={value.orderCount}
          loading={loading}
        />
        <KpiTile
          index={1}
          isFixture={isSample}
          label="Ledger entries"
          value={entries.length}
          loading={loading}
          deltaLabel="rows that compose the net"
        />
        <KpiTile
          index={2}
          isFixture={isSample}
          label="Ledger sum"
          value={ledger.sum}
          unit="paise"
          tone={ledger.agrees ? 'good' : 'crit'}
          deltaLabel={ledger.agrees ? 'matches the net payable' : 'disagrees with the net payable'}
          loading={loading}
        />
        <KpiTile
          index={3}
          isFixture={isSample}
          label="Refunds debited"
          value={value.refundsPaise}
          unit="paise"
          tone={value.refundsPaise > 0 ? 'warn' : 'neutral'}
          deltaLabel="already taken off the net"
          loading={loading}
        />
      </div>

      <div className={`${styles.split} ${styles.split2}`}>
        <AdminSection title="Ledger entries">
          {ledger.agrees ? null : (
            <p className={`${styles.readOnlyNote} ${styles.crit}`} role="alert">
              The ledger sums to <Money value={ledger.sum} /> but the settlement stores{' '}
              <Money value={value.netPayablePaise} />. One of the two is wrong. Do not pay this out.
            </p>
          )}

          <DataTable
            rowKey={(row: LedgerEntryRow) => row.id}
            rows={entries}
            loading={loading}
            empty="This settlement has no ledger entries, which should be impossible."
            columns={[
              {
                key: 'type',
                header: 'Type',
                width: '9rem',
                render: (row: LedgerEntryRow) => (
                  <span className={styles.tag}>{LEDGER_TYPE_LABEL[row.type]}</span>
                ),
              },
              {
                key: 'orderNo',
                header: 'Order',
                width: '13rem',
                render: (row: LedgerEntryRow) =>
                  row.orderNo === null ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    <span className={styles.mono}>{row.orderNo}</span>
                  ),
              },
              {
                key: 'note',
                header: 'Note',
                render: (row: LedgerEntryRow) =>
                  row.note === null ? (
                    <span className={styles.muted}>—</span>
                  ) : (
                    <span className={styles.subtle}>{row.note}</span>
                  ),
              },
              {
                key: 'amountPaise',
                header: 'Amount',
                align: 'right',
                width: '10rem',
                render: (row: LedgerEntryRow) => (
                  // Signed: credits positive, debits negative. The sign is part
                  // of the value, never inferred from the colour alone.
                  <span className={row.amountPaise < 0 ? styles.crit : styles.good}>
                    {row.amountPaise < 0 ? '−' : '+'}
                    <Money value={Math.abs(row.amountPaise)} />
                  </span>
                ),
              },
              {
                key: 'createdAt',
                header: 'When',
                width: '9rem',
                render: (row: LedgerEntryRow) => <RelativeTime value={row.createdAt} />,
              },
            ]}
          />
        </AdminSection>

        <AdminSection title="Settlement">
          <div className={styles.panel}>
            <div className={styles.panelBody}>
              <dl className={styles.defList}>
                <dt className={styles.dt}>Status</dt>
                <dd className={styles.dd}>
                  <StatusPill status={value.status} kind="settlement" />
                </dd>

                <dt className={styles.dt}>Vendor</dt>
                <dd className={styles.dd}>{value.vendorName}</dd>

                <dt className={styles.dt}>Period</dt>
                <dd className={`${styles.dd} ${styles.mono}`}>
                  {formatDate(value.periodStart, 'day')} – {formatDate(value.periodEnd, 'day')}
                </dd>

                <dt className={styles.dt}>Orders</dt>
                <dd className={`${styles.dd} ${styles.num}`}>{formatCount(value.orderCount)}</dd>

                <dt className={styles.dt}>Commission</dt>
                <dd className={`${styles.dd} ${styles.num}`}>
                  {value.commissionPct}%{' '}
                  <span className={styles.subtle}>snapshotted per order at creation</span>
                </dd>

                <dt className={styles.dt}>Paid at</dt>
                <dd className={styles.dd}>
                  {value.paidAt === null ? (
                    <span className={styles.nullish}>not paid</span>
                  ) : (
                    formatDate(value.paidAt, 'full')
                  )}
                </dd>

                <dt className={styles.dt}>Reference</dt>
                <dd className={`${styles.dd} ${styles.mono}`}>
                  {value.reference ?? <span className={styles.nullish}>none yet</span>}
                </dd>
              </dl>
            </div>
          </div>
        </AdminSection>
      </div>

      <ConfirmDialog
        open={paying}
        title="Mark this settlement as paid?"
        body={`This records that ${value.vendorName} has been paid. It moves no money — the bank transfer must already have happened, and the reference above should match it.`}
        confirmLabel="Mark paid"
        destructive
        loading={markPaid.loading}
        onConfirm={() => {
          void runMarkPaid();
        }}
        onCancel={() => setPaying(false)}
      />
    </AdminPage>
  );
}
