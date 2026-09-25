import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { OrderStatus } from '../../common/constants/order-status.enum';
import { JwtUser } from '../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../common/dto/paginated';
import { Order, OrderDocument } from '../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../database/schemas/delivery-partner.schema';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { Vendor, VendorDocument } from '../../database/schemas/vendor.schema';
import { GeoPoint } from '../../database/schemas/geo-point';
import { RiderPresenceRegistry } from '../../realtime/rider-presence.registry';
import { codAmountOf } from './assignment.service';
import { AvailabilityDto, DeliveryHistoryQueryDto, EarningsQueryDto } from './dto';
import { GeoService } from './geo.service';
import {
  DeliveryHistoryRow,
  EarningsDay,
  EarningsSummary,
  RiderProfile,
} from './types';

/** Orders that count as finished work, delivered or not. */
const COMPLETED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DELIVERED,
  OrderStatus.DELIVERY_FAILED,
];

/** `GET /delivery/earnings` defaults to the last 30 days. */
const DEFAULT_EARNINGS_WINDOW_DAYS = 30;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE RIDER'S OWN RECORD
 * ════════════════════════════════════════════════════════════════════════
 *
 * Profile, availability, history and earnings.
 *
 * Every query here is scoped by the partner resolved from the VERIFIED
 * token — never by an id in a param, query or body. There is deliberately
 * no endpoint that takes a rider id at all, so there is no id to tamper
 * with: the rider surface can only ever describe the caller.
 */
@Injectable()
export class DeliveryService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly geo: GeoService,
    private readonly presence: RiderPresenceRegistry,
  ) {}

  /**
   * The caller's DeliveryPartner record.
   *
   * A DELIVERY user without one is 404, not 500: the role is real, the
   * profile has simply not been created yet, and every other method in
   * the module depends on this being the single place that decides.
   */
  async requirePartner(user: JwtUser): Promise<DeliveryPartnerDocument> {
    const partner = await this.partners
      .findOne({ userId: new Types.ObjectId(user.sub) })
      .exec();

    if (!partner) {
      throw new NotFoundException('No delivery partner profile for this user');
    }

    return partner;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Profile
  // ──────────────────────────────────────────────────────────────────

  async me(user: JwtUser): Promise<RiderProfile> {
    const partner = await this.requirePartner(user);
    const now = new Date();

    const account = await this.users
      .findById(partner.userId)
      .select('name phone')
      .lean<{ name: string; phone: string } | null>()
      .exec();

    const dayStart = startOfDay(now);
    const todays = await this.completedOrders({
      partnerId: partner._id,
      from: dayStart,
      to: now,
    });

    return {
      partnerId: partner._id.toString(),
      userId: partner.userId.toString(),
      name: account?.name ?? '',
      phone: account?.phone ?? '',
      vendorId: partner.vendorId ? partner.vendorId.toString() : null,
      vehicleType: partner.vehicleType,
      status: partner.status,
      isOnline: partner.isOnline,
      isAvailable: partner.isAvailable,
      rating: partner.rating,
      completedCount: partner.completedCount,
      activeOrderId: partner.activeOrderId
        ? partner.activeOrderId.toString()
        : null,
      currentLocation: this.geo.toLatLng(partner.currentLocation),
      locationAt: partner.locationAt
        ? partner.locationAt.toISOString()
        : null,
      socketConnected: this.presence.isConnected(partner.userId.toString()),
      today: {
        deliveries: todays.filter(
          (row) => row.status === OrderStatus.DELIVERED,
        ).length,
        earningsPaise: todays
          .filter((row) => row.status === OrderStatus.DELIVERED)
          .reduce((sum, row) => sum + row.payoutPaise, 0),
        onlineMinutes: this.presence.onlineMinutesToday(
          partner.userId.toString(),
          now,
        ),
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Availability
  // ──────────────────────────────────────────────────────────────────

  /**
   * The on/off switch the rider app owns.
   *
   * Two invariants it enforces, both for the same reason — an order in
   * somebody's hands must never be invisible to dispatch:
   *
   *   • A rider carrying an order cannot go offline. The way out of a job
   *     is to deliver it or hand it back, not to close the app.
   *   • A rider carrying an order is never `isAvailable`, whatever they
   *     ask for. Availability is what the `$geoNear` pool filters on, and
   *     a busy rider in that pool receives an offer they cannot take.
   */
  async setAvailability(
    user: JwtUser,
    dto: AvailabilityDto,
  ): Promise<RiderProfile> {
    const partner = await this.requirePartner(user);

    if (!dto.isOnline && partner.activeOrderId) {
      throw new ConflictException(
        'You are carrying an order. Complete it or report it failed before ' +
          'going offline.',
      );
    }

    partner.isOnline = dto.isOnline;
    partner.isAvailable = dto.isOnline && dto.isAvailable && !partner.activeOrderId;
    await partner.save();

    return this.me(user);
  }

  // ──────────────────────────────────────────────────────────────────
  //  History
  // ──────────────────────────────────────────────────────────────────

  async history(
    user: JwtUser,
    query: DeliveryHistoryQueryDto,
  ): Promise<Paginated<DeliveryHistoryRow>> {
    const partner = await this.requirePartner(user);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<OrderDocument> = {
      deliveryPartnerId: partner._id,
      status: { $in: [...COMPLETED_STATUSES] },
    };

    const [orders, total] = await Promise.all([
      this.orders
        .find(filter)
        // Newest first, and deliberately NOT client-sortable: there is no
        // second useful ordering for a delivery log, and an arbitrary
        // sort key from the client is an unindexed scan waiting to happen.
        .sort({ deliveredAt: -1, placedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.orders.countDocuments(filter).exec(),
    ]);

    const pickups = await this.pickupPoints(orders);

    const rows = orders.map((order) => {
      const distanceKm = this.geo.distanceKm(
        pickups.get(order.vendorId.toString()) ?? null,
        order.address.location,
      );

      return {
        orderId: order._id.toString(),
        orderNo: order.orderNo,
        status: order.status,
        deliveredAt: order.deliveredAt
          ? order.deliveredAt.toISOString()
          : null,
        city: order.address.city,
        pincode: order.address.pincode,
        distanceKm,
        payoutPaise:
          order.status === OrderStatus.DELIVERED
            ? this.geo.payoutPaise(distanceKm)
            : 0,
        codCollectedPaise:
          order.status === OrderStatus.DELIVERED ? codAmountOf(order) : 0,
      };
    });

    return paginate(rows, total, page, limit);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Earnings
  // ──────────────────────────────────────────────────────────────────

  /**
   * Earnings over a window, day by day.
   *
   * Every figure is DERIVED from the delivered orders and the stored
   * pickup/drop points, so the statement and the offer card cannot
   * disagree: both call `GeoService.payoutPaise` on the same distance.
   * Storing the payout on the order instead would be one more number to
   * keep in step, and the one that drifts is always the one somebody is
   * paid from.
   */
  async earnings(
    user: JwtUser,
    query: EarningsQueryDto,
  ): Promise<EarningsSummary> {
    const partner = await this.requirePartner(user);

    const to = query.to ? endOfDay(new Date(query.to)) : new Date();
    const from = query.from
      ? startOfDay(new Date(query.from))
      : startOfDay(
          new Date(to.getTime() - DEFAULT_EARNINGS_WINDOW_DAYS * 86_400_000),
        );

    if (from > to) {
      throw new ConflictException('`from` must not be after `to`');
    }

    const rows = await this.completedOrders({
      partnerId: partner._id,
      from,
      to,
    });

    const delivered = rows.filter(
      (row) => row.status === OrderStatus.DELIVERED,
    );

    const byDay = new Map<string, EarningsDay>();
    for (const row of delivered) {
      const key = row.at.toISOString().slice(0, 10);
      const day = byDay.get(key) ?? { date: key, deliveries: 0, payoutPaise: 0 };
      day.deliveries += 1;
      day.payoutPaise += row.payoutPaise;
      byDay.set(key, day);
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      deliveries: delivered.length,
      payoutPaise: delivered.reduce((sum, row) => sum + row.payoutPaise, 0),
      codCollectedPaise: delivered.reduce(
        (sum, row) => sum + row.codCollectedPaise,
        0,
      ),
      byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Shared
  // ──────────────────────────────────────────────────────────────────

  /** Completed work in a window, with the payout already computed. */
  private async completedOrders(params: {
    partnerId: Types.ObjectId;
    from: Date;
    to: Date;
  }): Promise<
    {
      status: OrderStatus;
      at: Date;
      payoutPaise: number;
      codCollectedPaise: number;
    }[]
  > {
    const orders = await this.orders
      .find({
        deliveryPartnerId: params.partnerId,
        status: { $in: [...COMPLETED_STATUSES] },
        // A failed attempt has no deliveredAt, so the window falls back
        // to when the order was placed rather than dropping the row.
        $or: [
          { deliveredAt: { $gte: params.from, $lte: params.to } },
          {
            deliveredAt: null,
            placedAt: { $gte: params.from, $lte: params.to },
          },
        ],
      })
      .exec();

    const pickups = await this.pickupPoints(orders);

    return orders.map((order) => {
      const distanceKm = this.geo.distanceKm(
        pickups.get(order.vendorId.toString()) ?? null,
        order.address.location,
      );

      return {
        status: order.status,
        at: order.deliveredAt ?? order.placedAt,
        payoutPaise:
          order.status === OrderStatus.DELIVERED
            ? this.geo.payoutPaise(distanceKm)
            : 0,
        codCollectedPaise:
          order.status === OrderStatus.DELIVERED ? codAmountOf(order) : 0,
      };
    });
  }

  /** Store locations for a batch of orders — one query, not one per row. */
  private async pickupPoints(
    orders: OrderDocument[],
  ): Promise<Map<string, GeoPoint | null>> {
    if (orders.length === 0) return new Map();

    const vendorIds = [
      ...new Map(
        orders.map((order) => [order.vendorId.toString(), order.vendorId]),
      ).values(),
    ];

    const vendors = await this.vendors
      .find({ _id: { $in: vendorIds } })
      .select('location')
      .lean<{ _id: Types.ObjectId; location?: GeoPoint | null }[]>()
      .exec();

    return new Map(
      vendors.map((vendor) => [vendor._id.toString(), vendor.location ?? null]),
    );
  }
}

const startOfDay = (at: Date): Date => {
  const copy = new Date(at);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const endOfDay = (at: Date): Date => {
  const copy = new Date(at);
  copy.setHours(23, 59, 59, 999);
  return copy;
};
