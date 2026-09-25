import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  Vendor,
  VendorDocument,
} from '../../../database/schemas/vendor.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../../database/schemas/inventory-log.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../../database/schemas/delivery-partner.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  OrderStatus,
  TERMINAL_STATUSES,
  canTransition,
} from '../../../common/constants/order-status.enum';
import { Role } from '../../../common/constants/roles.enum';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ShopSettingsService } from '../common/shop-settings.service';
import { problem } from '../common/problem';
import { PricingService } from '../pricing/pricing.service';
import {
  OrderDetail,
  OrderLean,
  OrderSummary,
  StoreRef,
  isFreelyCancellable,
  toOrderDetail,
  toOrderSummary,
} from './order-view';

export interface TrackView {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  statusHistory: OrderDetail['statusHistory'];
  eta: {
    /** Minutes remaining against the promise. Null once terminal. */
    minutes: number | null;
    /** ISO-8601 target time. Null once terminal. */
    at: string | null;
    /** Where the number came from. Never dressed up as a live estimate. */
    basis: 'sla' | 'delivered' | 'closed';
  };
  vendor: {
    id: string;
    name: string;
    location: { lat: number; lng: number } | null;
  };
  drop: {
    location: { lat: number; lng: number };
    line1: string;
    city: string;
    pincode: string;
  };
  rider: {
    name: string;
    phone: string;
    location: { lat: number; lng: number } | null;
    lastSeenAt: string | null;
    /** Age of that fix in seconds, so the UI can say "40s ago". */
    ageSeconds: number | null;
  } | null;
}

interface VendorLean {
  _id: Types.ObjectId;
  storeName: string;
  slug: string;
  location: { type: 'Point'; coordinates: number[] };
}

/**
 * The customer's own orders.
 *
 * Every read is filtered by `customerId` taken from the verified token,
 * in addition to `@Owns` on the single-resource routes. Two independent
 * checks, because one of them being removed by accident must not be
 * enough to expose another customer's order.
 */
@Injectable()
export class ShopOrdersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(InventoryLog.name)
    private readonly inventoryLogs: Model<InventoryLogDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly settings: ShopSettingsService,
    private readonly pricing: PricingService,
  ) {}

  async list(
    customerId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<OrderSummary>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = { customerId: new Types.ObjectId(customerId) };

    const [docs, total] = await Promise.all([
      this.orders
        .find(filter)
        .sort({ placedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<OrderLean[]>()
        .exec(),
      this.orders.countDocuments(filter).exec(),
    ]);

    const stores = await this.storeRefs(docs.map((doc) => doc.vendorId));

    return paginate(
      docs.map((doc) =>
        toOrderSummary(doc, stores.get(doc.vendorId.toString()) ?? null),
      ),
      total,
      page,
      limit,
    );
  }

  async findOne(customerId: string, id: string): Promise<OrderDetail> {
    const order = await this.owned(customerId, id);
    const stores = await this.storeRefs([order.vendorId]);
    return toOrderDetail(order, stores.get(order.vendorId.toString()) ?? null);
  }

  /**
   * Where the order actually is.
   *
   * ── The rider's position is reported, never invented ────────────────
   * `location` is whatever the rider's device last sent, with the
   * timestamp it was sent at and its age in seconds. The server does NOT
   * interpolate along a route, extrapolate from the last heading, or
   * substitute the store's position when the fix is stale. A confidently
   * wrong dot is worse than an honest "last seen 40s ago" (§8.7 #16):
   * the customer stops trusting the screen the first time the scooter
   * glides through a building.
   */
  async track(customerId: string, id: string): Promise<TrackView> {
    const order = await this.owned(customerId, id);

    const [vendor, settings] = await Promise.all([
      this.vendors
        .findById(order.vendorId)
        .select('storeName slug location')
        .lean<VendorLean | null>()
        .exec(),
      this.settings.read(),
    ]);

    const rider = await this.riderFor(order.deliveryPartnerId ?? null);
    const [dropLng, dropLat] = order.address.location.coordinates;

    return {
      orderId: order._id.toString(),
      orderNo: order.orderNo,
      status: order.status,
      statusHistory: order.statusHistory.map((change) => ({
        from: change.from ?? null,
        to: change.to,
        byRole: change.byRole ?? null,
        reason: change.reason ?? null,
        at: change.at.toISOString(),
      })),
      eta: this.eta(order, settings.slaMinutes),
      vendor: {
        id: order.vendorId.toString(),
        name: vendor?.storeName ?? 'Store',
        location: vendor
          ? {
              lat: vendor.location.coordinates[1],
              lng: vendor.location.coordinates[0],
            }
          : null,
      },
      drop: {
        location: { lat: dropLat, lng: dropLng },
        line1: order.address.line1,
        city: order.address.city,
        pincode: order.address.pincode,
      },
      rider,
    };
  }

  /**
   * Customer-initiated cancellation (locked decision #8).
   *
   * FREE until the vendor accepts. After that the store has started
   * picking, so the answer is a 409 that says approval is needed — not a
   * silent failure and not a cancellation the vendor finds out about
   * halfway through packing it.
   *
   * ── Why the status check is in the FILTER ───────────────────────────
   * `findOneAndUpdate({ _id, customerId, status: PLACED })` is the same
   * pattern as the stock decrement in §8.2: the vendor pressing Accept
   * and the customer pressing Cancel are a genuine race, and a
   * read-then-write here would let both win — an accepted order whose
   * stock has been released back to the shelf.
   */
  async cancel(
    customerId: string,
    id: string,
    reason: string,
  ): Promise<OrderDetail> {
    const current = await this.owned(customerId, id);

    if (TERMINAL_STATUSES.includes(current.status)) {
      throw new ConflictException(
        problem(
          'ORDER_CLOSED',
          `This order is already ${current.status.toLowerCase()}`,
          { status: current.status },
        ),
      );
    }

    if (!isFreelyCancellable(current.status)) {
      // The transition itself is legal — the vendor or an admin may still
      // make it — but not on the customer's say-so alone.
      throw new ConflictException(
        problem(
          'CANCELLATION_NEEDS_APPROVAL',
          'The store has already accepted this order. Cancelling now needs ' +
            'the store\'s approval — contact support and they will action it.',
          { status: current.status },
        ),
      );
    }

    if (!canTransition(current.status, OrderStatus.CANCELLED)) {
      throw new ConflictException(
        problem('ILLEGAL_TRANSITION', 'This order can no longer be cancelled', {
          status: current.status,
        }),
      );
    }

    const at = new Date();
    const session = await this.connection.startSession();
    let cancelled: OrderLean | null = null;

    try {
      await session.withTransaction(async () => {
        const claimed = await this.orders
          .findOneAndUpdate(
            {
              _id: current._id,
              customerId: new Types.ObjectId(customerId),
              status: OrderStatus.PLACED,
            },
            {
              $set: {
                status: OrderStatus.CANCELLED,
                cancellation: {
                  by: Role.CUSTOMER,
                  byUserId: new Types.ObjectId(customerId),
                  reason,
                  at,
                },
              },
              $push: {
                statusHistory: {
                  from: OrderStatus.PLACED,
                  to: OrderStatus.CANCELLED,
                  byUserId: new Types.ObjectId(customerId),
                  byRole: Role.CUSTOMER,
                  reason,
                  at,
                },
              },
            },
            { new: true, session },
          )
          .lean<OrderLean | null>()
          .exec();

        if (!claimed) {
          // Somebody else moved it between the read and the write.
          throw new ConflictException(
            problem(
              'CANCELLATION_NEEDS_APPROVAL',
              'The store accepted this order a moment ago. Cancelling now ' +
                'needs the store\'s approval.',
            ),
          );
        }

        await this.releaseStock(claimed, session);
        await this.pricing.release(claimed._id, session);

        cancelled = claimed;
      });
    } finally {
      await session.endSession();
    }

    // `cancelled` is assigned inside the transaction callback, which TS
    // cannot see through; the throw above guarantees it is set.
    const result = cancelled as OrderLean | null;
    if (!result) throw new ConflictException('Cancellation failed');

    const stores = await this.storeRefs([result.vendorId]);
    return toOrderDetail(result, stores.get(result.vendorId.toString()) ?? null);
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Loads an order that belongs to this customer.
   *
   * `ResourceOwnerGuard` has already run on these routes; this is the
   * second, independent check. 404 on a mismatch, never 403 — order ids
   * must not be enumerable.
   */
  private async owned(customerId: string, id: string): Promise<OrderLean> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Order not found');
    }

    const order = await this.orders
      .findOne({
        _id: new Types.ObjectId(id),
        customerId: new Types.ObjectId(customerId),
      })
      .lean<OrderLean | null>()
      .exec();

    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** Puts reserved units back on the shelf, with an audit row each. */
  private async releaseStock(
    order: OrderLean,
    session: ClientSession,
  ): Promise<void> {
    for (const item of order.items) {
      await this.inventory
        .updateOne(
          { productId: item.productId, reserved: { $gte: item.qty } },
          { $inc: { stock: item.qty, reserved: -item.qty } },
          { session },
        )
        .exec();
    }

    await this.inventoryLogs.create(
      order.items.map((item) => ({
        vendorId: order.vendorId,
        productId: item.productId,
        delta: item.qty,
        reason: InventoryReason.ORDER_RELEASE,
        refId: order._id,
        byUserId: order.customerId,
        at: new Date(),
      })),
      { session },
    );
  }

  private eta(order: OrderLean, slaMinutes: number): TrackView['eta'] {
    if (order.status === OrderStatus.DELIVERED) {
      return {
        minutes: 0,
        at: (order.deliveredAt ?? order.placedAt).toISOString(),
        basis: 'delivered',
      };
    }

    if (TERMINAL_STATUSES.includes(order.status)) {
      return { minutes: null, at: null, basis: 'closed' };
    }

    // The promise, not a prediction. A real ETA needs a routing engine
    // and the rider's live position; inventing one from a straight-line
    // distance would be a number that is confidently wrong. Labelled
    // `sla` so the UI can present it as "expected by", never "arriving
    // in".
    const target = new Date(order.placedAt.getTime() + slaMinutes * 60_000);
    const minutes = Math.max(
      0,
      Math.ceil((target.getTime() - Date.now()) / 60_000),
    );

    return { minutes, at: target.toISOString(), basis: 'sla' };
  }

  private async riderFor(
    partnerId: Types.ObjectId | null,
  ): Promise<TrackView['rider']> {
    if (!partnerId) return null;

    const partner = await this.partners
      .findById(partnerId)
      .select('userId currentLocation locationAt')
      .lean<{
        userId: Types.ObjectId;
        currentLocation?: { type: 'Point'; coordinates: number[] } | null;
        locationAt?: Date | null;
      } | null>()
      .exec();

    if (!partner) return null;

    const user = await this.users
      .findById(partner.userId)
      .select('name phone')
      .lean<{ name: string; phone: string } | null>()
      .exec();

    const location = partner.currentLocation
      ? {
          lat: partner.currentLocation.coordinates[1],
          lng: partner.currentLocation.coordinates[0],
        }
      : null;

    return {
      name: user?.name ?? 'Your rider',
      phone: user?.phone ?? '',
      location,
      lastSeenAt: partner.locationAt ? partner.locationAt.toISOString() : null,
      ageSeconds: partner.locationAt
        ? Math.max(
            0,
            Math.round((Date.now() - partner.locationAt.getTime()) / 1000),
          )
        : null,
    };
  }

  private async storeRefs(
    vendorIds: Types.ObjectId[],
  ): Promise<Map<string, StoreRef>> {
    if (vendorIds.length === 0) return new Map();

    const vendors = await this.vendors
      .find({ _id: { $in: vendorIds } })
      .select('storeName slug')
      .lean<{ _id: Types.ObjectId; storeName: string; slug: string }[]>()
      .exec();

    return new Map(
      vendors.map((vendor) => [
        vendor._id.toString(),
        {
          id: vendor._id.toString(),
          storeName: vendor.storeName,
          slug: vendor.slug,
        },
      ]),
    );
  }
}
