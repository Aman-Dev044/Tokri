'use client';

/**
 * One order, in full — and the screen where a short order gets resolved.
 *
 * ── ★ PARTIAL FULFILMENT ────────────────────────────────────────────────────
 * The single most valuable thing on this screen. The onions ran out between the
 * order landing and the bag being packed. Without this, the vendor's options
 * are: reject the whole order (customer loses everything), or send it short and
 * let support deal with the refund next week.
 *
 * Instead: untick the line. The totals recompute IN FRONT OF THEM — new
 * subtotal, new commission, new payout, and the refund the customer will
 * receive — and only then is there something to confirm. Nobody should ever
 * discover the size of a refund in a settlement report three days later.
 *
 * The arithmetic lives in `lib/vendor/orders.ts → previewFulfilment`, which
 * documents why the discount scales and the delivery fee does not. It is a
 * PREVIEW: the server recomputes the same figures inside the transaction that
 * writes the status, and its answer is the one that reaches the ledger.
 *
 * ── THE TIMELINE ────────────────────────────────────────────────────────────
 * Every transition the backend recorded, with actor and reason (plan §5.3,
 * `statusHistory`). It is the answer to "who cancelled this and when", which is
 * the question that otherwise costs a support agent twenty minutes.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  Money,
  RelativeTime,
  StatusPill,
} from '@/components/admin';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import { formatDate } from '@/lib/admin/format';
import { NEXT_STATUS, REJECT_REASONS, STATUS_AISLE, previewFulfilment } from '@/lib/vendor/orders';
import type { OrderStatus, VendorOrderDetail, VendorPartner } from '@/lib/vendor/types';
import { EndpointError } from '../primitives';

export function OrderDetailView({ orderId }: { orderId: string }) {
  const path = `/vendor/orders/${orderId}`;
  const order = useVendorQuery<VendorOrderDetail>(path, undefined, { refreshMs: 20_000 });
  const partners = useVendorQuery<VendorPartner[]>('/vendor/delivery-partners');

  /* ---- which lines are still going in the bag ---- */
  const [kept, setKept] = useState<ReadonlySet<string> | null>(null);

  // Seeded from the server's own `fulfilled` flags, and re-seeded if the order
  // is refetched — the API is the authority on what was already dropped.
  useEffect(() => {
    if (!order.data) return;
    setKept(
      new Set(
        order.data.items.filter((item) => item.fulfilled).map((item) => item.productId),
      ),
    );
  }, [order.data]);

  const [dialog, setDialog] = useState<'confirm' | 'reject' | 'assign' | null>(null);
  const [reason, setReason] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const advance = useVendorMutation<
    { status: OrderStatus; items?: Array<{ productId: string; fulfilled: boolean }> },
    VendorOrderDetail
  >('/vendor/orders/:id/status', 'PATCH');
  const accept = useVendorMutation<{ etaMinutes?: number }, VendorOrderDetail>(
    '/vendor/orders/:id/accept',
    'PATCH',
  );
  const reject = useVendorMutation<{ reason: string }, VendorOrderDetail>(
    '/vendor/orders/:id/reject',
    'PATCH',
  );
  const assign = useVendorMutation<{ partnerId: string }, VendorOrderDetail>(
    '/vendor/orders/:id/assign',
    'POST',
  );

  const preview = useMemo(() => {
    if (!order.data || !kept) return null;
    return previewFulfilment(order.data.items, order.data.pricing, kept);
  }, [order.data, kept]);

  if (order.error && !order.data) {
    return (
      <AdminPage
        title="Order"
        description="This order could not be loaded."
        breadcrumbs={[{ label: 'Orders', href: '/vendor/orders' }, { label: orderId }]}
      >
        <EndpointError
          path={path}
          message={order.error.friendlyMessage}
          onRetry={order.refetch}
        />
      </AdminPage>
    );
  }

  const data = order.data;

  if (!data || !kept || !preview) {
    return (
      <AdminPage
        title="Order"
        description="Loading the order…"
        breadcrumbs={[{ label: 'Orders', href: '/vendor/orders' }, { label: orderId }]}
      >
        <div className="adm-stack" aria-busy="true">
          <div className="adm-skel adm-skel--tile" />
          <div className="adm-skel adm-skel--chart" />
        </div>
      </AdminPage>
    );
  }

  const invalidate = ['/vendor/orders'] as const;
  const nextStatus = NEXT_STATUS[data.status];
  const changed = preview.droppedCount > 0;

  const toggleLine = (productId: string) => {
    setKept((previous) => {
      const next = new Set(previous ?? []);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const submitFulfilment = () => {
    if (!nextStatus) return;
    setFailure(null);
    void advance.mutate(
      {
        status: nextStatus,
        items: data.items.map((item) => ({
          productId: item.productId,
          fulfilled: kept.has(item.productId),
        })),
      },
      {
        params: { id: data.id },
        invalidate,
        onSuccess: () => setDialog(null),
        onError: (error) => setFailure(error.friendlyMessage),
      },
    );
  };

  const availablePartners = (partners.data ?? []).filter(
    (partner) => partner.isOnline && partner.isAvailable,
  );

  return (
    <AdminPage
      title={data.orderNo}
      description={`${data.customerName} · placed ${formatDate(data.placedAt, 'long')}`}
      breadcrumbs={[{ label: 'Orders', href: '/vendor/orders' }, { label: data.orderNo }]}
      isFixture={order.isFixture || partners.isFixture}
      fixturePaths={[order.isFixture ? path : null, partners.isFixture ? '/vendor/delivery-partners' : null].filter(
        (value): value is string => value !== null,
      )}
      actions={
        <div className="adm-row">
          <StatusPill status={data.status} kind="order" />
          {data.status === 'PLACED' ? (
            <>
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                disabled={accept.loading}
                onClick={() => {
                  setFailure(null);
                  void accept.mutate(
                    {},
                    {
                      params: { id: data.id },
                      invalidate,
                      onError: (error) => setFailure(error.friendlyMessage),
                    },
                  );
                }}
              >
                Accept
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--danger"
                onClick={() => setDialog('reject')}
              >
                Reject
              </button>
            </>
          ) : null}
          {nextStatus ? (
            <button
              type="button"
              className="adm-btn adm-btn--primary"
              onClick={() => setDialog('confirm')}
            >
              {nextStatus === 'PACKING' ? 'Start packing' : 'Confirm items & mark ready'}
            </button>
          ) : null}
          {data.status === 'READY_FOR_PICKUP' ? (
            <button type="button" className="adm-btn" onClick={() => setDialog('assign')}>
              Assign rider
            </button>
          ) : null}
        </div>
      }
    >
      {failure ? (
        <div className="adm-fixture" role="alert" style={{ marginBottom: 'var(--s-3)' }}>
          <div>
            <p className="adm-fixture__title">That did not go through</p>
            <p className="adm-fixture__body">{failure}</p>
          </div>
        </div>
      ) : null}

      <div className="adm-grid adm-grid--split">
        <div className="adm-stack">
          <AdminSection
            title="Items"
            description={
              data.status === 'DELIVERED' || data.status === 'REJECTED' || data.status === 'CANCELLED'
                ? 'This order is closed. The lines are shown as they were fulfilled.'
                : 'Untick anything you cannot supply. The totals below recompute before you confirm.'
            }
          >
            <div className="ven-lines">
              {data.items.map((item) => {
                const on = kept.has(item.productId);
                return (
                  <div className="ven-line" key={item.productId} data-kept={on ? 'true' : 'false'}>
                    <label className="ven-check">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleLine(item.productId)}
                        disabled={!nextStatus}
                      />
                      <span className="adm-sr">
                        {on ? 'Included' : 'Dropped'} — {item.name}
                      </span>
                    </label>
                    <span>
                      <span className="ven-line__name">{item.name}</span>
                      <br />
                      <span className="ven-line__unit">{item.unit}</span>
                    </span>
                    <span className="ven-line__qty">{item.qty}×</span>
                    <Money value={item.lineTotal} />
                  </div>
                );
              })}
            </div>

            {changed ? (
              <p className="ven-note" style={{ marginTop: 'var(--s-3)' }}>
                {preview.droppedCount} {preview.droppedCount === 1 ? 'line' : 'lines'} dropped.{' '}
                The customer will be refunded <Money value={preview.refundDelta} /> when you
                confirm. Nothing has been sent yet.
              </p>
            ) : null}
          </AdminSection>

          <AdminSection title="Status history" description="Every transition the server recorded.">
            <div className="ven-timeline">
              {data.statusHistory.map((event, index) => (
                <div
                  className="ven-tl"
                  key={`${event.to}-${event.at}-${index}`}
                  data-aisle={STATUS_AISLE[event.to]}
                >
                  <span
                    className="ven-tl__dot"
                    data-current={index === data.statusHistory.length - 1 ? 'true' : undefined}
                    aria-hidden="true"
                  />
                  <div>
                    <p className="ven-tl__to">
                      {event.from ? `${event.from} → ` : ''}
                      {event.to}
                    </p>
                    <p className="ven-tl__meta">
                      {formatDate(event.at, 'long')} · by {event.byName ?? event.byRole} (
                      {event.byRole})
                    </p>
                    {event.reason ? <p className="ven-tl__reason">“{event.reason}”</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </AdminSection>
        </div>

        <div className="adm-stack">
          <AdminSection title="Money" description="Recomputed live as you untick lines.">
            <div className="ven-sum">
              <span className="ven-sum__label">Items</span>
              <span className="ven-sum__value">
                <Money value={preview.itemsSubtotal} />
              </span>

              <span className="ven-sum__label">Discount</span>
              <span className="ven-sum__value">
                <Money value={-preview.discount} />
              </span>

              <span className="ven-sum__label">Delivery</span>
              <span className="ven-sum__value">
                <Money value={preview.deliveryFee} />
              </span>

              <span className="ven-sum__label">Taxes</span>
              <span className="ven-sum__value">
                <Money value={preview.taxes} />
              </span>

              <span className="ven-sum__rule" />

              <span className="ven-sum__label ven-sum__total">Customer pays</span>
              <span className="ven-sum__value ven-sum__total">
                <Money value={preview.grandTotal} />
              </span>

              {changed ? (
                <>
                  <span className="ven-sum__label ven-sum__refund">Refund to customer</span>
                  <span className="ven-sum__value ven-sum__refund">
                    <Money value={preview.refundDelta} />
                  </span>
                </>
              ) : null}

              <span className="ven-sum__rule" />

              <span className="ven-sum__label">
                Commission ({preview.commissionPct}% — fixed when the order was placed)
              </span>
              <span className="ven-sum__value">
                <Money value={-preview.commissionAmount} />
              </span>

              <span className="ven-sum__label ven-sum__total">You receive</span>
              <span className="ven-sum__value ven-sum__total">
                <Money value={preview.vendorPayout} />
              </span>
            </div>
          </AdminSection>

          <AdminSection title="Customer" panel>
            <div className="adm-panel--pad">
              <dl className="adm-dl">
                <dt>Name</dt>
                <dd>{data.customerName}</dd>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:${data.customerPhone}`}>{data.customerPhone}</a>
                </dd>
                <dt>Address</dt>
                <dd>
                  {data.address.line1}
                  {data.address.line2 ? `, ${data.address.line2}` : ''}
                  <br />
                  {data.address.city} {data.address.pincode}
                </dd>
                <dt>Payment</dt>
                <dd>
                  {data.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'} ·{' '}
                  {data.paymentStatus}
                </dd>
                <dt>Placed</dt>
                <dd>
                  <RelativeTime value={data.placedAt} />
                </dd>
                {data.partnerName ? (
                  <>
                    <dt>Rider</dt>
                    <dd>{data.partnerName}</dd>
                  </>
                ) : null}
              </dl>

              {data.note ? (
                <p className="ven-note" style={{ marginTop: 'var(--s-3)' }}>
                  <strong>Note from the customer:</strong> {data.note}
                </p>
              ) : null}
            </div>
          </AdminSection>

          <Link className="adm-btn" href="/vendor/orders">
            Back to the board
          </Link>
        </div>
      </div>

      {/* ------------------------------------- confirm fulfilment ---- */}
      <ConfirmDialog
        open={dialog === 'confirm'}
        title={changed ? 'Confirm a short order' : `Move to ${nextStatus ?? ''}`}
        confirmLabel={changed ? 'Confirm and refund' : 'Confirm'}
        destructive={changed}
        loading={advance.loading}
        onCancel={() => setDialog(null)}
        onConfirm={submitFulfilment}
        body={
          changed ? (
            <div className="adm-stack">
              <p>
                {preview.droppedCount} of {data.items.length} lines will be dropped.
              </p>
              <div className="ven-sum">
                <span className="ven-sum__label">Was</span>
                <span className="ven-sum__value">
                  <Money value={data.pricing.grandTotal} />
                </span>
                <span className="ven-sum__label">Now</span>
                <span className="ven-sum__value">
                  <Money value={preview.grandTotal} />
                </span>
                <span className="ven-sum__rule" />
                <span className="ven-sum__label ven-sum__refund">Refund</span>
                <span className="ven-sum__value ven-sum__refund">
                  <Money value={preview.refundDelta} />
                </span>
              </div>
              <p>
                The customer is notified and the refund is raised by the server. Your payout drops
                to <Money value={preview.vendorPayout} />.
              </p>
            </div>
          ) : (
            <p>
              All {data.items.length} lines are going in the bag. The order moves to{' '}
              {nextStatus ?? ''} and the customer is told.
            </p>
          )
        }
      />

      {/* ------------------------------------------------- reject ---- */}
      <ConfirmDialog
        open={dialog === 'reject'}
        destructive
        title={`Reject ${data.orderNo}?`}
        confirmLabel="Reject order"
        loading={reject.loading}
        confirmDisabled={reason.trim() === ''}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setFailure(null);
          void reject.mutate(
            { reason: reason.trim() },
            {
              params: { id: data.id },
              invalidate,
              onSuccess: () => setDialog(null),
              onError: (error) => setFailure(error.friendlyMessage),
            },
          );
        }}
        body={
          <div className="ven-form">
            <p>
              A reason is required — it is what the customer is shown. If only some lines are
              missing, close this and untick them instead: a short order still gets them most of
              their shopping.
            </p>
            <div className="ven-field">
              <label className="ven-field__label" htmlFor="ven-detail-reason">
                Reason
              </label>
              <select
                id="ven-detail-reason"
                className="ven-select"
                value={REJECT_REASONS.includes(reason) ? reason : ''}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="">Choose a reason…</option>
                {REJECT_REASONS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
              </select>
            </div>
            <div className="ven-field">
              <label className="ven-field__label" htmlFor="ven-detail-reason-note">
                Or write your own
              </label>
              <textarea
                id="ven-detail-reason-note"
                className="ven-textarea"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={240}
              />
            </div>
          </div>
        }
      />

      {/* ------------------------------------------------- assign ---- */}
      <ConfirmDialog
        open={dialog === 'assign'}
        title={`Assign a rider to ${data.orderNo}`}
        confirmLabel="Assign"
        loading={assign.loading}
        confirmDisabled={partnerId === ''}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          setFailure(null);
          void assign.mutate(
            { partnerId },
            {
              params: { id: data.id },
              invalidate,
              onSuccess: () => setDialog(null),
              onError: (error) => setFailure(error.friendlyMessage),
            },
          );
        }}
        body={
          availablePartners.length === 0 ? (
            <p>None of your riders are online and free right now.</p>
          ) : (
            <div className="ven-field">
              <label className="ven-field__label" htmlFor="ven-detail-partner">
                Rider
              </label>
              <select
                id="ven-detail-partner"
                className="ven-select"
                value={partnerId}
                onChange={(event) => setPartnerId(event.target.value)}
              >
                <option value="">Choose a rider…</option>
                {availablePartners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name} · {partner.vehicleType}
                  </option>
                ))}
              </select>
            </div>
          )
        }
      />
    </AdminPage>
  );
}
