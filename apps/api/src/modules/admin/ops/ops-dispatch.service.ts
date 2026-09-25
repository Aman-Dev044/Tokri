import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
} from '../../../database/schemas/delivery-partner.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  Vendor,
  VendorDocument,
} from '../../../database/schemas/vendor.schema';
import {
  OrderStatus,
  canTransition,
} from '../../../common/constants/order-status.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import {
  AdminDeliveryPartnersService,
  PartnerRow,
} from '../delivery-partners/delivery-partners.service';
import { AdminSettingsService } from '../settings/settings.service';
import {
  OPS_CARD_PROJECTION,
  OpsCardsService,
  OpsOrderCard,
  OpsOrderRecord,
} from './ops-cards.service';
import { ON_DELIVERY_STATUSES } from './ops.service';
import { AssignRiderDto, UnassignRiderDto } from './dto';
import { haversineKm, minutesBetween } from './sla.util';

// ── Response shapes ─────────────────────────────────────────────────────

export interface NearestRider {
  id: string;
  name: string | null;
  distanceKm: number;
  isAvailable: boolean;
}

export interface UnassignedOrderRow extends OpsOrderCard {
  /** Minutes since the order was packed and ready. */
  waitingMinutes: number;
  nearestRiders: NearestRider[];
}

export interface DispatchRiderRow extends PartnerRow {
  activeOrderNo: string | null;
  minutesOnCurrentJob: number | null;
  distanceToDropKm: number | null;
}

export interface DispatchMonitor {
  unassigned: UnassignedOrderRow[];
  riders: DispatchRiderRow[];
}

// ── Tunables ────────────────────────────────────────────────────────────

/** Nearest-rider suggestions returned per order. */
const NEAREST_RIDER_CAP = 5;

/**
 * Unassigned orders shown at once.
 *
 * The geo search runs once per distinct VENDOR on this page, not once
 * per order, so the cost is bounded by the number of stores with work
 * waiting rather than by the length of the queue.
 */
const UNASSIGNED_CAP = 25;

/** Online riders listed on the monitor. */
const RIDER_CAP = 100;

interface UnassignedRecord extends OpsOrderRecord {
  dropLocation?: { coordinates?: number[] } | null;
}

interface GeoRiderRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  isAvailable: boolean;
  distanceMeters: number;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  DISPATCH
 * ════════════════════════════════════════════════════════════════════════
 *
 * The one place in the ADMIN console that writes to the order state
 * machine, so it is also the one place that has to be careful.
 *
 * Assigning a rider touches two documents — the order gains a partner and
 * a status, the partner gains an active order and loses availability. If
 * only the first lands, the board shows a rider who does not know they
 * have a job; if only the second, a rider is held against an order that
 * never moved. Both writes go in ONE transaction for exactly that reason.
 */
@Injectable()
export class AdminOpsDispatchService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly partnersService: AdminDeliveryPartnersService,
    private readonly cards: OpsCardsService,
    private readonly settings: AdminSettingsService,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Read — the monitor
  // ──────────────────────────────────────────────────────────────────

  async monitor(): Promise<DispatchMonitor> {
    const now = new Date();
    const config = await this.settings.get();

    const [unassigned, riders] = await Promise.all([
      this.unassignedOrders(now, config.slaMinutes),
      this.riderRows(),
    ]);

    return { unassigned, riders };
  }

  private async unassignedOrders(
    now: Date,
    slaMinutes: number,
  ): Promise<UnassignedOrderRow[]> {
    const records = await this.orders
      .aggregate<UnassignedRecord>([
        {
          $match: {
            status: OrderStatus.READY_FOR_PICKUP,
            deliveryPartnerId: null,
          },
        },
        // Longest wait first — this list IS the dispatch queue.
        { $sort: { placedAt: 1 } },
        { $limit: UNASSIGNED_CAP },
        {
          $project: {
            ...OPS_CARD_PROJECTION,
            dropLocation: '$address.location',
          },
        },
      ])
      .exec();

    if (records.length === 0) return [];

    const names = await this.cards.resolveNames(records);

    // One geo search per distinct vendor, reused by every order of theirs
    // waiting on the board.
    const vendorIds = [
      ...new Map(
        records.map((record) => [record.vendorId.toString(), record.vendorId]),
      ).values(),
    ];

    const vendors = await this.vendors
      .find({ _id: { $in: vendorIds } })
      .select('location serviceRadiusKm')
      .lean<
        {
          _id: Types.ObjectId;
          location?: { coordinates?: number[] } | null;
          serviceRadiusKm?: number;
        }[]
      >()
      .exec();

    const nearestByVendor = new Map<string, NearestRider[]>();
    for (const vendor of vendors) {
      nearestByVendor.set(
        vendor._id.toString(),
        await this.nearestRiders(
          vendor.location?.coordinates ?? null,
          vendor.serviceRadiusKm ?? 0,
        ),
      );
    }

    return records.map((record) => ({
      ...this.cards.toCard(record, names, now, slaMinutes),
      waitingMinutes: minutesBetween(
        new Date(record.readyAt ?? record.lastChangeAt ?? record.placedAt),
        now,
      ),
      nearestRiders: nearestByVendor.get(record.vendorId.toString()) ?? [],
    }));
  }

  /**
   * The five closest riders to a store, inside its service radius.
   *
   * `$geoNear` against the `currentLocation` 2dsphere index, so MongoDB
   * does the distance maths and the sort on an index rather than this
   * process scanning the fleet. It must be the FIRST stage of the
   * pipeline — that is a hard constraint of the operator, not a style
   * choice, and it is why the status filter travels in `query` rather
   * than as a preceding `$match`.
   */
  private async nearestRiders(
    coordinates: number[] | null,
    serviceRadiusKm: number,
  ): Promise<NearestRider[]> {
    if (
      !Array.isArray(coordinates) ||
      coordinates.length !== 2 ||
      serviceRadiusKm <= 0
    ) {
      return [];
    }

    // Narrowed to a fixed pair: `$geoNear` is typed as [lng, lat] and a
    // `number[]` could be three elements, which MongoDB would read as a
    // point with an altitude and silently return nothing.
    const near: [number, number] = [coordinates[0], coordinates[1]];

    const rows = await this.partners
      .aggregate<GeoRiderRow>([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: near },
            distanceField: 'distanceMeters',
            maxDistance: serviceRadiusKm * 1000,
            spherical: true,
            key: 'currentLocation',
            query: { status: PartnerStatus.ACTIVE, isOnline: true },
          },
        },
        { $limit: NEAREST_RIDER_CAP },
        { $project: { userId: 1, isAvailable: 1, distanceMeters: 1 } },
      ])
      .exec();

    if (rows.length === 0) return [];

    const riderUsers = await this.users
      .find({ _id: { $in: rows.map((row) => row.userId) } })
      .select('name')
      .lean<{ _id: Types.ObjectId; name: string }[]>()
      .exec();

    const nameById = new Map(
      riderUsers.map((user) => [user._id.toString(), user.name]),
    );

    return rows.map((row) => ({
      id: row._id.toString(),
      name: nameById.get(row.userId.toString()) ?? null,
      distanceKm: Math.round((row.distanceMeters / 1000) * 100) / 100,
      isAvailable: row.isAvailable,
    }));
  }

  private async riderRows(): Promise<DispatchRiderRow[]> {
    const now = new Date();

    const page = await this.partnersService.list({
      isOnline: true,
      page: 1,
      limit: RIDER_CAP,
    });
    const riders = page.data;
    if (riders.length === 0) return [];

    const partnerIds = riders.map((rider) => new Types.ObjectId(rider.id));

    const jobs = await this.orders
      .aggregate<{
        _id: Types.ObjectId;
        deliveryPartnerId: Types.ObjectId;
        orderNo: string;
        lastChangeAt: Date;
        dropLocation?: { coordinates?: number[] } | null;
      }>([
        {
          $match: {
            deliveryPartnerId: { $in: partnerIds },
            status: { $in: [...ON_DELIVERY_STATUSES] },
          },
        },
        { $sort: { placedAt: -1 } },
        {
          $project: {
            deliveryPartnerId: 1,
            orderNo: 1,
            dropLocation: '$address.location',
            lastChangeAt: {
              $ifNull: [
                { $arrayElemAt: ['$statusHistory.at', -1] },
                '$placedAt',
              ],
            },
          },
        },
      ])
      .exec();

    const jobByRider = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) {
      const key = job.deliveryPartnerId.toString();
      if (!jobByRider.has(key)) jobByRider.set(key, job);
    }

    return riders.map((rider) => {
      const job = jobByRider.get(rider.id);
      if (!job) {
        return {
          ...rider,
          activeOrderNo: null,
          minutesOnCurrentJob: null,
          distanceToDropKm: null,
        };
      }

      const drop = job.dropLocation?.coordinates;
      const from = rider.location
        ? ([rider.location.lng, rider.location.lat] as const)
        : null;
      const to =
        Array.isArray(drop) && drop.length === 2
          ? ([drop[0], drop[1]] as const)
          : null;

      return {
        ...rider,
        activeOrderNo: job.orderNo,
        minutesOnCurrentJob: minutesBetween(new Date(job.lastChangeAt), now),
        distanceToDropKm: haversineKm(from, to),
      };
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  Write — assign
  // ──────────────────────────────────────────────────────────────────

  async assign(dto: AssignRiderDto, actor: JwtUser): Promise<OpsOrderCard> {
    const now = new Date();
    const orderId = new Types.ObjectId(dto.orderId);
    const riderId = new Types.ObjectId(dto.riderId);

    const session = await this.connection.startSession();
    let previousStatus: OrderStatus = OrderStatus.READY_FOR_PICKUP;

    try {
      await session.withTransaction(async () => {
        const order = await this.orders
          .findById(orderId)
          .session(session)
          .exec();
        if (!order) throw new NotFoundException('Order not found');

        // The state machine is the authority. An admin override that
        // could assign a rider to a DELIVERED order would let support
        // reopen a completed delivery.
        if (!canTransition(order.status, OrderStatus.ASSIGNED)) {
          throw new ConflictException(
            `An order in status ${order.status} cannot be assigned to a rider`,
          );
        }

        const rider = await this.partners
          .findById(riderId)
          .session(session)
          .exec();
        if (!rider) throw new NotFoundException('Delivery partner not found');

        if (rider.status !== PartnerStatus.ACTIVE) {
          throw new ConflictException(
            `Delivery partner is ${rider.status} and cannot take an order`,
          );
        }

        await this.assertRiderIsFree(rider, orderId, session);

        previousStatus = order.status;

        order.status = OrderStatus.ASSIGNED;
        order.deliveryPartnerId = rider._id;
        order.statusHistory.push({
          from: previousStatus,
          to: OrderStatus.ASSIGNED,
          byUserId: toObjectIdOrNull(actor.sub),
          byRole: actor.role,
          reason: dto.reason ?? null,
          at: now,
        });
        await order.save({ session });

        rider.activeOrderId = order._id;
        // Held, not merely busy: the assignment algorithm must stop
        // offering this rider work the moment the order is theirs.
        rider.isAvailable = false;
        await rider.save({ session });
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'ops.dispatch.assign',
      entity: 'Order',
      entityId: dto.orderId,
      before: { status: previousStatus, deliveryPartnerId: null },
      after: {
        status: OrderStatus.ASSIGNED,
        deliveryPartnerId: dto.riderId,
        reason: dto.reason ?? null,
      },
      actor,
    });

    return this.cardOrThrow(orderId, now);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Write — unassign
  // ──────────────────────────────────────────────────────────────────

  /**
   * Takes an order back off a rider and returns it to the pool.
   *
   * `ASSIGNED → READY_FOR_PICKUP` is on the state machine precisely for
   * this case. Once the rider has picked the order up it is no longer a
   * dispatch decision — the goods have left the store — so anything past
   * ASSIGNED is a 409 rather than a silent correction.
   */
  async unassign(
    dto: UnassignRiderDto,
    actor: JwtUser,
  ): Promise<OpsOrderCard> {
    const now = new Date();
    const orderId = new Types.ObjectId(dto.orderId);

    const session = await this.connection.startSession();
    let previousRiderId: string | null = null;
    let previousStatus: OrderStatus = OrderStatus.ASSIGNED;

    try {
      await session.withTransaction(async () => {
        const order = await this.orders
          .findById(orderId)
          .session(session)
          .exec();
        if (!order) throw new NotFoundException('Order not found');

        if (!canTransition(order.status, OrderStatus.READY_FOR_PICKUP)) {
          throw new ConflictException(
            `An order in status ${order.status} cannot be returned to the pickup pool`,
          );
        }

        previousStatus = order.status;
        previousRiderId = order.deliveryPartnerId
          ? order.deliveryPartnerId.toString()
          : null;

        const riderId = order.deliveryPartnerId ?? null;

        order.status = OrderStatus.READY_FOR_PICKUP;
        order.deliveryPartnerId = null;
        order.statusHistory.push({
          from: previousStatus,
          to: OrderStatus.READY_FOR_PICKUP,
          byUserId: toObjectIdOrNull(actor.sub),
          byRole: actor.role,
          reason: dto.reason,
          at: now,
        });
        await order.save({ session });

        if (riderId) {
          await this.partners
            .updateOne(
              { _id: riderId, activeOrderId: order._id },
              { $set: { activeOrderId: null, isAvailable: true } },
              { session },
            )
            .exec();
        }
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'ops.dispatch.unassign',
      entity: 'Order',
      entityId: dto.orderId,
      before: { status: previousStatus, deliveryPartnerId: previousRiderId },
      after: {
        status: OrderStatus.READY_FOR_PICKUP,
        deliveryPartnerId: null,
        reason: dto.reason,
      },
      actor,
    });

    return this.cardOrThrow(orderId, now);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────

  /**
   * Two independent busy checks, because either one alone has a blind
   * spot: `activeOrderId` can be stale after a crash, and an order can
   * name a rider whose own record was never updated. A rider is free only
   * if BOTH agree.
   */
  private async assertRiderIsFree(
    rider: DeliveryPartnerDocument,
    orderId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    if (rider.activeOrderId && !rider.activeOrderId.equals(orderId)) {
      throw new ConflictException(
        'Delivery partner is already carrying another order',
      );
    }

    const inFlight = await this.orders
      .countDocuments({
        _id: { $ne: orderId },
        deliveryPartnerId: rider._id,
        status: { $in: [...ON_DELIVERY_STATUSES] },
      })
      .session(session)
      .exec();

    if (inFlight > 0) {
      throw new ConflictException(
        'Delivery partner is already carrying another order',
      );
    }
  }

  private async cardOrThrow(
    orderId: Types.ObjectId,
    now: Date,
  ): Promise<OpsOrderCard> {
    const config = await this.settings.get();
    const card = await this.cards.cardById(orderId, now, config.slaMinutes);
    if (!card) throw new NotFoundException('Order not found');
    return card;
  }
}

const toObjectIdOrNull = (value: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;
