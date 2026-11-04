'use client';

/**
 * One vendor: who they are, where they are, what they sell, what they have sold.
 *
 * ── THREE ENDPOINTS, EACH READ IN ITS OWN SHAPE ─────────────────────────────
 *   GET /admin/vendors/:id           -> VendorDetail   (the row + `owner`)
 *   GET /admin/vendors/:id/orders    -> Paginated<VendorOrderRow>
 *   GET /admin/vendors/:id/products  -> Paginated<VendorProductRow>
 *   GET /admin/vendors/:id/staff     -> VendorStaffRow[]   (read-only)
 *
 * This page was first written against one fixture that bundled all three —
 * plus an `earnings` block with commission, refunds and net payable that no
 * endpoint computes. Against the live API `vendor.earnings.grossPaise` threw
 * on the first render. What the vendor row actually measures is lifetime GMV
 * and order count, so that is what the top of the page shows; what a vendor
 * is OWED comes from the ledger, and the ledger's screen is Settlements. A
 * "net payable" tile here would have been a number nobody computed.
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
import type {
  Paginated,
  VendorDetail,
  VendorOrderRow,
  VendorProductRow,
  VendorStaffRow,
} from '@/lib/admin/types';
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

/** `openingHours[].day` is `Date#getDay()`: 0 is Sunday. */
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const RECENT_ORDERS = 6;
const PRODUCTS_PER_PAGE = 20;

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

  // Newest first is the service's default order, so no `sort` is sent.
  const orders = useAdminQuery<Paginated<VendorOrderRow>>(
    `/admin/vendors/${id}/orders`,
    { limit: RECENT_ORDERS },
    { enabled: id !== '' },
  );

  const [productPage, setProductPage] = useState(1);
  const products = useAdminQuery<Paginated<VendorProductRow>>(
    `/admin/vendors/${id}/products`,
    { page: productPage, limit: PRODUCTS_PER_PAGE },
    { enabled: id !== '' },
  );

  // The store's employees. Read-only here: staff are the owner's to manage.
  const staff = useAdminQuery<VendorStaffRow[]>(`/admin/vendors/${id}/staff`, undefined, {
    enabled: id !== '',
  });

  const staffColumns: Column<VendorStaffRow>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        render: (row) => (
          <span style={{ minWidth: 0 }}>
            {row.name}
            <span className="adm-table__sub">
              {row.phone}
              {row.email ? ` · ${row.email}` : ''}
            </span>
          </span>
        ),
      },
      {
        key: 'staffRole',
        header: 'Role',
        render: (row) => (
          <span>
            {row.staffRole.charAt(0) + row.staffRole.slice(1).toLowerCase()}
            {row.shiftLabel ? <span className="adm-table__sub">{row.shiftLabel}</span> : null}
          </span>
        ),
      },
      {
        key: 'permissions',
        header: 'Permissions',
        render: (row) => <span className="adm-table__sub">{row.permissions.join(', ')}</span>,
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => <StatusPill status={row.status} kind="user" />,
      },
      {
        key: 'lastLoginAt',
        header: 'Last sign-in',
        render: (row) =>
          row.lastLoginAt ? <RelativeTime value={row.lastLoginAt} live={false} /> : '—',
      },
    ],
    [],
  );

  const [suspendOpen, setSuspendOpen] = useState(false);
  // `UpdateVendorStatusDto` REQUIRES a reason to suspend (3-500 characters).
  // The vendor will ask why, and support will ask who.
  const [suspendReason, setSuspendReason] = useState('');
  const statusMutation = useAdminMutation<{ status: string; reason?: string }, VendorDetail>(
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
            {row.aisleKey ? <AisleDot aisleKey={row.aisleKey} /> : null}
            <span style={{ minWidth: 0 }}>
              {row.name}
              <span className="adm-table__sub">{row.sku}</span>
            </span>
          </span>
        ),
      },
      {
        key: 'price',
        header: 'Price',
        align: 'right',
        render: (row) => <Money value={row.price} />,
      },
      {
        key: 'mrp',
        header: 'MRP',
        align: 'right',
        render: (row) => <Money value={row.mrp} />,
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
                  : row.isLowStock
                    ? 'var(--warn-ink)'
                    : undefined,
            }}
            title={
              row.isLowStock
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

  const isFixture = query.isFixture || orders.isFixture || products.isFixture;
  const orderRows = orders.data?.data ?? [];
  const closeSuspend = () => {
    setSuspendOpen(false);
    setSuspendReason('');
  };

  return (
    <AdminPage
      title={vendor?.storeName ?? 'Loading…'}
      description={
        vendor
          ? [
              vendor.owner?.name ?? 'Owner account missing',
              vendor.address.city,
              vendor.createdAt ? `joined ${formatDate(vendor.createdAt, 'long')}` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : 'Fetching the vendor record.'
      }
      isFixture={isFixture}
      fixturePaths={
        isFixture
          ? [`/admin/vendors/${id}`, `/admin/vendors/${id}/orders`, `/admin/vendors/${id}/products`]
          : undefined
      }
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
                disabled={statusMutation.loading}
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
      {/* ---- sales ---- */}
      <AdminSection
        title="Sales"
        description="Lifetime, excluding cancelled and rejected orders."
        actions={
          <Link className="adm-btn adm-btn--sm" href="/admin/settlements">
            Settlements
          </Link>
        }
      >
        <div className="adm-kpirow">
          <Tile label="Gross merchandise value" value={vendor?.gmv} kind="money" index={0} strong />
          <Tile label="Orders" value={vendor?.orderCount} kind="count" index={1} />
        </div>
        <p className="adm-section__desc" style={{ marginTop: 'var(--s-2)' }}>
          GMV is what customers paid, delivery fee included. What this vendor is owed after
          commission and refunds is worked out from the ledger, period by period, on Settlements.
        </p>
      </AdminSection>

      <div className="adm-grid adm-grid--2" style={{ marginBottom: 'var(--s-5)' }}>
        {/* ---- profile ---- */}
        <AdminSection title="Profile">
          <div className="adm-panel adm-panel--pad">
            {vendor ? (
              <>
                {vendor.description ? (
                  <p style={{ marginBottom: 'var(--s-3)' }}>{vendor.description}</p>
                ) : null}
                <dl className="adm-dl">
                  <dt>Slug</dt>
                  <dd className="adm-num">{vendor.slug}</dd>
                  <dt>Owner</dt>
                  <dd>
                    {vendor.owner ? (
                      <>
                        {vendor.owner.name}
                        {vendor.owner.email ? (
                          <span className="adm-table__sub">{vendor.owner.email}</span>
                        ) : null}
                      </>
                    ) : (
                      <span style={{ color: 'var(--adm-dim)' }}>
                        No account found for this store&apos;s owner
                      </span>
                    )}
                  </dd>
                  <dt>Phone</dt>
                  <dd className="adm-num">{vendor.owner?.phone ?? '—'}</dd>
                  <dt>Address</dt>
                  <dd>
                    {[vendor.address.line1, vendor.address.line2, vendor.address.city, vendor.address.state]
                      .filter(Boolean)
                      .join(', ')}{' '}
                    <span className="adm-num">{vendor.address.pincode}</span>
                  </dd>
                  <dt>Coordinates</dt>
                  <dd className="adm-row">
                    {vendor.location ? (
                      <>
                        <IconPin style={{ width: 14, height: 14, color: 'var(--adm-dim)' }} />
                        {/* Printed lat,lng because that is what every map tool
                            expects pasted in. The API names the two fields, so
                            there is no array order to get backwards. */}
                        <span className="adm-num">
                          {vendor.location.lat.toFixed(5)}, {vendor.location.lng.toFixed(5)}
                        </span>
                        <span className="adm-table__sub" style={{ display: 'inline' }}>
                          lat, lng
                        </span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--adm-dim)' }}>Not set</span>
                    )}
                  </dd>
                  <dt>Radius</dt>
                  <dd className="adm-num">{vendor.serviceRadiusKm} km</dd>
                  <dt>Cash on delivery</dt>
                  <dd>
                    {vendor.codEnabled ? (
                      <>
                        Enabled, capped at <Money value={vendor.codMaxAmount} />
                      </>
                    ) : (
                      'Disabled'
                    )}
                  </dd>
                  <dt>Shutter</dt>
                  <dd>{vendor.isOpen ? 'Open for orders' : 'Closed'}</dd>
                  {vendor.statusReason ? (
                    <>
                      <dt>Status note</dt>
                      <dd>{vendor.statusReason}</dd>
                    </>
                  ) : null}
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
                vendor.openingHours.length > 0 ? (
                  <dl className="adm-dl">
                    {vendor.openingHours.map((slot, i) => (
                      <span key={`${slot.day}-${i}`} style={{ display: 'contents' }}>
                        <dt>{DAY_NAMES[slot.day] ?? `Day ${slot.day}`}</dt>
                        <dd className="adm-num">
                          {slot.open} – {slot.close}
                        </dd>
                      </span>
                    ))}
                  </dl>
                ) : (
                  <p className="adm-section__desc">
                    The owner has not set opening hours. The store takes orders whenever its shutter
                    is open.
                  </p>
                )
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
            {orderRows.map((order, i) => (
              <Link
                key={order.id}
                href={`/admin/orders/${order.id}`}
                className="adm-feed__item"
                style={{ ['--adm-i' as string]: String(i) }}
              >
                <span style={{ minWidth: 0 }}>
                  <span className="adm-feed__no">{order.orderNo}</span>
                  <span className="adm-feed__meta">
                    {order.customerName ?? 'Customer account removed'} ·{' '}
                    <RelativeTime value={order.placedAt} live={false} />
                  </span>
                </span>
                <span className="adm-row" style={{ justifyContent: 'flex-end' }}>
                  <StatusPill status={order.status} kind="order" />
                  <Money value={order.pricing.grandTotal} />
                </span>
              </Link>
            ))}
            {orders.loading && !orders.hasLoadedOnce ? <SkeletonLines count={3} /> : null}
            {orders.error ? (
              <EmptyState title="Orders could not be loaded" body={orders.error.friendlyMessage} />
            ) : orders.data && orderRows.length === 0 ? (
              <EmptyState title="No orders yet" body="This vendor has not taken an order." />
            ) : null}
          </div>
        </div>
      </AdminSection>

      {/* ---- staff (read-only) ---- */}
      <AdminSection
        title="Staff"
        description="Accounts the owner has created to run this store, and what each may do. Managed by the store, not from here."
      >
        <div className="adm-panel">
          {staff.error ? (
            <EmptyState title="Staff could not be loaded" body={staff.error.friendlyMessage} />
          ) : (
            <DataTable
              columns={staffColumns}
              rows={staff.data ?? []}
              loading={staff.loading && !staff.hasLoadedOnce}
              rowKey={(row) => row.id}
              skeletonRows={3}
              empty={<EmptyState title="No staff" body="Only the owner signs in to this store." />}
            />
          )}
        </div>
      </AdminSection>

      {/* ---- products ---- */}
      <AdminSection
        title="Catalogue"
        description={
          products.data
            ? `${formatCount(products.data.meta.total)} products, listed or not.`
            : 'What this vendor currently lists.'
        }
      >
        {products.error ? (
          <div className="adm-panel">
            <EmptyState title="Catalogue could not be loaded" body={products.error.friendlyMessage} />
          </div>
        ) : (
          <DataTable
            columns={productColumns}
            rows={products.data?.data ?? []}
            loading={products.loading && !products.hasLoadedOnce}
            rowKey={(row) => row.id}
            skeletonRows={6}
            page={products.data?.meta.page ?? productPage}
            pageCount={products.data?.meta.pages ?? 1}
            total={products.data?.meta.total}
            onPageChange={setProductPage}
          />
        )}
      </AdminSection>

      <ConfirmDialog
        open={suspendOpen}
        destructive
        title="Suspend this vendor?"
        confirmLabel="Suspend"
        loading={statusMutation.loading}
        // The API refuses a suspension without a reason; this only saves the
        // operator from finding that out through a 400.
        confirmDisabled={suspendReason.trim().length < 3}
        onCancel={closeSuspend}
        onConfirm={() =>
          void statusMutation.mutate(
            { status: 'suspended', reason: suspendReason.trim() },
            {
              params: { id },
              invalidate: ['/admin/vendors'],
              onSuccess: closeSuspend,
            },
          )
        }
        body={
          <>
            <p>
              <strong>{vendor?.storeName}</strong> disappears from search and can take no new
              orders. Orders already in flight still have to be fulfilled or refunded.
            </p>
            <label className="adm-field">
              <span className="adm-field__label">Reason</span>
              <input
                className="adm-input"
                value={suspendReason}
                onChange={(event) => setSuspendReason(event.target.value)}
                maxLength={500}
                placeholder="Repeated short-picked orders, expired licence…"
                disabled={statusMutation.loading}
              />
            </label>
            <p className="adm-section__desc">
              Stored on the vendor and in the audit log. The owner will ask why.
            </p>
            {statusMutation.error ? (
              <p style={{ color: 'var(--crit-ink)' }}>{statusMutation.error.friendlyMessage}</p>
            ) : null}
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
  kind,
  index,
  strong = false,
}: {
  label: string;
  value: number | undefined;
  /** money is INTEGER PAISE and goes through <Money>; a count does not */
  kind: 'money' | 'count';
  index: number;
  strong?: boolean;
}) {
  return (
    <article className="adm-tile" style={{ ['--adm-i' as string]: String(index), minHeight: 88 }}>
      <p className="adm-tile__label">{label}</p>
      <p className="adm-tile__value" style={{ fontSize: strong ? '1.4rem' : '1.15rem' }}>
        {value === undefined ? (
          <span className="adm-skel adm-skel--line" style={{ display: 'block', width: '70%' }} />
        ) : kind === 'money' ? (
          <Money value={value} />
        ) : (
          <span className="adm-num">{formatCount(value)}</span>
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
