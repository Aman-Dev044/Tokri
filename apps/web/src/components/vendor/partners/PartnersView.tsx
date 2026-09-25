'use client';

/**
 * The shop's own riders.
 *
 * A vendor with two scooters of their own does not want the platform pool for
 * a 400-metre delivery, and the pool does not want it either. These are the
 * partners that belong to THIS store (plan §5.1: `DeliveryPartner.vendorId`),
 * and the only question this screen answers in a hurry is: who is free right
 * now.
 *
 * So the list is sorted by availability, not alphabetically. The rider you can
 * hand an order to is at the top; the one who went home is at the bottom.
 *
 * ── THE PASSWORD FIELD ──────────────────────────────────────────────────────
 * Creating a rider creates a login (`role=delivery`). The password is sent once
 * and never read back — the API stores an argon2id hash with a pepper from the
 * environment (plan §4.1) and there is no endpoint that returns it. The form
 * says so, because a vendor who assumes they can look it up later will not
 * write it down. `CreatePartnerDto` requires 12–128 characters and a phone of
 * exactly ten digits, and the form enforces both before it lets you submit.
 *
 * ── ★ THE VENDOR CANNOT MARK A RIDER FREE OR BUSY ───────────────────────────
 * This screen used to offer a "Mark busy / Mark free" button pointed at
 * `PATCH /vendor/delivery-partners/:id`, whose DTO accepts `{ name, email,
 * vehicleType }` and nothing else — so the write was a 400 every time.
 *
 * That is not an oversight in the API, it is the design. `isAvailable` is
 * owned by the rider's own app and by the assignment transaction: a vendor who
 * could flip it by hand would be able to mark a rider free while they are
 * mid-delivery, and the next assignment would hand them a second order.
 *
 * What a vendor genuinely controls is the rider's ADMINISTRATIVE state, and
 * that has a real endpoint: `PATCH /vendor/delivery-partners/:id/status` with
 * `{ status, reason? }`. Suspending moves the rider's User account with it, so
 * a suspended rider cannot simply keep using their existing token.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  DataTable,
  DetailDrawer,
  EmptyState,
  IconInbox,
  IconPlus,
  RelativeTime,
  type Column,
} from '@/components/admin';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import type {
  Paged,
  PartnerDraft,
  PartnerStatusUpdate,
  VehicleType,
  VendorOrder,
  VendorPartner,
} from '@/lib/vendor/types';
import { EndpointError, Field } from '../primitives';

/** Exactly the `VehicleType` enum the API validates against. */
const VEHICLES: readonly VehicleType[] = ['bicycle', 'scooter', 'motorcycle', 'ev_scooter'];

const VEHICLE_LABEL: Record<VehicleType, string> = {
  bicycle: 'Bicycle',
  scooter: 'Scooter',
  motorcycle: 'Motorcycle',
  ev_scooter: 'Electric scooter',
};

/** `CreatePartnerDto` — 12 characters minimum, and it means it. */
const MIN_PASSWORD = 12;

const EMPTY_DRAFT: PartnerDraft = {
  name: '',
  phone: '',
  vehicleType: 'scooter',
  password: '',
};

/** Free and online first, then online-but-busy, then offline, suspended last. */
function rank(partner: VendorPartner): number {
  if (partner.status === 'suspended') return 4;
  if (partner.status === 'pending') return 3;
  if (partner.isOnline && partner.isAvailable) return 0;
  if (partner.isOnline) return 1;
  return 2;
}

export function PartnersView() {
  // Paginated, like every other vendor list except categories.
  const partners = useVendorQuery<Paged<VendorPartner>>(
    '/vendor/delivery-partners',
    { limit: 100 },
    { refreshMs: 30_000 },
  );
  // `status` is a single enum value, which is all this query needs.
  const ready = useVendorQuery<Paged<VendorOrder>>('/vendor/orders', {
    status: 'READY_FOR_PICKUP',
    limit: 20,
  });

  const create = useVendorMutation<PartnerDraft, VendorPartner>(
    '/vendor/delivery-partners',
    'POST',
  );
  const setStatus = useVendorMutation<PartnerStatusUpdate, VendorPartner>(
    '/vendor/delivery-partners/:id/status',
    'PATCH',
  );
  const assign = useVendorMutation<{ partnerId: string }, VendorOrder>(
    '/vendor/orders/:id/assign',
    'POST',
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState<PartnerDraft>(EMPTY_DRAFT);
  const [assigning, setAssigning] = useState<VendorPartner | null>(null);
  const [orderId, setOrderId] = useState('');

  const rows = useMemo(() => {
    const list = [...(partners.data?.data ?? [])];
    // `name` is nullable on the wire — a rider whose User record was removed
    // still has a partner row, and `null.localeCompare` is a crash.
    list.sort((a, b) => rank(a) - rank(b) || (a.name ?? '').localeCompare(b.name ?? ''));
    return list;
  }, [partners.data]);

  const readyOrders = ready.data?.data ?? [];

  const columns: Column<VendorPartner>[] = [
    {
      key: 'name',
      header: 'Rider',
      render: (row) => (
        <span>
          <strong>{row.name ?? 'Unnamed rider'}</strong>
          <br />
          <span className="adm-dim">
            {row.phone === null ? 'no phone on file' : <a href={`tel:${row.phone}`}>{row.phone}</a>}{' '}
            · {VEHICLE_LABEL[row.vehicleType]}
          </span>
        </span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      render: (row) => {
        if (row.status !== 'active') {
          return (
            <span
              className="adm-pill"
              data-tone={row.status === 'suspended' ? 'crit' : 'warn'}
              title={row.statusReason ?? undefined}
            >
              <span className="adm-pill__glyph" aria-hidden="true" />
              {row.status === 'suspended' ? 'Suspended' : 'Pending'}
            </span>
          );
        }
        const tone = row.isOnline ? (row.isAvailable ? 'good' : 'warn') : 'neutral';
        const word = row.isOnline ? (row.isAvailable ? 'Free' : 'On a delivery') : 'Offline';
        return (
          <span className="adm-pill" data-tone={tone}>
            <span className="adm-pill__glyph" aria-hidden="true" />
            {word}
          </span>
        );
      },
    },
    {
      key: 'activeOrderId',
      header: 'Current order',
      numeric: true,
      // The API sends the order id only — it does not join the order number,
      // and inventing one from the id would print a number that does not exist.
      render: (row) =>
        row.activeOrderId ? (
          <Link href={`/vendor/orders/${row.activeOrderId}`}>Open order</Link>
        ) : (
          '—'
        ),
    },
    { key: 'completedCount', header: 'Delivered', align: 'right', numeric: true },
    {
      key: 'rating',
      header: 'Rating',
      align: 'right',
      numeric: true,
      render: (row) => row.rating.toFixed(1),
    },
    {
      key: 'locationAt',
      header: 'Last seen',
      render: (row) =>
        row.locationAt === null ? <span>never</span> : <RelativeTime value={row.locationAt} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <span className="adm-row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="adm-btn adm-btn--sm"
            disabled={
              row.status !== 'active' ||
              !row.isOnline ||
              !row.isAvailable ||
              readyOrders.length === 0
            }
            onClick={() => {
              setAssigning(row);
              setOrderId(readyOrders[0]?.id ?? '');
            }}
            title={
              row.status !== 'active'
                ? `This rider is ${row.status}`
                : !row.isOnline
                  ? 'This rider is offline'
                  : !row.isAvailable
                    ? 'Already on a delivery'
                    : readyOrders.length === 0
                      ? 'No packed orders waiting'
                      : 'Hand a packed order to this rider'
            }
          >
            Assign
          </button>
          {/*
            Administrative state, not the availability toggle — see the note at
            the top of this file. `isAvailable` belongs to the rider's app and
            to the assignment transaction, and there is no endpoint that lets a
            vendor set it by hand.
          */}
          <button
            type="button"
            className="adm-btn adm-btn--sm adm-btn--ghost"
            // Mid-delivery is the one moment suspension is the wrong answer:
            // it would strand an order that is already in a customer's street.
            disabled={setStatus.loading || row.activeOrderId !== null}
            title={
              row.activeOrderId !== null
                ? 'This rider is mid-delivery — suspending them now would strand the order'
                : row.status === 'suspended'
                  ? 'Let this rider sign in and take orders again'
                  : 'Stop this rider signing in and taking orders'
            }
            onClick={() =>
              void setStatus.mutate(
                row.status === 'suspended'
                  ? { status: 'active' }
                  : { status: 'suspended', reason: 'Suspended by the store' },
                { params: { id: row.id }, invalidate: ['/vendor/delivery-partners'] },
              )
            }
          >
            {row.status === 'suspended' ? 'Reinstate' : 'Suspend'}
          </button>
        </span>
      ),
    },
  ];

  const fixturePaths = [
    partners.isFixture ? '/vendor/delivery-partners' : null,
    ready.isFixture ? '/vendor/orders' : null,
  ].filter((value): value is string => value !== null);

  const freeCount = rows.filter(
    (row) => row.status === 'active' && row.isOnline && row.isAvailable,
  ).length;

  return (
    <AdminPage
      title="Delivery partners"
      description="Your own riders. Sorted by who you can hand an order to right now, not alphabetically."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={
        <button
          type="button"
          className="adm-btn adm-btn--primary"
          onClick={() => {
            setDraft(EMPTY_DRAFT);
            create.reset();
            setDrawerOpen(true);
          }}
        >
          <IconPlus />
          Add rider
        </button>
      }
    >
      {partners.error && partners.data === null ? (
        <EndpointError
          path="/vendor/delivery-partners"
          message={partners.error.friendlyMessage}
          status={partners.error.status}
          onRetry={partners.refetch}
        />
      ) : null}

      <AdminSection
        description={
          freeCount === 0
            ? `No riders are free. ${readyOrders.length} packed ${readyOrders.length === 1 ? 'order is' : 'orders are'} waiting for a pickup.`
            : `${freeCount} free · ${readyOrders.length} packed ${readyOrders.length === 1 ? 'order' : 'orders'} waiting.`
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          loading={partners.loading && !partners.hasLoadedOnce}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              title="No riders yet"
              body="Add your own riders here, or leave deliveries to the platform pool."
              icon={<IconInbox />}
            />
          }
        />
      </AdminSection>

      {/* -------------------------------------------- new rider ---- */}
      <DetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Add a rider"
        subtitle="This creates a delivery login for the Mandi rider app"
        width="min(520px, 96vw)"
        actions={
          <>
            <span className="adm-toolbar__spacer" />
            <button type="button" className="adm-btn" onClick={() => setDrawerOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="adm-btn adm-btn--primary"
              disabled={
                create.loading ||
                draft.name.trim() === '' ||
                !/^\d{10}$/.test(draft.phone.trim()) ||
                draft.password.length < MIN_PASSWORD
              }
              onClick={() =>
                void create.mutate(draft, {
                  invalidate: ['/vendor/delivery-partners'],
                  onSuccess: () => {
                    setDrawerOpen(false);
                    setDraft(EMPTY_DRAFT);
                  },
                })
              }
            >
              {create.loading ? 'Creating…' : 'Create rider'}
            </button>
          </>
        }
      >
        <div className="ven-form">
          {create.error ? (
            <p className="ven-field__error" role="alert">
              {create.error.friendlyMessage}
            </p>
          ) : null}

          <Field label="Name">
            {(id) => (
              <input
                id={id}
                className="ven-input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                maxLength={80}
              />
            )}
          </Field>

          <Field
            label="Phone"
            hint="Exactly ten digits — this is also the rider's username."
            error={
              draft.phone !== '' && !/^\d{10}$/.test(draft.phone.trim())
                ? 'Ten digits, no spaces and no country code.'
                : undefined
            }
          >
            {(id) => (
              <input
                id={id}
                className="ven-input"
                type="tel"
                inputMode="numeric"
                value={draft.phone}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                maxLength={10}
              />
            )}
          </Field>

          <Field label="Vehicle">
            {(id) => (
              <select
                id={id}
                className="ven-select"
                value={draft.vehicleType}
                onChange={(event) =>
                  setDraft({ ...draft, vehicleType: event.target.value as VehicleType })
                }
              >
                {VEHICLES.map((vehicle) => (
                  <option key={vehicle} value={vehicle}>
                    {VEHICLE_LABEL[vehicle]}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="First password"
            hint="At least 12 characters. Write it down and give it to them now — it is hashed on the server and there is no screen, anywhere, that can show it to you again."
            error={
              draft.password !== '' && draft.password.length < MIN_PASSWORD
                ? `Too short — ${MIN_PASSWORD} characters minimum.`
                : undefined
            }
          >
            {(id) => (
              <input
                id={id}
                className="ven-input"
                type="text"
                autoComplete="off"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
              />
            )}
          </Field>

          <p className="ven-note">
            The rider signs in to the delivery app with this phone and password. They can see the
            orders assigned to them and nothing else — the same guard chain that scopes your data
            to this shop scopes theirs to their own deliveries.
          </p>
        </div>
      </DetailDrawer>

      {/* ---------------------------------------------- assign ---- */}
      <ConfirmDialog
        open={assigning !== null}
        title={`Give an order to ${assigning?.name ?? 'this rider'}`}
        confirmLabel="Assign"
        loading={assign.loading}
        confirmDisabled={orderId === ''}
        onCancel={() => setAssigning(null)}
        onConfirm={() => {
          if (!assigning || orderId === '') return;
          void assign.mutate(
            { partnerId: assigning.id },
            {
              params: { id: orderId },
              invalidate: ['/vendor/orders', '/vendor/delivery-partners'],
              onSuccess: () => setAssigning(null),
            },
          );
        }}
        body={
          <div className="ven-field">
            <label className="ven-field__label" htmlFor="ven-ready-order">
              Packed order
            </label>
            <select
              id="ven-ready-order"
              className="ven-select"
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
            >
              <option value="">Choose an order…</option>
              {readyOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNo} · {order.customer.name ?? 'Customer'} · {order.itemCount} items
                </option>
              ))}
            </select>
          </div>
        }
      />
    </AdminPage>
  );
}
