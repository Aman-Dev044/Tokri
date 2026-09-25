import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';

import { Role } from '../../common/constants/roles.enum';
import {
  ALLOWED_ACTOR,
  OrderStatus,
  canTransition,
} from '../../common/constants/order-status.enum';
import { OrderDocument } from '../../database/schemas/order.schema';

/**
 * Who drove a transition.
 *
 * `'system'` is the assignment engine acting on its own: an offer the
 * rider accepted, an offer that expired, an order pulled back from a
 * rider whose phone went dark. Those are platform decisions — the rider
 * pressed a button on an OFFER, not on the order — and recording them
 * under the rider's role would claim they did something they did not.
 */
export type TransitionActor = Role | 'system';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE STATE MACHINE, ENFORCED
 * ════════════════════════════════════════════════════════════════════════
 *
 * EVERY status change in this module goes through here. There is no
 * second path, and no service sets `order.status` directly.
 *
 * ── Two questions, two different answers ────────────────────────────────
 *
 * 1. Is the transition on the map? `canTransition` decides, and a "no" is
 *    409 CONFLICT — the request is not forbidden, it is impossible. A
 *    rider tapping "delivered" on an order they have not picked up is
 *    almost always a stale screen rather than an attack.
 *
 * 2. May THIS actor drive it? `ALLOWED_ACTOR` decides, and a "no" is 403.
 *
 * ── How `ALLOWED_ACTOR` is read ─────────────────────────────────────────
 * It is consulted WHEN IT SPEAKS. The map lists five transitions; the
 * others (`PICKED_UP→OUT_FOR_DELIVERY`, `OUT_FOR_DELIVERY→
 * DELIVERY_FAILED`) are simply not in it, and reading that silence as
 * "platform roles only" would lock riders out of the two steps that are
 * unambiguously theirs. Where the map is silent, the route's `@Roles()`
 * gate governs; where it speaks, it wins.
 *
 * `'system'` skips the actor check and only the actor check — the
 * transition map still binds it absolutely. That is what lets the
 * assignment engine drive `READY_FOR_PICKUP→ASSIGNED` (a transition
 * reserved for VENDOR and ADMIN as a human action) without weakening
 * either rule for humans.
 */
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActor,
): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(
      `An order in status ${from} cannot move to ${to}`,
    );
  }

  if (actor === 'system') return;

  const permitted = ALLOWED_ACTOR[`${from}→${to}`];
  if (permitted && !permitted.includes(actor)) {
    throw new ForbiddenException(
      `A ${actor} may not move an order from ${from} to ${to}`,
    );
  }
}

/**
 * Applies a transition to a hydrated order, history included.
 *
 * The status and its history row are written in the SAME document save,
 * so an order can never carry a status nothing accounts for. Returns the
 * previous status for the caller's event payload.
 */
export function applyTransition(
  order: OrderDocument,
  to: OrderStatus,
  actor: TransitionActor,
  options: { byUserId?: string | null; reason?: string | null; at?: Date } = {},
): OrderStatus {
  const from = order.status;
  assertTransition(from, to, actor);

  const at = options.at ?? new Date();

  order.status = to;
  order.statusHistory.push({
    from,
    to,
    byUserId: toObjectIdOrNull(options.byUserId ?? null),
    byRole: actor === 'system' ? null : actor,
    reason: options.reason ?? null,
    at,
  });

  // The milestone timestamps the reports read. Set here rather than in
  // five call sites, because a report that silently misses `pickedUpAt`
  // is a report nobody notices is wrong.
  if (to === OrderStatus.PICKED_UP) order.pickedUpAt = at;
  if (to === OrderStatus.DELIVERED) order.deliveredAt = at;
  if (to === OrderStatus.READY_FOR_PICKUP) order.readyAt ??= at;

  return from;
}

const toObjectIdOrNull = (value: string | null): Types.ObjectId | null =>
  value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
