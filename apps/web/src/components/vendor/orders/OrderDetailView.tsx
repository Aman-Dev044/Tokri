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
 * writes the refund, and its answer is the one that reaches the ledger.
 *
 * ── ★ IT IS ITS OWN ENDPOINT ────────────────────────────────────────────────
 * `PATCH /vendor/orders/:id/items` with `{ items, reason? }`, and NOTHING
 * else. This screen used to post the item array to `/status`, where
 * `UpdateOrderStatusDto` accepts `{ status, reason? }` only — with
 * `forbidNonWhitelisted: true` that is a 400, so the lines were never dropped
 * and no refund was ever raised. Re-picking and advancing are two writes
 * because they are two decisions: confirm the bag, then move the order.
 *
 * The reply is `{ order, refundDelta, payoutDelta, droppedLineCount,
 * ledgerEntryId }` — the server's own numbers, which is what the screen shows
 * afterwards rather than continuing to trust its own preview.
 *
 * ── THE TIMELINE ────────────────────────────────────────────────────────────
 * Every transition the backend recorded, with actor and reason (plan §5.3,
 * `statusHistory`). It is the answer to "who cancelled this and when", which is
 * the question that otherwise costs a support agent twenty minutes.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useVendorMutation, useVendorQuery } from '@/hooks';
import { useVendorSession } from '@/lib/vendor/session';
import { formatDate } from '../format';
import { NEXT_STATUS, REJECT_REASONS, STATUS_AISLE, previewFulfilment } from '@/lib/vendor/orders';
import type {
  FulfilmentUpdate,
  OrderStatusUpdate,
  Paged,
  PartialFulfilmentResult,
  VendorOrderDetail,
  VendorPartner,
} from '@/lib/vendor/types';
import { ConfirmDialog } from '../overlay';
import { VenPage, VenSection } from '../Page';
import { Btn, EndpointError, Money, OrderStatusPill, RelativeTime, SkelStat, WriteFailure } from '../primitives';

/** Re-picking is only legal while the order is still in the shop's hands. */
const REPICKABLE = new Set(['ACCEPTED', 'PACKING']);

export function OrderDetailView({ orderId }: { orderId: string }) {
  const path = `/vendor/orders/${orderId}`;
  const order = useVendorQuery<VendorOrderDetail>(path, undefined, { refreshMs: 20_000 });
  // UX only — the API checks orders.update on every write regardless.
  const canUpdate = useVendorSession().can('orders.update');
  const partners = useVendorQuery<Paged<VendorPartner>>(
    '/vendor/delivery-partners',
    { limit: 100 },
    { enabled: canUpdate },
  );

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
  const [dropReason, setDropReason] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [settled, setSettled] = useState<PartialFulfilmentResult | null>(null);

  const advance = useVendorMutation<OrderStatusUpdate, VendorOrderDetail>(
    '/vendor/orders/:id/status',
    'PATCH',
  );
  // Partial fulfilment has its OWN endpoint. Items never ride on /status.
  const repick = useVendorMutation<FulfilmentUpdate, PartialFulfilmentResult>(
    '/vendor/orders/:id/items',
    'PATCH',
  );
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
      <VenPage
        title="Order"
        description="This order could not be loaded."
        breadcrumbs={[{ label: 'Orders', href: '/vendor/orders' }, { label: orderId }]}
      >
        <EndpointError
          path={path}
          message={order.error.friendlyMessage}
          status={order.error.status}
          onRetry={order.refetch}
        />
      </VenPage>
    );
  }

  const data = order.data;

  if (!data || !kept || !preview) {
    return (
      <VenPage
        title="Order"
        description="Loading the order…"
        breadcrumbs={[{ label: 'Orders', href: '/vendor/orders' }, { label: orderId }]}
      >
        <div className="ven-stack" aria-busy="true">
          <SkelStat />
        </div>
      </VenPage>
    );
  }

  const invalidate = ['/vendor/orders'] as const;
  const nextStatus = NEXT_STATUS[data.status];
  const changed = preview.droppedCount > 0;
  // The API refuses a re-pick outside ACCEPTED/PACKING with a 409, so the
  // checkboxes go read-only at exactly the point the server stops listening.
  const canRepick = REPICKABLE.has(data.status);
  const customerName = data.customer.name ?? 'Customer';
  const customerPhone = data.customer.phone;

  const toggleLine = (productId: string) => {
    setKept((previous) => {
      const next = new Set(previous ?? []);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  /**
   * Two separate writes, in the order that keeps the money right.
   *
   * The re-pick goes first: it is the one that raises the refund and rewrites
   * the totals, and a status move that happened before it would push the order
   * past the window in which the API still accepts an item change. If the
   * re-pick fails, the status is left alone — an order marked READY over lines
   * the shop cannot supply is worse than one that did not move.
   */
  const submitFulfilment = async () => {
    setFailure(null);

    if (changed) {
      const result = await repick.mutate(
        {
          items: data.items.map((item) => ({
            productId: item.productId,
            fulfilled: kept.has(item.productId),
          })),
          // The DTO validates 3–300 characters, so a blank note is omitted
          // rather than sent as an empty string that would be a 400.
          ...(dropReason.trim().length >= 3 ? { reason: dropReason.trim() } : {}),
        },
        {
          params: { id: data.id },
          invalidate,
          onError: (error) => setFailure(error.friendlyMessage),
        },
      );
      if (result === null) return;
      setSettled(result);
    }

    if (!nextStatus) {
      setDialog(null);
      order.refetch();
      return;
    }

    await advance.mutate(
      { status: nextStatus },
      {
        params: { id: data.id },
        invalidate,
        onSuccess: () => setDialog(null),
        onError: (error) => setFailure(error.friendlyMessage),
      },
    );
  };

  const availablePartners = (partners.data?.data ?? []).filter(
    (partner) => partner.status === 'active' && partner.isOnline && partner.isAvailable,
  );

  return (
    <VenPage
      title={data.orderNo}
      description={`${customerName} · placed ${data.placedAt === null ? 'at an unrecorded time' : formatDate(data.placedAt, 'long')}`}
      breadcrumbs={[{ label: 'Orders', href: '/vendor/orders' }, { label: data.orderNo }]}
      isFixture={order.isFixture || partners.isFixture}
      fixturePaths={[order.isFixture ? path : null, partners.isFixture ? '/vendor/delivery-partners' : null].filter(
        (value): value is string => value !== null,
      )}
      actions={
        <div className="ven-row">
          <OrderStatusPill status={data.status} />
          {canUpdate && data.status === 'PLACED' ? (
            <>
              <Btn
                variant="primary"
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
              </Btn>
              <Btn variant="danger" onClick={() => setDialog('reject')}>
                Reject
              </Btn>
            </>
          ) : null}
          {canUpdate && (nextStatus || (canRepick && changed)) ? (
            <Btn variant="primary" onClick={() => setDialog('confirm')}>
              {!nextStatus
                ? 'Confirm the short order'
                : nextStatus === 'PACKING'
                  ? 'Start packing'
                  : 'Confirm items & mark ready'}
            </Btn>
          ) : null}
          {canUpdate && data.status === 'READY_FOR_PICKUP' ? (
            <Btn onClick={() => setDialog('assign')}>Assign rider</Btn>
          ) : null}
        </div>
      }
    >
      {failure ? <WriteFailure message={failure} /> : null}

      <div className="ven-cols-2">
        <div className="ven-stack">
          <VenSection
            title="Items"
            description={
              data.status === 'DELIVERED' || data.status === 'REJECTED' || data.status === 'CANCELLED'
                ? 'This order is closed. The lines are shown as they were fulfilled.'
                : canRepick
                  ? 'Untick anything you cannot supply. The totals below recompute before you confirm.'
                  : 'Lines can only be re-picked while the order is accepted or packing. This one has moved on.'
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
                        disabled={!canRepick}
                      />
                      <span className="ven-sr">
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
                The customer will be refunded about <Money value={preview.refundDelta} /> when you
                confirm. Nothing has been sent yet — the server recomputes the exact figure.
              </p>
            ) : null}

            {settled ? (
              <p className="ven-note" style={{ marginTop: 'var(--s-3)' }} role="status">
                <strong>Settled by the server.</strong> {settled.droppedLineCount}{' '}
                {settled.droppedLineCount === 1 ? 'line' : 'lines'} dropped, refund{' '}
                <Money value={settled.refundDelta} />, your payout down by{' '}
                <Money value={settled.payoutDelta} />.
                {settled.ledgerEntryId === null
                  ? ' No ledger entry was needed.'
                  : ' A ledger entry was written.'}
              </p>
            ) : null}
          </VenSection>

          <VenSection title="Status history" description="Every transition the server recorded.">
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
                      {event.at === null ? 'time unrecorded' : formatDate(event.at, 'long')} · by{' '}
                      {event.byRole ?? 'the system'}
                    </p>
                    {event.reason ? <p className="ven-tl__reason">“{event.reason}”</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </VenSection>
        </div>

        <div className="ven-stack">
          <VenSection title="Money" description="Recomputed live as you untick lines.">
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
          </VenSection>

          <VenSection title="Customer">
            <div className="ven-panel ven-panel--pad">
              <dl className="ven-dl">
                <dt>Name</dt>
                <dd>{customerName}</dd>
                <dt>Phone</dt>
                <dd>
                  {customerPhone === null ? (
                    'not on file'
                  ) : (
                    <a href={`tel:${customerPhone}`}>{customerPhone}</a>
                  )}
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
                  {data.payment.method === 'cod' ? 'Cash on delivery' : 'Paid online'} ·{' '}
                  {data.payment.status}
                  {data.payment.refundedAmount > 0 ? (
                    <>
                      {' '}
                      · refunded <Money value={data.payment.refundedAmount} />
                    </>
                  ) : null}
                </dd>
                <dt>Placed</dt>
                <dd>
                  {data.placedAt === null ? '—' : <RelativeTime value={data.placedAt} />}
                </dd>
                {data.deliveryPartner?.name ? (
                  <>
                    <dt>Rider</dt>
                    <dd>{data.deliveryPartner.name}</dd>
                  </>
                ) : null}
              </dl>

              {data.cancellation?.reason ? (
                <p className="ven-note" style={{ marginTop: 'var(--s-3)' }}>
                  <strong>
                    {data.status === 'REJECTED' ? 'Rejected' : 'Cancelled'} by{' '}
                    {data.cancellation.by ?? 'the platform'}:
                  </strong>{' '}
                  {data.cancellation.reason}
                </p>
              ) : null}
            </div>
          </VenSection>

          <Link className="ven-btn" data-variant="plain" data-size="md" href="/vendor/orders">
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
        loading={advance.loading || repick.loading}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          void submitFulfilment();
        }}
        body={
          changed ? (
            <div className="ven-stack">
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
                The customer is notified and the refund is raised by the server, which recomputes
                these figures itself — the numbers above are this screen&rsquo;s preview. Your payout
                drops to about <Money value={preview.vendorPayout} />.
              </p>
              <div className="ven-field">
                <label className="ven-field__label" htmlFor="ven-drop-reason">
                  Why are these lines missing? (optional, 3–300 characters)
                </label>
                <textarea
                  id="ven-drop-reason"
                  className="ven-textarea"
                  value={dropReason}
                  onChange={(event) => setDropReason(event.target.value)}
                  maxLength={300}
                />
              </div>
            </div>
          ) : (
            <p>
              All {data.items.length} lines are going in the bag. The order moves to{' '}
              {nextStatus ?? 'the next stage'} and the customer is told.
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
    </VenPage>
  );
}
