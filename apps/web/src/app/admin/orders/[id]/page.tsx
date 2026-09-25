'use client';

/**
 * One order — and above all, ★ the state-machine timeline.
 *
 * ── WHY THE TIMELINE IS THE CENTREPIECE ─────────────────────────────────────
 * Every question anyone brings to this screen is a question about a transition:
 * why is this still PACKING, who cancelled it, when did the rider pick it up,
 * who rejected it and what reason did they give. The order document answers all
 * of that in `statusHistory`, where every transition was appended inside the
 * same transaction as the status write (plan §5.3) — so the list is complete by
 * construction, not best-effort logging.
 *
 * So the timeline is not a decoration above the line items. It is rendered
 * first, at full width, with the actor, their ROLE and the timestamp on every
 * step, and the gap between steps written out — because "accepted in 4 minutes,
 * packed in 40" is the actual finding on a late order.
 *
 * Transitions the state machine allows but that did not happen are shown greyed
 * at the end, so a stuck order reads as stuck rather than as finished.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAdminMutation, useAdminQuery } from '@/hooks';
import { formatDate, formatPct, humanise } from '@/lib/admin/format';
import type { OrderDetail, OrderStatus, OrderStatusEvent } from '@/lib/admin/types';
import {
  AdminPage,
  AdminSection,
  AisleDot,
  ConfirmDialog,
  EmptyState,
  IconAlert,
  Money,
  RelativeTime,
  StatusPill,
} from '@/components/admin';

/**
 * The machine, mirrored from `orders/state-machine.ts` on the API.
 *
 * The backend is the only authority — it rejects anything not on this map with
 * a 409. This copy exists purely so the UI can show what COULD happen next
 * without asking. If the two ever disagree, the API is right.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED: ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PACKING', 'CANCELLED'],
  PACKING: ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'READY_FOR_PICKUP'],
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED: ['ASSIGNED', 'CANCELLED'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
};

const TERMINAL: ReadonlySet<OrderStatus> = new Set(['DELIVERED', 'REJECTED', 'CANCELLED']);

const ROLE_LABEL: Record<OrderStatusEvent['byRole'], string> = {
  admin: 'admin',
  vendor: 'vendor',
  customer: 'customer',
  delivery: 'rider',
  system: 'system',
};

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const query = useAdminQuery<OrderDetail>(`/admin/orders/${id}`, undefined, {
    enabled: id !== '',
    // A live order moves while you read it.
    refreshMs: 20_000,
  });
  const order = query.data;

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const cancelMutation = useAdminMutation<{ reason: string }, OrderDetail>(
    '/admin/orders/:id/cancel',
    'PATCH',
  );

  const cancellable = order ? !TERMINAL.has(order.status) : false;

  if (!query.loading && !order) {
    return (
      <AdminPage
        title="Order not found"
        description="No order with this id, or it is outside what your account may see."
        breadcrumbs={[{ label: 'Orders', href: '/admin/orders' }, { label: 'Not found' }]}
      >
        <div className="adm-panel">
          <EmptyState
            title="Nothing here"
            body={query.error?.friendlyMessage ?? 'The record could not be loaded.'}
            action={
              <Link className="adm-btn" href="/admin/orders">
                Back to orders
              </Link>
            }
          />
        </div>
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title={order?.orderNo ?? 'Loading…'}
      description={
        order
          ? `${order.vendorName} → ${order.customerName} · placed ${formatDate(order.placedAt, 'long')}`
          : 'Fetching the order.'
      }
      isFixture={query.isFixture}
      fixturePaths={query.isFixture ? [`/admin/orders/${id}`] : undefined}
      breadcrumbs={[{ label: 'Orders', href: '/admin/orders' }, { label: order?.orderNo ?? id }]}
      actions={
        order ? (
          <>
            <StatusPill status={order.status} kind="order" />
            {cancellable ? (
              <button
                type="button"
                className="adm-btn adm-btn--sm adm-btn--danger"
                onClick={() => setCancelOpen(true)}
              >
                Cancel order
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      {/* ★ ------------------------------------------- timeline ---- */}
      <AdminSection
        title="State machine"
        description="Every transition the backend recorded, with who made it and when. Appended in the same transaction as the status write, so nothing is missing."
      >
        <div className="adm-panel adm-panel--pad">
          {order ? (
            <Timeline order={order} />
          ) : (
            <div className="adm-stack">
              {Array.from({ length: 5 }, (_, i) => (
                <span className="adm-skel adm-skel--row" key={i} />
              ))}
            </div>
          )}
        </div>
      </AdminSection>

      <div className="adm-grid adm-grid--split" style={{ marginBottom: 'var(--s-5)' }}>
        {/* ---- line items ---- */}
        <AdminSection title="Items" description={`${order?.items.length ?? 0} lines.`}>
          <div className="adm-tablewrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" data-align="right">
                    Qty
                  </th>
                  <th scope="col" data-align="right">
                    Unit price
                  </th>
                  <th scope="col" data-align="right">
                    Line total
                  </th>
                  <th scope="col" data-align="center">
                    Fulfilled
                  </th>
                </tr>
              </thead>
              <tbody>
                {(order?.items ?? []).map((line, i) => (
                  <tr key={line.productId} style={{ ['--adm-i' as string]: String(i) }}>
                    <td>
                      <span className="adm-row">
                        <AisleDot aisleKey={line.aisleKey} />
                        <span style={{ minWidth: 0 }}>
                          {line.name}
                          <span className="adm-table__sub">{line.unit}</span>
                        </span>
                      </span>
                    </td>
                    <td data-align="right" className="is-num">
                      {line.qty}
                    </td>
                    <td data-align="right">
                      <Money value={line.pricePaise} />
                    </td>
                    <td data-align="right">
                      <Money value={line.lineTotalPaise} />
                    </td>
                    <td data-align="center">
                      {line.fulfilled ? (
                        <StatusPill status="fulfilled" kind="user" />
                      ) : (
                        /* Partial fulfilment auto-refunds the removed line
                           (plan §1, decision 9) — so an unfulfilled line here
                           is money that has already gone back. */
                        <StatusPill status="refunded" kind="payment" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminSection>

        {/* ---- pricing ---- */}
        <AdminSection title="Pricing" description="Including the commission split.">
          <div className="adm-panel adm-panel--pad">
            {order ? (
              <div className="adm-price">
                <span className="adm-price__label">Items subtotal</span>
                <Money value={order.pricing.itemsSubtotalPaise} />

                <span className="adm-price__label">Discount</span>
                <Money value={-order.pricing.discountPaise} />

                <span className="adm-price__label">Delivery fee</span>
                <Money value={order.pricing.deliveryFeePaise} />

                <span className="adm-price__label">Taxes</span>
                <Money value={order.pricing.taxesPaise} />

                <span className="adm-price__rule" />

                <span className="adm-price__total">Customer pays</span>
                <span className="adm-price__total">
                  <Money value={order.pricing.grandTotalPaise} />
                </span>

                <div className="adm-price__split">
                  <p className="adm-section__desc" style={{ marginBottom: 'var(--s-2)' }}>
                    Commission was snapshotted at{' '}
                    <strong className="adm-num">{formatPct(order.pricing.commissionPct)}</strong>{' '}
                    when the order was created. Changing the vendor&apos;s rate later never rewrites
                    this.
                  </p>
                  <div className="adm-price">
                    <span className="adm-price__label">Platform commission</span>
                    <Money value={order.pricing.commissionAmountPaise} />
                    <span className="adm-price__label">Delivery fee (platform)</span>
                    <Money value={order.pricing.deliveryFeePaise} />
                    <span className="adm-price__rule" />
                    <span className="adm-price__total">Vendor payout</span>
                    <span className="adm-price__total">
                      <Money value={order.pricing.vendorPayoutPaise} />
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="adm-stack">
                {Array.from({ length: 6 }, (_, i) => (
                  <span className="adm-skel adm-skel--line" key={i} />
                ))}
              </div>
            )}
          </div>
        </AdminSection>
      </div>

      {/* ---- payment / rider / address ---- */}
      <div className="adm-grid adm-grid--3">
        <AdminSection title="Payment">
          <div className="adm-panel adm-panel--pad">
            {order ? (
              <dl className="adm-dl">
                <dt>Method</dt>
                <dd>{order.payment.method === 'cod' ? 'Cash on delivery' : 'Online'}</dd>
                <dt>Status</dt>
                <dd>
                  <StatusPill status={order.payment.status} kind="payment" />
                </dd>
                <dt>Provider</dt>
                <dd>{order.payment.provider}</dd>
                <dt>Order ref</dt>
                <dd className="adm-num">{order.payment.providerOrderId ?? '—'}</dd>
                <dt>Payment ref</dt>
                <dd className="adm-num">{order.payment.providerPaymentId ?? '—'}</dd>
                <dt>Paid</dt>
                <dd>
                  {order.payment.paidAt ? (
                    <RelativeTime value={order.payment.paidAt} live={false} />
                  ) : (
                    '—'
                  )}
                </dd>
                {order.payment.refundedAmountPaise > 0 ? (
                  <>
                    <dt>Refunded</dt>
                    <dd>
                      <Money value={order.payment.refundedAmountPaise} />
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <span className="adm-skel adm-skel--row" />
            )}
          </div>
        </AdminSection>

        <AdminSection title="Rider">
          <div className="adm-panel adm-panel--pad">
            {order?.rider ? (
              <dl className="adm-dl">
                <dt>Name</dt>
                <dd>{order.rider.name}</dd>
                <dt>Phone</dt>
                <dd className="adm-num">{order.rider.phone}</dd>
                <dt>Vehicle</dt>
                <dd>{order.rider.vehicleType}</dd>
                <dt>Assigned</dt>
                <dd>
                  <RelativeTime value={order.rider.assignedAt} live={false} />
                </dd>
                <dt>Completed</dt>
                <dd className="adm-num">{order.rider.completedCount}</dd>
                <dt>Rating</dt>
                <dd className="adm-num">{order.rider.rating.toFixed(1)}</dd>
              </dl>
            ) : order ? (
              <p style={{ color: 'var(--adm-dim)' }}>
                No rider assigned yet. Assignment happens when the vendor marks the order ready for
                pickup.
              </p>
            ) : (
              <span className="adm-skel adm-skel--row" />
            )}
          </div>
        </AdminSection>

        <AdminSection title="Delivery address">
          <div className="adm-panel adm-panel--pad">
            {order ? (
              <dl className="adm-dl">
                <dt>Label</dt>
                <dd>{order.address.label}</dd>
                <dt>Address</dt>
                <dd>
                  {order.address.line1}
                  {order.address.line2 ? `, ${order.address.line2}` : ''}, {order.address.city}{' '}
                  <span className="adm-num">{order.address.pincode}</span>
                </dd>
                <dt>Phone</dt>
                <dd className="adm-num">{order.address.phone}</dd>
              </dl>
            ) : (
              <span className="adm-skel adm-skel--row" />
            )}
          </div>
        </AdminSection>
      </div>

      {order?.cancellation ? (
        <AdminSection title="Cancellation">
          <div className="adm-panel adm-panel--pad">
            <p className="adm-row" style={{ alignItems: 'flex-start' }}>
              <IconAlert style={{ width: 16, height: 16, color: 'var(--crit-ink)' }} />
              <span>
                Cancelled by <strong>{order.cancellation.by}</strong>{' '}
                <RelativeTime value={order.cancellation.at} live={false} /> — “
                {order.cancellation.reason}”
              </span>
            </p>
          </div>
        </AdminSection>
      ) : null}

      <ConfirmDialog
        open={cancelOpen}
        destructive
        title="Cancel this order?"
        confirmLabel="Cancel the order"
        cancelLabel="Leave it running"
        loading={cancelMutation.loading}
        onCancel={() => setCancelOpen(false)}
        onConfirm={() =>
          void cancelMutation.mutate(
            { reason: reason.trim() || 'Cancelled by platform admin' },
            {
              params: { id },
              invalidate: ['/admin/orders', '/admin/analytics'],
              onSuccess: () => {
                setCancelOpen(false);
                setReason('');
              },
            },
          )
        }
        body={
          <>
            <p style={{ marginBottom: 'var(--s-3)' }}>
              {order?.payment.status === 'paid'
                ? 'The payment has been captured, so this raises a refund to source — 5 to 7 working days.'
                : 'No payment has been captured, so nothing is refunded.'}{' '}
              The cancellation is written to the audit trail with your name on it.
            </p>
            <div className="adm-field">
              <label className="adm-field__label" htmlFor="cancel-reason">
                Reason (goes to the customer and the vendor)
              </label>
              <input
                id="cancel-reason"
                className="adm-input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Vendor unreachable, stock unavailable…"
              />
            </div>
          </>
        }
      />
    </AdminPage>
  );
}

/* ================================================================== */
/* The timeline                                                        */
/* ================================================================== */

function Timeline({ order }: { order: OrderDetail }) {
  const history = order.statusHistory;

  const nextPossible = useMemo(() => {
    const last = history[history.length - 1]?.to ?? order.status;
    return TRANSITIONS[last] ?? [];
  }, [history, order.status]);

  if (history.length === 0) {
    return <EmptyState title="No transitions recorded" body="This order has no status history." />;
  }

  return (
    <>
      <ol className="adm-timeline">
        {history.map((event, i) => {
          const previous = history[i - 1];
          const gapMs = previous ? Date.parse(event.at) - Date.parse(previous.at) : 0;
          const isLast = i === history.length - 1;
          const tone =
            event.to === 'DELIVERED'
              ? 'good'
              : event.to === 'DELIVERY_FAILED' || event.to === 'REJECTED' || event.to === 'CANCELLED'
                ? 'crit'
                : 'neutral';

          return (
            <li
              className="adm-timeline__item"
              key={`${event.to}-${event.at}-${i}`}
              data-tone={tone}
              data-current={isLast ? 'true' : undefined}
              style={{ ['--adm-i' as string]: String(i) }}
            >
              <span className="adm-timeline__node" aria-hidden="true">
                {i + 1}
              </span>

              <div style={{ minWidth: 0 }}>
                <div className="adm-timeline__head">
                  <span className="adm-timeline__to">{humanise(event.to)}</span>
                  {event.from ? (
                    <span className="adm-timeline__from">
                      {event.from} → {event.to}
                    </span>
                  ) : (
                    <span className="adm-timeline__from">order created</span>
                  )}
                  {isLast && !TERMINAL.has(event.to) ? (
                    <span className="adm-pill" data-tone="info">
                      <span className="adm-pill__glyph" aria-hidden="true" />
                      current
                    </span>
                  ) : null}
                </div>

                <p className="adm-timeline__actor">
                  by <strong>{event.byName}</strong>{' '}
                  <span className="adm-rolepill">{ROLE_LABEL[event.byRole]}</span> ·{' '}
                  <RelativeTime value={event.at} live={false} />{' '}
                  <span style={{ opacity: 0.7 }}>({formatDate(event.at, 'long')})</span>
                  {previous ? <> · {formatGap(gapMs)} after the previous step</> : null}
                </p>

                {event.reason ? <p className="adm-timeline__reason">“{event.reason}”</p> : null}
              </div>
            </li>
          );
        })}

        {/* What the machine would allow next. Greyed, because it has not
            happened — a stuck order must not read as a finished one. */}
        {nextPossible.length > 0 ? (
          <li
            className="adm-timeline__item"
            style={{ ['--adm-i' as string]: String(history.length), opacity: 0.6 }}
          >
            <span className="adm-timeline__node" aria-hidden="true">
              ?
            </span>
            <div>
              <div className="adm-timeline__head">
                <span className="adm-timeline__to">Awaiting the next transition</span>
              </div>
              <p className="adm-timeline__actor">
                The state machine allows:{' '}
                {nextPossible.map((status, i) => (
                  <span key={status}>
                    {i > 0 ? ', ' : ''}
                    <span className="adm-timeline__from">{status}</span>
                  </span>
                ))}
                . Anything else is rejected by the API with a 409.
              </p>
            </div>
          </li>
        ) : null}
      </ol>

      <p className="adm-section__desc" style={{ marginTop: 'var(--s-4)' }}>
        Total elapsed:{' '}
        <strong className="adm-num">
          {formatGap(
            Date.parse(history[history.length - 1]?.at ?? order.placedAt) -
              Date.parse(history[0]?.at ?? order.placedAt),
          )}
        </strong>{' '}
        across {history.length} transitions.
      </p>
    </>
  );
}

/** `formatRelative` says "4 minutes ago"; a gap between two events needs "4m". */
function formatGap(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
