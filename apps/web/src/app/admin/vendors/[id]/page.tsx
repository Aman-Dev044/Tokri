'use client';

/**
 * One vendor: who they are, where they are, what they sell, what they are owed.
 *
 * ── THE COMMISSION EDITOR IS SUPER-ADMIN ONLY ───────────────────────────────
 * Commission is the platform's revenue share and it is copied onto every order
 * at creation time (plan §1, decision 6), so changing it never rewrites history
 * — but it does change every rupee from the next order onward. A plain ADMIN
 * does not see the control at all.
 *
 * As everywhere else on this surface: hiding the control is UX. The API's
 * RolesGuard is what refuses the PATCH, and it refuses it whether or not this
 * page chose to render a form.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAdminMutation, useAdminQuery } from '@/hooks';
import { formatCount, formatDate, formatPct } from '@/lib/admin/format';
import { adminLevelOf } from '@/lib/admin/session';
import { useAuth } from '@/components/auth/AuthProvider';
import type { VendorDetail, VendorProductRow } from '@/lib/admin/types';
import {
  AdminPage,
  AdminSection,
  AisleDot,
  ConfirmDialog,
  DataTable,
  EmptyState,
  IconLock,
  IconPin,
  Money,
  RelativeTime,
  StatusPill,
  type Column,
} from '@/components/admin';

export default function AdminVendorDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const { user } = useAuth();
  const level = adminLevelOf(user);
  /*
   * With no session at all the console is in preview mode (see AdminShell), and
   * showing the editor there lets the gate itself be reviewed. It grants
   * nothing — the PATCH 401s without a token.
   */
  const canEditCommission = level === 'SUPER_ADMIN' || level === null;

  const query = useAdminQuery<VendorDetail>(`/admin/vendors/${id}`, undefined, {
    enabled: id !== '',
  });
  const vendor = query.data;

  const [suspendOpen, setSuspendOpen] = useState(false);
  const statusMutation = useAdminMutation<{ status: string }, VendorDetail>(
    '/admin/vendors/:id/status',
    'PATCH',
  );

  const productColumns: Column<VendorProductRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Product',
        render: (row) => (
          <span className="adm-row">
            <AisleDot aisleKey={row.aisleKey} />
            <span style={{ minWidth: 0 }}>
              {row.name}
              <span className="adm-table__sub">{row.sku}</span>
            </span>
          </span>
        ),
      },
      {
        key: 'pricePaise',
        header: 'Price',
        align: 'right',
        render: (row) => <Money value={row.pricePaise} />,
      },
      {
        key: 'mrpPaise',
        header: 'MRP',
        align: 'right',
        render: (row) => <Money value={row.mrpPaise} />,
      },
      {
        key: 'stock',
        header: 'Stock',
        align: 'right',
        render: (row) => (
          <span
            className="adm-num"
            style={{
              color:
                row.stock === 0
                  ? 'var(--crit-ink)'
                  : row.stock <= row.lowStockThreshold
                    ? 'var(--warn-ink)'
                    : undefined,
            }}
            title={
              row.stock <= row.lowStockThreshold
                ? `At or below the low-stock threshold of ${row.lowStockThreshold}`
                : undefined
            }
          >
            {formatCount(row.stock)}
          </span>
        ),
      },
      {
        key: 'isActive',
        header: 'Listed',
        align: 'center',
        render: (row) => (
          <StatusPill status={row.isActive ? 'active' : 'suspended'} kind="user" />
        ),
      },
    ],
    [],
  );

  if (!query.loading && !vendor) {
    return (
      <AdminPage
        title="Vendor not found"
        description="No vendor with this id, or it is outside what your account may see."
        breadcrumbs={[{ label: 'Vendors', href: '/admin/vendors' }, { label: 'Not found' }]}
      >
        <div className="adm-panel">
          <EmptyState
            title="Nothing here"
            body={
              query.error?.status === 404
                ? 'The API returned 404. It returns 404 rather than 403 for a record you may not see, so an id cannot be probed for existence.'
                : (query.error?.friendlyMessage ?? 'The record could not be loaded.')
            }
            action={
              <Link className="adm-btn" href="/admin/vendors">
                Back to vendors
              </Link>
            }
          />
        </div>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title={vendor?.storeName ?? 'Loading…'}
      description={
        vendor
          ? `${vendor.ownerName} · ${vendor.address.city} · joined ${formatDate(vendor.createdAt, 'long')}`
          : 'Fetching the vendor record.'
      }
      isFixture={query.isFixture}
      fixturePaths={query.isFixture ? [`/admin/vendors/${id}`] : undefined}
      breadcrumbs={[
        { label: 'Vendors', href: '/admin/vendors' },
        { label: vendor?.storeName ?? id },
      ]}
      actions={
        vendor ? (
          <>
            <StatusPill status={vendor.status} kind="vendor" />
            {vendor.status !== 'suspended' ? (
              <button
                type="button"
                className="adm-btn adm-btn--sm adm-btn--danger"
                onClick={() => setSuspendOpen(true)}
              >
                Suspend
              </button>
            ) : (
              <button
                type="button"
                className="adm-btn adm-btn--sm"
                onClick={() =>
                  void statusMutation.mutate(
                    { status: 'approved' },
                    { params: { id }, invalidate: ['/admin/vendors'] },
                  )
                }
              >
                Reinstate
              </button>
            )}
          </>
        ) : null
      }
    >
      {/* ---- earnings ---- */}
      <AdminSection title="Earnings" description="Lifetime, from the ledger.">
        <div className="adm-kpirow">
          <Tile label="Gross sales" value={vendor?.earnings.grossPaise} index={0} />
          <Tile label="Platform commission" value={vendor?.earnings.commissionPaise} index={1} />
          <Tile label="Refunds" value={vendor?.earnings.refundsPaise} index={2} />
          <Tile label="Net payable" value={vendor?.earnings.netPayablePaise} index={3} strong />
        </div>
        <p className="adm-section__desc" style={{ marginTop: 'var(--s-2)' }}>
          Net payable is gross minus commission minus refunds. The delivery fee is platform revenue
          and never enters this figure (plan §1, decision 5).{' '}
          {vendor?.earnings.lastSettledAt ? (
            <>
              Last settled <RelativeTime value={vendor.earnings.lastSettledAt} live={false} />.
            </>
          ) : (
            'Never settled.'
          )}
        </p>
      </AdminSection>

      <div className="adm-grid adm-grid--2" style={{ marginBottom: 'var(--s-5)' }}>
        {/* ---- profile ---- */}
        <AdminSection title="Profile">
          <div className="adm-panel adm-panel--pad">
            {vendor ? (
              <>
                <p style={{ marginBottom: 'var(--s-3)' }}>{vendor.description}</p>
                <dl className="adm-dl">
                  <dt>Slug</dt>
                  <dd className="adm-num">{vendor.slug}</dd>
                  <dt>Owner</dt>
                  <dd>{vendor.ownerName}</dd>
                  <dt>Phone</dt>
                  <dd className="adm-num">{vendor.phone}</dd>
                  <dt>Address</dt>
                  <dd>
                    {vendor.address.line1}, {vendor.address.city}, {vendor.address.state}{' '}
                    <span className="adm-num">{vendor.address.pincode}</span>
                  </dd>
                  <dt>Coordinates</dt>
                  <dd className="adm-row">
                    <IconPin style={{ width: 14, height: 14, color: 'var(--adm-dim)' }} />
                    {/* Stored GeoJSON order is [lng, lat]; printed lat,lng because
                        that is what every map tool expects pasted in. */}
                    <span className="adm-num">
                      {vendor.location.coordinates[1].toFixed(5)},{' '}
                      {vendor.location.coordinates[0].toFixed(5)}
                    </span>
                    <span className="adm-table__sub" style={{ display: 'inline' }}>
                      lat, lng
                    </span>
                  </dd>
                  <dt>Radius</dt>
                  <dd className="adm-num">{vendor.serviceRadiusKm} km</dd>
                  <dt>Cash on delivery</dt>
                  <dd>
                    {vendor.codEnabled ? (
                      <>
                        Enabled, capped at <Money value={vendor.codMaxAmountPaise} />
                      </>
                    ) : (
                      'Disabled'
                    )}
                  </dd>
                </dl>
              </>
            ) : (
              <SkeletonLines count={7} />
            )}
          </div>
        </AdminSection>

        {/* ---- hours + commission ---- */}
        <div className="adm-stack">
          <AdminSection title="Opening hours">
            <div className="adm-panel adm-panel--pad">
              {vendor ? (
                <dl className="adm-dl">
                  {vendor.openingHours.map((slot) => (
                    <span key={slot.day} style={{ display: 'contents' }}>
                      <dt>{slot.day}</dt>
                      <dd className="adm-num">
                        {slot.open} – {slot.close}
                      </dd>
                    </span>
                  ))}
                </dl>
              ) : (
                <SkeletonLines count={7} />
              )}
            </div>
          </AdminSection>

          <AdminSection
            title="Commission"
            description="Copied onto every new order at creation. Past orders are never rewritten."
          >
            <div className="adm-panel adm-panel--pad">
              {vendor ? (
                canEditCommission ? (
                  <CommissionEditor vendorId={id} current={vendor.commissionPct} />
                ) : (
                  <div className="adm-row" style={{ alignItems: 'flex-start' }}>
                    <IconLock style={{ width: 16, height: 16, color: 'var(--adm-dim)' }} />
                    <div>
                      <p>
                        Currently <strong className="adm-num">{formatPct(vendor.commissionPct)}</strong>.
                      </p>
                      <p className="adm-section__desc">
                        Editing commission is restricted to super admins. Ask one to change it — the
                        API refuses the request from this account regardless of what this page shows.
                      </p>
                    </div>
                  </div>
                )
              ) : (
                <SkeletonLines count={2} />
              )}
            </div>
          </AdminSection>
        </div>
      </div>

      {/* ---- orders ---- */}
      <AdminSection
        title="Recent orders"
        actions={
          <Link className="adm-btn adm-btn--sm" href={`/admin/orders?vendorId=${id}`}>
            All orders from this vendor
          </Link>
        }
      >
        <div className="adm-panel">
          <div className="adm-feed">
            {(vendor?.recentOrders ?? []).map((order, i) => (
              <Link
                key={order.id}
                href={`/admin/orders/${order.id}`}
                className="adm-feed__item"
                style={{ ['--adm-i' as string]: String(i) }}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="adm-feed__no">{order.orderNo}</span>
                  <span className="adm-feed__meta">
                    {order.customerName} · <RelativeTime value={order.placedAt} live={false} />
                  </span>
                </span>
                <span className="adm-row" style={{ justifyContent: 'flex-end' }}>
                  <StatusPill status={order.status} kind="order" />
                  <Money value={order.totalPaise} />
                </span>
              </Link>
            ))}
            {vendor && vendor.recentOrders.length === 0 ? (
              <EmptyState title="No orders yet" body="This vendor has not taken an order." />
            ) : null}
          </div>
        </div>
      </AdminSection>

      {/* ---- products ---- */}
      <AdminSection title="Catalogue" description="What this vendor currently lists.">
        <DataTable
          columns={productColumns}
          rows={vendor?.products ?? []}
          loading={query.loading && !vendor}
          rowKey={(row) => row.id}
          skeletonRows={6}
        />
      </AdminSection>

      <ConfirmDialog
        open={suspendOpen}
        destructive
        title="Suspend this vendor?"
        confirmLabel="Suspend"
        loading={statusMutation.loading}
        onCancel={() => setSuspendOpen(false)}
        onConfirm={() =>
          void statusMutation.mutate(
            { status: 'suspended' },
            {
              params: { id },
              invalidate: ['/admin/vendors'],
              onSuccess: () => setSuspendOpen(false),
            },
          )
        }
        body={
          <>
            <strong>{vendor?.storeName}</strong> disappears from search and can take no new orders.
            Orders already in flight still have to be fulfilled or refunded.
          </>
        }
      />
    </AdminPage>
  );
}

/* ------------------------------------------------------------------ */

function Tile({
  label,
  value,
  index,
  strong = false,
}: {
  label: string;
  value: number | undefined;
  index: number;
  strong?: boolean;
}) {
  return (
    <article className="adm-tile" style={{ ['--adm-i' as string]: String(index), minHeight: 88 }}>
      <p className="adm-tile__label">{label}</p>
      <p className="adm-tile__value" style={{ fontSize: strong ? '1.4rem' : '1.15rem' }}>
        {value === undefined ? (
          <span className="adm-skel adm-skel--line" style={{ display: 'block', width: '70%' }} />
        ) : (
          <Money value={value} />
        )}
      </p>
    </article>
  );
}

/**
 * Commission, as a number you have to mean.
 *
 * The field starts at the current value and the save button stays disabled
 * until it actually changes, so a stray click on a page someone was only
 * reading cannot write a value. The confirm step spells out what changes and —
 * as importantly — what does not.
 */
function CommissionEditor({ vendorId, current }: { vendorId: string; current: number }) {
  const [draft, setDraft] = useState(String(current));
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setDraft(String(current));
  }, [current]);

  // Commission has its own endpoint, separate from the general vendor PATCH:
  // it is a money-policy change and is gated to SUPER_ADMIN on the server.
  const mutation = useAdminMutation<{ commissionPct: number }, VendorDetail>(
    '/admin/vendors/:id/commission',
    'PATCH',
  );

  const parsed = Number.parseFloat(draft);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 40;
  const changed = valid && Math.abs(parsed - current) > 0.001;

  return (
    <>
      <div className="adm-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="adm-field">
          <label className="adm-field__label" htmlFor="commission">
            Rate
          </label>
          <div className="adm-row">
            <input
              id="commission"
              className="adm-input adm-num"
              type="number"
              min={0}
              max={40}
              step={0.5}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              style={{ width: 90 }}
            />
            <span style={{ color: 'var(--adm-dim)' }}>%</span>
          </div>
        </div>

        <button
          type="button"
          className="adm-btn adm-btn--primary adm-btn--sm"
          disabled={!changed || mutation.loading}
          onClick={() => setConfirming(true)}
        >
          Save
        </button>

        {!valid && draft !== '' ? (
          <span style={{ color: 'var(--crit-ink)', fontSize: 'var(--adm-fs-sm)' }}>
            Must be between 0 and 40.
          </span>
        ) : null}
        {mutation.error ? (
          <span style={{ color: 'var(--crit-ink)', fontSize: 'var(--adm-fs-sm)' }}>
            {mutation.error.friendlyMessage}
          </span>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Change the commission rate?"
        confirmLabel={`Set ${formatPct(parsed)}`}
        loading={mutation.loading}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          void mutation.mutate(
            { commissionPct: parsed },
            {
              params: { id: vendorId },
              invalidate: ['/admin/vendors'],
              onSuccess: () => setConfirming(false),
            },
          )
        }
        body={
          <>
            From <strong className="adm-num">{formatPct(current)}</strong> to{' '}
            <strong className="adm-num">{formatPct(parsed)}</strong>, applied to orders placed from
            now on. Orders already in the system keep the rate that was copied onto them at
            creation, so no past settlement changes.
          </>
        }
      />
    </>
  );
}

function SkeletonLines({ count }: { count: number }) {
  return (
    <div className="adm-stack" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <span
          className="adm-skel adm-skel--line"
          key={i}
          style={{ width: `${90 - (i % 4) * 14}%` }}
        />
      ))}
    </div>
  );
}
