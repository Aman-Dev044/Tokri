'use client';

/**
 * ★ THE BOARD — the money screen.
 *
 * Three lanes, left to right, in the order work moves: New → Preparing →
 * Ready. Everything past Ready belongs to the rider, and putting it here would
 * fill the screen a vendor works from with rows they cannot act on.
 *
 * ── WHY LANES AND NOT A TABLE ───────────────────────────────────────────────
 * The question this screen answers is "what do I do next", and the answer is
 * positional: the leftmost lane is the one with a customer waiting on it. A
 * sortable table answers "what happened", which is what the history section at
 * the bottom is for.
 *
 * ── ACCEPT AND REJECT ───────────────────────────────────────────────────────
 * Accept takes an OPTIONAL ETA — a shop that knows it is 40 minutes deep should
 * be able to say so, and one that is not sure should not be forced to invent a
 * number that becomes a broken promise.
 *
 * Reject REQUIRES a reason (plan §6.2: `{ reason }`). The customer is about to
 * be told their order is not happening and "rejected" on its own is the worst
 * possible version of that message. The server validates the field too — this
 * dialog is convenience, not validation.
 *
 * ── ONE REQUEST, SPLIT HERE ─────────────────────────────────────────────────
 * `ListOrdersQueryDto.status` is `@IsEnum(OrderStatus)` — ONE status, or none
 * at all. This board used to send `?status=PLACED,ACCEPTED,PACKING,…`, which
 * is a hard 400 rather than a multi-select. So the board asks for the recent
 * page unfiltered and sorts the rows into lanes in the browser: three lanes
 * and a closed list out of a single response, instead of two requests one of
 * which could never succeed.
 *
 * ── POLLING ─────────────────────────────────────────────────────────────────
 * Every 15 seconds, paused while the tab is hidden, with the age of the data
 * printed on screen. See <FreshLine/>: a board that silently stops polling
 * looks exactly like a quiet evening.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFreshness, useVendorMutation, useVendorQuery } from '@/hooks';
import { useVendorSession } from '@/lib/vendor/session';
import {
  CLOSED_STATUSES,
  LANES,
  LANE_AISLE,
  NEXT_STATUS,
  REJECT_REASONS,
  groupByLane,
  type LaneKey,
} from '@/lib/vendor/orders';
import type {
  OrderStatus,
  Paged,
  VendorOrder,
  VendorOrderDetail,
  VendorPartner,
} from '@/lib/vendor/types';
import { IconInbox } from '../icons';
import { ConfirmDialog } from '../overlay';
import { VenPage, VenSection } from '../Page';
import {
  Btn,
  EmptyState,
  EndpointError,
  FreshLine,
  Money,
  OrderStatusPill,
  RelativeTime,
  WriteFailure,
} from '../primitives';
import { VenTable, type Column } from '../table';
import { ORDER_POLL_MS, useVendorAlerts } from '../VendorAlertProvider';
import { OrderCard, OrderCardSkeleton } from '../OrderCard';

/** One page of the board. `PaginationQueryDto` hard-caps `limit` at 100. */
const BOARD_LIMIT = 100;

/** How many closed orders the history table keeps on screen. */
const HISTORY_LIMIT = 12;

/** One interval for the whole board, rather than one timer per card. */
function useNow(everyMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

type DialogState =
  | { kind: 'accept'; order: VendorOrder }
  | { kind: 'reject'; order: VendorOrder }
  | { kind: 'assign'; order: VendorOrder }
  | null;

export function OrdersView() {
  const now = useNow(20_000);
  const { freshIds, acknowledge } = useVendorAlerts();

  // One unfiltered page, split below. `status` takes a single value, so a
  // multi-status board has to be assembled here rather than asked for.
  const board = useVendorQuery<Paged<VendorOrder>>(
    '/vendor/orders',
    { limit: BOARD_LIMIT, sort: '-placedAt' },
    { refreshMs: ORDER_POLL_MS },
  );

  // UX only — the API checks orders.update on every write regardless.
  const canUpdate = useVendorSession().can('orders.update');

  // `/vendor/delivery-partners` is PAGINATED — `{ data, meta }`, not an array.
  // Only fetched for someone who can actually assign a rider.
  const partners = useVendorQuery<Paged<VendorPartner>>(
    '/vendor/delivery-partners',
    { limit: 100 },
    { enabled: canUpdate },
  );

  const freshness = useFreshness(board.marker, ORDER_POLL_MS * 2.5);

  const rows = useMemo(() => board.data?.data ?? [], [board.data]);
  const lanes = useMemo(() => groupByLane(rows), [rows]);
  const history = useMemo(
    () => rows.filter((order) => CLOSED_STATUSES.includes(order.status)).slice(0, HISTORY_LIMIT),
    [rows],
  );

  const [dialog, setDialog] = useState<DialogState>(null);
  const [eta, setEta] = useState('');
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  // Every one of these returns the full `OrderDetail`, not the list row.
  const accept = useVendorMutation<{ etaMinutes?: number }, VendorOrderDetail>(
    '/vendor/orders/:id/accept',
    'PATCH',
  );
  const reject = useVendorMutation<{ reason: string }, VendorOrderDetail>(
    '/vendor/orders/:id/reject',
    'PATCH',
  );
  const advance = useVendorMutation<{ status: OrderStatus }, VendorOrderDetail>(
    '/vendor/orders/:id/status',
    'PATCH',
  );
  const assign = useVendorMutation<{ partnerId: string }, VendorOrderDetail>(
    '/vendor/orders/:id/assign',
    'POST',
  );

  const closeDialog = () => {
    setDialog(null);
    setEta('');
    setReason('');
    setReasonNote('');
    setPartnerId('');
  };

  const invalidate = ['/vendor/orders'] as const;

  const onAccept = () => {
    if (dialog?.kind !== 'accept') return;
    const minutes = Number.parseInt(eta, 10);
    setFailure(null);
    void accept.mutate(
      Number.isFinite(minutes) && minutes > 0 ? { etaMinutes: minutes } : {},
      {
        params: { id: dialog.order.id },
        invalidate,
        onSuccess: closeDialog,
        onError: (error) => setFailure(error.friendlyMessage),
      },
    );
  };

  const onReject = () => {
    if (dialog?.kind !== 'reject') return;
    const finalReason = reason === 'other' ? reasonNote.trim() : reason;
    if (finalReason === '') return;
    setFailure(null);
    void reject.mutate(
      { reason: finalReason },
      {
        params: { id: dialog.order.id },
        invalidate,
        onSuccess: closeDialog,
        onError: (error) => setFailure(error.friendlyMessage),
      },
    );
  };

  const onAssign = () => {
    if (dialog?.kind !== 'assign' || partnerId === '') return;
    setFailure(null);
    void assign.mutate(
      { partnerId },
      {
        params: { id: dialog.order.id },
        invalidate,
        onSuccess: closeDialog,
        onError: (error) => setFailure(error.friendlyMessage),
      },
    );
  };

  const onAdvance = (order: VendorOrder) => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    setFailure(null);
    void advance.mutate(
      { status: next },
      {
        params: { id: order.id },
        invalidate,
        onError: (error) => setFailure(error.friendlyMessage),
      },
    );
  };

  // A suspended or still-pending rider cannot take an order — the API answers
  // 409 — so offering them here would only manufacture a failed write.
  const availablePartners = (partners.data?.data ?? []).filter(
    (partner) => partner.status === 'active' && partner.isOnline && partner.isAvailable,
  );

  const fixturePaths = [
    board.isFixture ? '/vendor/orders' : null,
    partners.isFixture ? '/vendor/delivery-partners' : null,
  ].filter((value): value is string => value !== null);

  return (
    <VenPage
      title="Orders"
      description="Accept, pack and hand over. The leftmost lane is the one with a customer waiting on it."
      isFixture={fixturePaths.length > 0}
      fixturePaths={fixturePaths}
      actions={
        <div className="ven-row">
          <FreshLine freshness={freshness} everyMs={ORDER_POLL_MS} onRefresh={board.refetch} />
          {freshIds.size > 0 ? (
            <Btn size="sm" onClick={acknowledge}>
              Clear {freshIds.size} new {freshIds.size === 1 ? 'mark' : 'marks'}
            </Btn>
          ) : null}
        </div>
      }
    >
      {failure ? <WriteFailure message={failure} /> : null}

      {board.error && board.data === null ? (
        <EndpointError
          path="/vendor/orders"
          message={board.error.friendlyMessage}
          status={board.error.status}
          onRetry={board.refetch}
        />
      ) : null}

      <div className="ven-board" role="list" aria-label="Order lanes">
        {LANES.map((lane) => (
          <Lane
            key={lane.key}
            laneKey={lane.key}
            title={lane.title}
            hint={lane.hint}
            orders={lanes[lane.key]}
            loading={board.loading && !board.hasLoadedOnce}
            now={now}
            freshIds={freshIds}
            renderActions={(order) => {
              if (!canUpdate) {
                return (
                  <Link className="ven-btn" data-variant="plain" data-size="sm" href={`/vendor/orders/${order.id}`}>
                    Open
                  </Link>
                );
              }

              if (order.status === 'PLACED') {
                return (
                  <>
                    <Btn variant="primary" size="sm" onClick={() => setDialog({ kind: 'accept', order })}>
                      Accept
                    </Btn>
                    <Btn size="sm" onClick={() => setDialog({ kind: 'reject', order })}>
                      Reject
                    </Btn>
                  </>
                );
              }

              if (order.status === 'ACCEPTED' || order.status === 'PACKING') {
                const next = NEXT_STATUS[order.status];
                return (
                  <>
                    <Btn variant="primary" size="sm" onClick={() => onAdvance(order)} disabled={advance.loading}>
                      {next === 'PACKING' ? 'Start packing' : 'Mark ready'}
                    </Btn>
                    <Link className="ven-btn" data-variant="plain" data-size="sm" href={`/vendor/orders/${order.id}`}>
                      Open
                    </Link>
                  </>
                );
              }

              if (order.status === 'READY_FOR_PICKUP') {
                return (
                  <>
                    <Btn variant="primary" size="sm" onClick={() => setDialog({ kind: 'assign', order })}>
                      Assign rider
                    </Btn>
                    <Link className="ven-btn" data-variant="plain" data-size="sm" href={`/vendor/orders/${order.id}`}>
                      Open
                    </Link>
                  </>
                );
              }

              return (
                <Link className="ven-btn" data-variant="plain" data-size="sm" href={`/vendor/orders/${order.id}`}>
                  Open{' '}
                  {order.deliveryPartner?.name ? `· ${order.deliveryPartner.name}` : ''}
                </Link>
              );
            }}
          />
        ))}
      </div>

      <VenSection
        title="Recently closed"
        description="Delivered, rejected and cancelled. Here so the board above stays about what still needs doing."
      >
        <HistoryTable rows={history} loading={board.loading && !board.hasLoadedOnce} />
      </VenSection>

      {/* ---------------------------------------------- accept ---- */}
      <ConfirmDialog
        open={dialog?.kind === 'accept'}
        title={`Accept ${dialog?.order.orderNo ?? ''}?`}
        confirmLabel="Accept order"
        loading={accept.loading}
        onCancel={closeDialog}
        onConfirm={onAccept}
        body={
          <div className="ven-form">
            <p>
              The customer is told immediately. {dialog?.order.customer.name ?? 'The customer'}{' '}
              ordered {dialog?.order.itemCount}{' '}
              {dialog?.order.itemCount === 1 ? 'item' : 'items'} worth{' '}
              {dialog ? <Money value={dialog.order.grandTotal} /> : null}.
            </p>
            <div className="ven-field">
              <label className="ven-field__label" htmlFor="ven-eta">
                How long until it is ready? (optional)
              </label>
              <input
                id="ven-eta"
                className="ven-input"
                data-num="true"
                type="number"
                min={1}
                max={240}
                placeholder="minutes"
                value={eta}
                onChange={(event) => setEta(event.target.value)}
              />
              <span className="ven-field__hint">
                Leave it blank if you are not sure. A promise you miss is worse than no promise.
              </span>
            </div>
          </div>
        }
      />

      {/* ---------------------------------------------- reject ---- */}
      <ConfirmDialog
        open={dialog?.kind === 'reject'}
        destructive
        title={`Reject ${dialog?.order.orderNo ?? ''}?`}
        confirmLabel="Reject order"
        loading={reject.loading}
        confirmDisabled={reason === '' || (reason === 'other' && reasonNote.trim() === '')}
        onCancel={closeDialog}
        onConfirm={onReject}
        body={
          <div className="ven-form">
            <p>
              This cannot be undone, and the customer is refunded in full if they have already
              paid. A reason is required — it is what they will be shown.
            </p>
            <div className="ven-field">
              <label className="ven-field__label" htmlFor="ven-reason">
                Reason
              </label>
              <select
                id="ven-reason"
                className="ven-select"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="">Choose a reason…</option>
                {REJECT_REASONS.map((preset) => (
                  <option key={preset} value={preset}>
                    {preset}
                  </option>
                ))}
                <option value="other">Something else…</option>
              </select>
            </div>
            {reason === 'other' ? (
              <div className="ven-field">
                <label className="ven-field__label" htmlFor="ven-reason-note">
                  Tell the customer what happened
                </label>
                <textarea
                  id="ven-reason-note"
                  className="ven-textarea"
                  value={reasonNote}
                  onChange={(event) => setReasonNote(event.target.value)}
                  maxLength={240}
                />
              </div>
            ) : null}
          </div>
        }
      />

      {/* ---------------------------------------------- assign ---- */}
      <ConfirmDialog
        open={dialog?.kind === 'assign'}
        title={`Assign a rider to ${dialog?.order.orderNo ?? ''}`}
        confirmLabel="Assign"
        loading={assign.loading}
        confirmDisabled={partnerId === ''}
        onCancel={closeDialog}
        onConfirm={onAssign}
        body={
          <div className="ven-form">
            {availablePartners.length === 0 ? (
              <p>
                None of your riders are online and free right now. You can still hand the order to
                the platform pool from the order screen, or wait for one to come back on.
              </p>
            ) : (
              <div className="ven-field">
                <label className="ven-field__label" htmlFor="ven-partner">
                  Rider
                </label>
                <select
                  id="ven-partner"
                  className="ven-select"
                  value={partnerId}
                  onChange={(event) => setPartnerId(event.target.value)}
                >
                  <option value="">Choose a rider…</option>
                  {availablePartners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name ?? 'Rider'} · {partner.vehicleType} ·{' '}
                      {partner.completedCount} deliveries
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        }
      />
    </VenPage>
  );
}

/* ================================================================== */
/* Lane                                                                */
/* ================================================================== */

function Lane({
  laneKey,
  title,
  hint,
  orders,
  loading,
  now,
  freshIds,
  renderActions,
}: {
  laneKey: LaneKey;
  title: string;
  hint: string;
  orders: VendorOrder[];
  loading: boolean;
  now: number | null;
  freshIds: ReadonlySet<string>;
  renderActions: (order: VendorOrder) => React.ReactNode;
}) {
  return (
    <section
      className="ven-lane"
      data-aisle={LANE_AISLE[laneKey]}
      aria-label={`${title} — ${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`}
      role="listitem"
    >
      <header className="ven-lane__head">
        <h2 className="ven-lane__title">{title}</h2>
        <span className="ven-lane__count">{orders.length}</span>
        <span className="ven-lane__hint">{hint}</span>
      </header>

      <div className="ven-lane__body">
        {loading ? (
          <>
            <OrderCardSkeleton index={0} />
            <OrderCardSkeleton index={1} />
          </>
        ) : orders.length === 0 ? (
          <EmptyState
            tight
            title={laneKey === 'new' ? 'Nothing waiting' : 'Empty'}
            body={
              laneKey === 'new'
                ? 'Every order that has come in has been answered.'
                : 'Nothing in this stage right now.'
            }
            icon={<IconInbox />}
          />
        ) : (
          orders.map((order, index) => (
            <OrderCard
              key={order.id}
              order={order}
              now={now}
              index={index}
              fresh={freshIds.has(order.id)}
              actions={renderActions(order)}
            />
          ))
        )}
      </div>
    </section>
  );
}

/* ================================================================== */
/* History                                                             */
/* ================================================================== */

function HistoryTable({ rows, loading }: { rows: VendorOrder[]; loading: boolean }) {
  const columns: Column<VendorOrder>[] = [
    {
      key: 'orderNo',
      header: 'Order',
      numeric: true,
      render: (row) => <Link href={`/vendor/orders/${row.id}`}>{row.orderNo}</Link>,
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (row) => row.customer.name ?? '—',
    },
    {
      key: 'status',
      header: 'Outcome',
      render: (row) => <OrderStatusPill status={row.status} />,
    },
    {
      key: 'itemCount',
      header: 'Items',
      align: 'right',
      numeric: true,
    },
    {
      key: 'grandTotal',
      header: 'Total',
      align: 'right',
      numeric: true,
      render: (row) => <Money value={row.grandTotal} />,
    },
    {
      key: 'placedAt',
      header: 'Placed',
      render: (row) =>
        row.placedAt === null ? '—' : <RelativeTime value={row.placedAt} live={false} />,
    },
  ];

  return (
    <VenTable
      columns={columns}
      rows={rows}
      loading={loading}
      rowKey={(row) => row.id}
      skeletonRows={5}
      empty={
        <EmptyState
          title="No closed orders yet"
          body="Delivered, rejected and cancelled orders collect here."
          icon={<IconInbox />}
        />
      }
    />
  );
}
