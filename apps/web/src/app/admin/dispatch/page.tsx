'use client';

/**
 * ★ DISPATCH — orders with nobody carrying them, and people with nothing to
 * carry.
 *
 * ── THE TWO PANES ARE ONE DECISION ──────────────────────────────────────────
 * Left: what is waiting, how long it has waited, and who is nearest. Right:
 * the fleet. They sit side by side because the question is never "what is
 * waiting" OR "who is free" — it is always both at once, and a dispatcher who
 * has to switch screens to answer half of it assigns the wrong rider.
 *
 * ── EVERY WRITE IS CONFIRMED, AND EVERY WRITE IS EXPLAINED ──────────────────
 * Assigning moves a real person across a real city. Unassigning takes a job
 * away from someone mid-shift, so its reason is REQUIRED — not because a form
 * needs a field, but because the rider will ask, and "the system did it" is
 * not an answer anyone can give them.
 *
 * ── 409 IS THE NORMAL CASE, NOT AN ERROR ────────────────────────────────────
 * Two dispatchers on two screens will pick the same rider within the same
 * second. The API is the referee and one of them loses. That has to arrive as
 * a sentence a human can act on — "Salim just took another order, pick someone
 * else" — and the panes refetch so the board they are looking at is true again.
 * A raw `409 Conflict` teaches an operator that the tool is broken.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@/lib/api-client';
import { useAdminMutation, useAdminQuery, useFreshness } from '@/hooks';
import { formatCount, humanise } from '@/lib/admin/format';
import {
  riderState,
  type OpsAssignBody,
  type OpsDispatchResponse,
  type OpsDispatchResult,
  type OpsDispatchRider,
  type OpsRiderState,
  type OpsUnassignBody,
  type OpsUnassignedOrder,
} from '@/lib/admin/types';
import {
  AdminPage,
  AdminSection,
  ConfirmDialog,
  EmptyState,
  IconAlert,
  IconCheck,
  IconRiders,
  Money,
  RelativeTime,
} from '@/components/admin';
import { LiveMeta, SlaIndicator } from '@/components/admin/ops';

const REFRESH_MS = 15_000;
const DISPATCH_PATH = '/admin/ops/dispatch';

/** Both panes, the board and the ops summary all read the same world. */
const INVALIDATE = ['/admin/ops'] as const;

const RIDER_STATE_LABEL: Record<OpsRiderState, string> = {
  offline: 'Offline',
  available: 'Available',
  on_job: 'On a job',
};

/* ================================================================== */
/* Pending action                                                      */
/* ================================================================== */

type Pending =
  | { kind: 'assign'; order: OpsUnassignedOrder; riderId: string; riderName: string }
  | { kind: 'unassign'; rider: OpsDispatchRider };

export default function AdminDispatchPage() {
  const dispatch = useAdminQuery<OpsDispatchResponse>(DISPATCH_PATH, undefined, {
    refreshMs: REFRESH_MS,
  });

  const data = dispatch.data;
  const freshness = useFreshness(data, REFRESH_MS * 2.5);

  const [pending, setPending] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<{ tone: 'good' | 'crit'; text: string } | null>(null);
  const [riderFilter, setRiderFilter] = useState<'all' | OpsRiderState>('all');
  const [riderQuery, setRiderQuery] = useState('');

  // Both writes answer 200 with the updated OpsOrderCard - not 201, and not
  // an envelope. The card is not rendered here: the panes refetch instead, so
  // what the operator sees next is the server's whole world, not one row of it.
  const assign = useAdminMutation<OpsAssignBody, OpsDispatchResult>(
    '/admin/ops/dispatch/assign',
    'POST',
  );
  const unassign = useAdminMutation<OpsUnassignBody, OpsDispatchResult>(
    '/admin/ops/dispatch/unassign',
    'POST',
  );

  const busy = assign.loading || unassign.loading;

  const close = useCallback(() => {
    setPending(null);
    setReason('');
  }, []);

  const onError = useCallback((error: ApiError, kind: Pending['kind'], who: string) => {
    setNotice({
      tone: 'crit',
      text:
        error.status === 409
          ? kind === 'assign'
            ? `${who} just took another order, or this one has already moved on. The panes are refreshing — pick someone else.`
            : `That order is past the assigned stage. Once the goods have left the store this is no longer a dispatch decision — cancel it from the order screen instead.`
          : error.status === 403
            ? 'The API refused that. Dispatch actions are restricted, and that decision is made server-side.'
            : error.friendlyMessage,
    });
  }, []);

  const confirm = useCallback(async () => {
    if (pending === null) return;

    if (pending.kind === 'assign') {
      const result = await assign.mutate(
        {
          orderId: pending.order.id,
          riderId: pending.riderId,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
        {
          invalidate: INVALIDATE,
          onError: (error) => onError(error, 'assign', pending.riderName),
        },
      );
      if (result !== null) {
        setNotice({
          tone: 'good',
          text: `${pending.order.orderNo} is now ${pending.riderName}'s.`,
        });
        close();
      }
      // A failed write leaves the dialog open on purpose — see <ConfirmDialog>.
      return;
    }

    const result = await unassign.mutate(
      { orderId: pending.rider.activeOrderId ?? '', reason: reason.trim() },
      {
        invalidate: INVALIDATE,
        onError: (error) => onError(error, 'unassign', pending.rider.name ?? 'that rider'),
      },
    );
    if (result !== null) {
      setNotice({
        tone: 'good',
        text: `${pending.rider.activeOrderNo ?? 'That order'} is back in the unassigned queue.`,
      });
      close();
    }
  }, [pending, reason, assign, unassign, close, onError]);

  /* ---- panes -------------------------------------------------------- */

  const unassigned = useMemo(
    () =>
      // Worst SLA first, then longest wait. The order at the top of this list
      // is the one that should be assigned next, always.
      [...(data?.unassigned ?? [])].sort((a, b) => {
        const weight = (state: string) => (state === 'breached' ? 0 : state === 'warning' ? 1 : 2);
        const bySla = weight(a.sla.state) - weight(b.sla.state);
        return bySla !== 0 ? bySla : b.waitingMinutes - a.waitingMinutes;
      }),
    [data?.unassigned],
  );

  const riders = useMemo(() => {
    const needle = riderQuery.trim().toLowerCase();
    return (data?.riders ?? [])
      .filter((rider) => riderFilter === 'all' || riderState(rider) === riderFilter)
      .filter((rider) => needle === '' || (rider.name ?? '').toLowerCase().includes(needle))
      .sort((a, b) => {
        // Available first - they are the answer to the question this page asks.
        const rank = (rider: OpsDispatchRider) => {
          const state = riderState(rider);
          return state === 'available' ? 0 : state === 'on_job' ? 1 : 2;
        };
        const byState = rank(a) - rank(b);
        return byState !== 0 ? byState : (a.name ?? '').localeCompare(b.name ?? '');
      });
  }, [data?.riders, riderFilter, riderQuery]);

  const loading = dispatch.loading && data === null;

  return (
    <AdminPage
      title="Dispatch"
      description="Orders waiting for a rider, and the riders who could take them. Assigning and unassigning are both logged."
      isFixture={dispatch.isFixture}
      fixturePaths={dispatch.isFixture ? [DISPATCH_PATH] : undefined}
      actions={
        <LiveMeta
          freshness={freshness}
          intervalMs={REFRESH_MS}
          onRefresh={dispatch.refetch}
          loading={dispatch.loading}
        />
      }
    >
      {notice !== null ? (
        <div className="adm-notice" data-tone={notice.tone} role="status">
          {notice.tone === 'good' ? <IconCheck /> : <IconAlert />}
          <p>{notice.text}</p>
          <button
            type="button"
            className="adm-btn adm-btn--sm adm-btn--ghost"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {dispatch.error !== null && data === null ? (
        <EmptyState
          title="Dispatch is not available"
          body={
            <>
              {dispatch.error.friendlyMessage} This screen reads <code>GET {DISPATCH_PATH}</code>.
            </>
          }
          action={
            <button type="button" className="adm-btn adm-btn--primary" onClick={dispatch.refetch}>
              Try again
            </button>
          }
        />
      ) : (
        <div className="adm-grid adm-grid--split">
          {/* ---------------------------------------- unassigned ---- */}
          <AdminSection
            title={`Waiting for a rider${data === null ? '' : ` · ${formatCount(unassigned.length)}`}`}
            description="Worst SLA first, then longest wait. The top row is the next one to assign."
          >
            <div className="adm-pane">
              {loading ? (
                <SkeletonRows rows={3} />
              ) : unassigned.length === 0 ? (
                <EmptyState
                  title="Nothing waiting"
                  body="Every packed order has a rider on it. This is what a good evening looks like."
                  icon={<IconCheck />}
                />
              ) : (
                unassigned.map((order, index) => (
                  <article
                    className="adm-wait"
                    key={order.id}
                    data-sla={order.sla.state}
                    style={{ ['--adm-i' as string]: String(Math.min(index, 14)) }}
                  >
                    <div className="adm-wait__head">
                      <Link className="adm-table__link adm-num" href={`/admin/orders/${order.id}`}>
                        {order.orderNo}
                      </Link>
                      <SlaIndicator sla={order.sla} pulseKey={`${order.id}:${order.sla.state}`} />
                      <span className="adm-wait__waiting adm-num" title="Minutes waiting">
                        {order.waitingMinutes}m waiting
                      </span>
                    </div>

                    <p className="adm-wait__meta">
                      {order.vendorName ?? 'Store not resolved'} →{' '}
                      {order.customerName ?? 'Customer not resolved'} ·{' '}
                      {formatCount(order.itemCount)} {order.itemCount === 1 ? 'item' : 'items'} ·{' '}
                      {/* INTEGER PAISE, straight from the API. */}
                      <Money value={order.grandTotal} /> · placed{' '}
                      <RelativeTime value={order.placedAt} />
                    </p>

                    <div className="adm-wait__riders">
                      {order.nearestRiders.length === 0 ? (
                        <p className="adm-dim">
                          No rider has a position fix near this vendor right now.
                        </p>
                      ) : (
                        order.nearestRiders.map((near) => {
                          const name = near.name ?? 'Rider not resolved';
                          return (
                            <button
                              key={near.id}
                              type="button"
                              className="adm-suggest"
                              disabled={busy || !near.isAvailable}
                              title={
                                near.isAvailable
                                  ? `Assign ${name}`
                                  : `${name} is already carrying an order`
                              }
                              onClick={() =>
                                setPending({
                                  kind: 'assign',
                                  order,
                                  riderId: near.id,
                                  riderName: name,
                                })
                              }
                            >
                              <IconRiders className="adm-suggest__icon" />
                              <span className="adm-suggest__name">{name}</span>
                              <span className="adm-suggest__km adm-num">
                                {near.distanceKm.toFixed(1)} km
                              </span>
                              <span className="adm-suggest__state">
                                {near.isAvailable ? 'free' : 'busy'}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </AdminSection>

          {/* -------------------------------------------- riders ---- */}
          <AdminSection
            title="Riders"
            description="Available first. A rider mid-job shows what they are carrying and for how long."
            actions={
              <div className="adm-row">
                <input
                  className="adm-input"
                  type="search"
                  placeholder="Find a rider…"
                  value={riderQuery}
                  onChange={(event) => setRiderQuery(event.target.value)}
                  aria-label="Find a rider by name"
                  style={{ width: 150 }}
                />
                <select
                  className="adm-select"
                  value={riderFilter}
                  onChange={(event) =>
                    setRiderFilter(event.target.value as 'all' | OpsRiderState)
                  }
                  aria-label="Filter riders by state"
                >
                  <option value="all">All</option>
                  <option value="available">Available</option>
                  <option value="on_job">On a job</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
            }
          >
            <div className="adm-pane">
              {loading ? (
                <SkeletonRows rows={5} />
              ) : riders.length === 0 ? (
                <EmptyState
                  title="No riders match"
                  body={
                    riderFilter === 'all' && riderQuery === ''
                      ? 'Nobody is signed in to the delivery app right now.'
                      : 'Clear the filter to see the rest of the fleet.'
                  }
                  icon={<IconRiders />}
                />
              ) : (
                riders.map((rider, index) => {
                  // ONE place decides what "available" means - see riderState().
                  const state = riderState(rider);
                  return (
                    <article
                      className="adm-rider"
                      key={rider.id}
                      data-state={state}
                      style={{ ['--adm-i' as string]: String(Math.min(index, 14)) }}
                    >
                      <div className="adm-rider__main">
                        <Link className="adm-table__link" href={`/admin/riders/${rider.id}`}>
                          {rider.name ?? 'Rider not resolved'}
                        </Link>
                        <span className="adm-rider__state">
                          <span className="adm-rider__dot" aria-hidden="true" />
                          {RIDER_STATE_LABEL[state]}
                        </span>
                      </div>

                      <p className="adm-rider__meta">
                        {humanise(rider.vehicleType)} · {formatCount(rider.completedCount)} lifetime
                        deliveries · rated {rider.rating.toFixed(1)}
                        {rider.distanceToDropKm === null
                          ? null
                          : ` · ${rider.distanceToDropKm.toFixed(1)} km from the drop`}
                      </p>

                      {state === 'on_job' && rider.activeOrderId !== null ? (
                        <div className="adm-rider__job">
                          <Link
                            className="adm-table__link adm-num"
                            href={`/admin/orders/${rider.activeOrderId}`}
                          >
                            {rider.activeOrderNo ?? rider.activeOrderId}
                          </Link>
                          <span className="adm-dim adm-num">
                            {rider.minutesOnCurrentJob === null
                              ? '—'
                              : `${rider.minutesOnCurrentJob}m on job`}
                          </span>
                          <button
                            type="button"
                            className="adm-btn adm-btn--sm adm-btn--danger"
                            disabled={busy}
                            onClick={() => setPending({ kind: 'unassign', rider })}
                          >
                            Unassign
                          </button>
                        </div>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </AdminSection>
        </div>
      )}

      {/* ------------------------------------------------ confirm ---- */}
      <ConfirmDialog
        open={pending !== null}
        loading={busy}
        // A reason is REQUIRED to unassign. The API enforces it too — this
        // only stops the operator from discovering that via a 422.
        confirmDisabled={pending?.kind === 'unassign' && reason.trim().length < 3}
        destructive={pending?.kind === 'unassign'}
        title={
          pending?.kind === 'unassign'
            ? `Take the job off ${pending.rider.name ?? 'this rider'}?`
            : pending === null
              ? ''
              : `Assign ${pending.order.orderNo} to ${pending.riderName}?`
        }
        confirmLabel={pending?.kind === 'unassign' ? 'Unassign' : 'Assign'}
        onCancel={close}
        onConfirm={() => void confirm()}
        body={
          pending === null ? null : pending.kind === 'assign' ? (
            <>
              <p>
                {pending.order.orderNo} has been waiting {pending.order.waitingMinutes} minutes at{' '}
                {pending.order.vendorName ?? 'the store'}. {pending.riderName} will be notified
                immediately.
              </p>
              <label className="adm-field">
                <span className="adm-field__label">Reason (optional)</span>
                <input
                  className="adm-input"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Overriding the nearest rider, batching a route…"
                  disabled={busy}
                />
              </label>
              {assign.error !== null ? (
                <p className="adm-dialog__error">{assign.error.friendlyMessage}</p>
              ) : null}
            </>
          ) : (
            <>
              <p>
                {pending.rider.name ?? 'This rider'} is carrying{' '}
                <strong>{pending.rider.activeOrderNo ?? 'an order'}</strong> and has been for{' '}
                {pending.rider.minutesOnCurrentJob ?? '—'} minutes. The order returns to
                READY_FOR_PICKUP and somebody has to collect it again. Anything past the assigned
                stage the API refuses outright: once the goods have left the store this is no
                longer a dispatch decision.
              </p>
              <label className="adm-field">
                <span className="adm-field__label">
                  Reason (required, at least 3 characters — the rider will be told this)
                </span>
                <input
                  className="adm-input"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Bike broke down, wrong zone, customer rescheduled…"
                  disabled={busy}
                  required
                />
              </label>
              {reason.trim().length < 3 ? (
                <p className="adm-dim">
                  A reason of at least three characters is required before this can be confirmed.
                </p>
              ) : null}
              {unassign.error !== null ? (
                <p className="adm-dialog__error">{unassign.error.friendlyMessage}</p>
              ) : null}
            </>
          )
        }
      />
    </AdminPage>
  );
}

/* ------------------------------------------------------------------ */

function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div className="adm-stack" aria-busy="true">
      {Array.from({ length: rows }, (_unused, index) => (
        <div className="adm-skel adm-skel--row" key={index} />
      ))}
    </div>
  );
}
