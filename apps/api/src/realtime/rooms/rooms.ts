import { Types } from 'mongoose';

import { PLATFORM_ROLES, Role } from '../../common/constants/roles.enum';
import { SocketUser } from '../middleware/ws-auth.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ROOMS (§6.3)
 * ════════════════════════════════════════════════════════════════════════
 *
 * | Room               | Who is in it                                    |
 * |--------------------|-------------------------------------------------|
 * | `user:{userId}`    | that user, always                               |
 * | `vendor:{vendorId}`| the vendor owner and their staff                |
 * | `order:{orderId}`  | its customer, its vendor, its rider, any admin — |
 * |                    | VERIFIED AGAINST THE DATABASE on join            |
 * | `admin`            | platform roles only                             |
 *
 * Every name is built here. A room name assembled inline somewhere else
 * is a typo waiting to deliver an event to a room nobody is in.
 */

export const ORDER_ROOM = (orderId: string): string => `order:${orderId}`;
export const USER_ROOM = (userId: string): string => `user:${userId}`;
export const VENDOR_ROOM = (vendorId: string): string => `vendor:${vendorId}`;
export const ADMIN_ROOM = 'admin';

export const ORDER_ROOM_PREFIX = 'order:';

/**
 * The rooms a socket is joined to the moment it authenticates.
 *
 * The client is never consulted. It cannot ask for a room here, cannot
 * decline one, and cannot influence which it gets — the list is a pure
 * function of the VERIFIED token.
 *
 * A rider's `vendorId` deliberately does NOT put them in the vendor room:
 * riders are scoped to a store for dispatch purposes, which is not the
 * same as being entitled to that store's entire order feed.
 */
export function autoJoinRooms(user: SocketUser): string[] {
  const rooms = [USER_ROOM(user.sub)];

  if (user.role === Role.VENDOR && user.vendorId) {
    rooms.push(VENDOR_ROOM(user.vendorId));
  }

  if (PLATFORM_ROLES.includes(user.role)) {
    rooms.push(ADMIN_ROOM);
  }

  return rooms;
}

/** The ownership facts an order room decision needs, and nothing else. */
export interface OrderAccessRecord {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  vendorId: Types.ObjectId;
  deliveryPartnerId?: Types.ObjectId | null;
}

/**
 * May this user join this order's room?
 *
 * A pure function of the order document and the verified token, so it can
 * be asserted directly in a unit test as well as through a live socket.
 *
 * ── One correction to the §6.3 sketch ───────────────────────────────────
 * The plan writes `order.deliveryPartnerId?.equals(u.sub)`. That can
 * never be true: `deliveryPartnerId` references a DeliveryPartner
 * document while `sub` is a User id. Taken literally it would lock every
 * rider out of their own delivery, so the caller resolves the rider's
 * partner id first and passes it in.
 */
export function mayViewOrder(
  order: OrderAccessRecord,
  user: SocketUser,
  partnerId: Types.ObjectId | null,
): boolean {
  if (PLATFORM_ROLES.includes(user.role)) return true;

  if (user.role === Role.CUSTOMER) {
    return order.customerId.equals(user.sub);
  }

  if (user.role === Role.VENDOR) {
    return !!user.vendorId && order.vendorId.equals(user.vendorId);
  }

  if (user.role === Role.DELIVERY) {
    return (
      !!partnerId &&
      !!order.deliveryPartnerId &&
      order.deliveryPartnerId.equals(partnerId)
    );
  }

  return false;
}
