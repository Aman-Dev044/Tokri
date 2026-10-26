import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  KycStatus,
  PartnerStatus,
  VehicleType,
} from '../../../database/schemas/delivery-partner.schema';
import {
  AssignmentStatus,
  DeliveryAssignment,
  DeliveryAssignmentDocument,
} from '../../../database/schemas/delivery-assignment.schema';
import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  RiderWallet,
  RiderWalletDocument,
} from '../../../database/schemas/rider-wallet.schema';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { UserStatus } from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { RiderKycService } from '../../delivery/rider-kyc.service';
import { RiderKycView } from '../../delivery/types';
import { UsersService } from '../../users/users.service';
import { AuditService } from '../audit/audit.service';
import { escapeRegex } from '../common/dto';
import { ListPartnersQueryDto, UpdatePartnerStatusDto } from './dto';

export interface PartnerRow {
  id: string;
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vehicleType: VehicleType;
  isOnline: boolean;
  isAvailable: boolean;
  status: PartnerStatus;
  statusReason: string | null;
  completedCount: number;
  rating: number;
  activeOrderId: string | null;
  /** The human-readable number of `activeOrderId`, resolved server-side. */
  activeOrderNo: string | null;
  location: { lat: number; lng: number } | null;
  /** The last location ping — the closest thing to "last seen" there is. */
  locationAt: string | null;
  createdAt: string | null;
}

/**
 * `GET /admin/delivery-partners/:id` — the row, plus what the detail screen
 * needs, every figure of it DERIVED from stored data.
 *
 * What is deliberately NOT here, because nothing records it:
 *  - an on-time rate: an order carries no promised delivery time to be on
 *    time against;
 *  - earnings: no EARNING row is ever written to the wallet ledger, so a
 *    rupee figure here would be a payout nobody has made;
 *  - distance per run: only straight-line points are stored, and a
 *    crow-flies kilometre beside a real time reads as a road distance.
 * A null below means "no data yet" (a rider with no answered offers has
 * no acceptance rate), never zero.
 */
export interface PartnerDetail extends PartnerRow {
  performance: {
    /** Orders this rider holds in DELIVERED, counted from `orders`. */
    deliveredCount: number;
    /** Orders this rider marked DELIVERY_FAILED, from the status history. */
    failedCount: number;
    /** Mean pickedUpAt → deliveredAt over delivered orders, whole minutes. */
    avgRunMinutes: number | null;
    /** Answered offers only: a live or withdrawn offer was never a choice. */
    offers: { accepted: number; rejected: number; expired: number };
    /** accepted / (accepted + rejected + expired), one decimal. */
    acceptRatePct: number | null;
    /** Delivered per week for the last 8 weeks, oldest first. */
    weeklyDelivered: number[];
  };
  currentAssignment: {
    orderId: string;
    orderNo: string;
    status: OrderStatus;
    customerName: string | null;
    pickup: string | null;
    dropCity: string;
    dropPincode: string;
    /** When the order last entered ASSIGNED — i.e. this rider accepted. */
    assignedAt: string | null;
  } | null;
  /** The 20 most recent finished runs (delivered or failed), newest first. */
  deliveries: PartnerDeliveryRow[];
  /**
   * The rider surface's own KYC view — numbers MASKED by the same
   * function the rider sees. The whole numbers stay on the one audited
   * route, `GET /admin/riders/:id/kyc`.
   */
  kyc: RiderKycView & { breached: boolean };
  /** No wallet row yet is a real zero: nothing has ever been credited. */
  walletBalancePaise: number;
}

export interface PartnerDeliveryRow {
  id: string;
  orderNo: string;
  vendorId: string;
  vendorName: string | null;
  status: OrderStatus;
  pickedUpAt: string | null;
  /** deliveredAt, or when the failure was recorded. */
  endedAt: string | null;
  /** pickedUpAt → deliveredAt; null for a failed run. */
  runMinutes: number | null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SPARK_WEEKS = 8;
const HISTORY_LIMIT = 20;

/**
 * The joins every partner row needs, minus the order lookup (which is
 * cheap enough per page but not worth running before pagination).
 *
 * The leading `$project` matters: an aggregation ignores the schema's
 * `select: false`, so without it the three government identifiers ride
 * along in the pipeline's output and only `toRow` stands between them and
 * a response body. One safeguard is not enough for an Aadhaar number.
 */
const PARTNER_JOINS: PipelineStage[] = [
  { $project: { aadhaarNumber: 0, panNumber: 0, drivingLicenceNumber: 0 } },
  {
    $lookup: {
      from: 'users',
      localField: 'userId',
      foreignField: '_id',
      // Explicit projection: an aggregation $lookup ignores the
      // schema's `select: false`, so without this the rider's
      // passwordHash would ride along in an admin list response.
      pipeline: [{ $project: { name: 1, phone: 1, email: 1 } }],
      as: 'user',
    },
  },
  { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: 'vendors',
      localField: 'vendorId',
      foreignField: '_id',
      pipeline: [{ $project: { storeName: 1 } }],
      as: 'vendor',
    },
  },
  { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
];

/** `activeOrderId` → its order number. Run after pagination. */
const ACTIVE_ORDER_JOIN: PipelineStage.FacetPipelineStage[] = [
  {
    $lookup: {
      from: 'orders',
      localField: 'activeOrderId',
      foreignField: '_id',
      pipeline: [{ $project: { orderNo: 1 } }],
      as: 'activeOrder',
    },
  },
  { $unwind: { path: '$activeOrder', preserveNullAndEmptyArrays: true } },
];

interface PartnerAggregateRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  vendorId?: Types.ObjectId | null;
  vehicleType: VehicleType;
  isOnline: boolean;
  isAvailable: boolean;
  status: PartnerStatus;
  statusReason?: string | null;
  completedCount: number;
  rating: number;
  activeOrderId?: Types.ObjectId | null;
  currentLocation?: { coordinates?: number[] } | null;
  locationAt?: Date | null;
  createdAt?: Date;
  user?: { name?: string; phone?: string; email?: string };
  vendor?: { storeName?: string };
  activeOrder?: { orderNo?: string };
}

/**
 * The rider's administrative state and their login account status are two
 * different things, and they must move together: a suspended rider whose
 * User is still ACTIVE keeps a working token and can carry on calling the
 * delivery endpoints.
 */
const USER_STATUS_FOR: Readonly<Record<PartnerStatus, UserStatus>> = {
  [PartnerStatus.ACTIVE]: UserStatus.ACTIVE,
  [PartnerStatus.PENDING]: UserStatus.PENDING,
  [PartnerStatus.SUSPENDED]: UserStatus.SUSPENDED,
};

@Injectable()
export class AdminDeliveryPartnersService {
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'createdAt',
    'completedCount',
    'rating',
    'status',
  ]);

  constructor(
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryAssignment.name)
    private readonly assignments: Model<DeliveryAssignmentDocument>,
    @InjectModel(RiderWallet.name)
    private readonly wallets: Model<RiderWalletDocument>,
    private readonly usersService: UsersService,
    private readonly kyc: RiderKycService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListPartnersQueryDto): Promise<Paginated<PartnerRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<DeliveryPartnerDocument> = {};
    if (query.isOnline !== undefined) filter.isOnline = query.isOnline;
    if (query.isAvailable !== undefined) filter.isAvailable = query.isAvailable;
    if (query.status) filter.status = query.status;
    if (query.vehicleType) filter.vehicleType = query.vehicleType;
    // One named vendor is narrower than "any vendor", so it wins.
    if (query.vendorId) {
      filter.vendorId = new Types.ObjectId(query.vendorId);
    } else if (query.fleet === 'pool') {
      filter.vendorId = null;
    } else if (query.fleet === 'vendor') {
      filter.vendorId = { $ne: null };
    }

    const sort = this.resolveSort(query.sort);

    const pipeline: PipelineStage[] = [{ $match: filter }, ...PARTNER_JOINS];

    if (query.q) {
      const needle = escapeRegex(query.q);
      pipeline.push({
        $match: {
          $or: [
            { 'user.name': { $regex: needle, $options: 'i' } },
            { 'user.phone': { $regex: needle, $options: 'i' } },
          ],
        },
      });
    }

    const [result] = await this.partners
      .aggregate<{ rows: PartnerAggregateRow[]; total: { count: number }[] }>([
        ...pipeline,
        {
          $facet: {
            rows: [
              { $sort: sort },
              { $skip: (page - 1) * limit },
              { $limit: limit },
              ...ACTIVE_ORDER_JOIN,
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const rows = result?.rows ?? [];
    const total = result?.total?.[0]?.count ?? 0;

    return paginate(rows.map(toRow), total, page, limit);
  }

  /**
   * One rider, with everything the detail screen draws.
   *
   * The five reads below are independent and run together. Each one is
   * scoped by an indexed key (`deliveryPartnerId`, `partnerId`, `_id`)
   * except the failure count — see `countFailures`.
   */
  async findById(id: string): Promise<PartnerDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Delivery partner not found');
    }
    const partnerId = new Types.ObjectId(id);

    const [row] = await this.partners
      .aggregate<PartnerAggregateRow>([
        { $match: { _id: partnerId } },
        ...PARTNER_JOINS,
        ...ACTIVE_ORDER_JOIN,
      ])
      .exec();

    if (!row) throw new NotFoundException('Delivery partner not found');

    const [performance, currentAssignment, deliveries, kyc, wallet] =
      await Promise.all([
        this.performance(partnerId, row.userId),
        row.activeOrderId
          ? this.currentAssignment(row.activeOrderId)
          : Promise.resolve(null),
        this.recentDeliveries(partnerId),
        this.kycView(partnerId),
        this.wallets
          .findOne({ partnerId })
          .select('balancePaise')
          .lean<{ balancePaise: number } | null>()
          .exec(),
      ]);

    return {
      ...toRow(row),
      performance,
      currentAssignment,
      deliveries,
      kyc,
      walletBalancePaise: wallet?.balancePaise ?? 0,
    };
  }

  /**
   * Suspend, reactivate or re-pend a rider.
   *
   * Suspension does three things together, and all three matter:
   *  1. the partner record goes offline and unavailable, so the assignment
   *     algorithm stops offering them jobs;
   *  2. their User account is moved to the matching status through
   *     `UsersService`, which clears the refresh-token family — without
   *     this they keep a working token and the delivery endpoints stay
   *     open to them;
   *  3. the reason is recorded, on the record and in the audit trail.
   */
  async updateStatus(
    id: string,
    dto: UpdatePartnerStatusDto,
    actor: JwtUser,
  ): Promise<PartnerDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Delivery partner not found');
    }
    const partner = await this.partners.findById(id).exec();
    if (!partner) throw new NotFoundException('Delivery partner not found');

    if (dto.status === PartnerStatus.SUSPENDED && !dto.reason) {
      throw new BadRequestException(
        'A reason is required when suspending a delivery partner',
      );
    }

    const before = { status: partner.status, isOnline: partner.isOnline };

    partner.status = dto.status;
    partner.statusReason = dto.reason ?? null;
    if (dto.status !== PartnerStatus.ACTIVE) {
      partner.isOnline = false;
      partner.isAvailable = false;
    }
    await partner.save();

    await this.usersService.updateStatus(
      partner.userId.toString(),
      { status: USER_STATUS_FOR[dto.status], reason: dto.reason },
      actor,
    );

    await this.audit.record({
      action: 'delivery-partner.status.update',
      entity: 'DeliveryPartner',
      entityId: id,
      before,
      after: {
        status: partner.status,
        isOnline: partner.isOnline,
        reason: dto.reason ?? null,
      },
      actor,
    });

    return this.findById(id);
  }

  // ── The detail screen's reads ─────────────────────────────────────

  private async performance(
    partnerId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<PartnerDetail['performance']> {
    const now = Date.now();
    const since = new Date(now - SPARK_WEEKS * WEEK_MS);

    const [runs, failedCount, offerRows, recent] = await Promise.all([
      this.orders
        .aggregate<{ deliveredCount: number; avgRunMs: number | null }>([
          {
            $match: {
              deliveryPartnerId: partnerId,
              status: OrderStatus.DELIVERED,
            },
          },
          {
            $group: {
              _id: null,
              deliveredCount: { $sum: 1 },
              // `$subtract` with a missing side is null, and `$avg`
              // skips nulls — so an order delivered without a recorded
              // pickup drops out of the mean instead of dragging it.
              avgRunMs: { $avg: { $subtract: ['$deliveredAt', '$pickedUpAt'] } },
            },
          },
        ])
        .exec(),
      this.countFailures(userId),
      this.assignments
        .aggregate<{ _id: AssignmentStatus; count: number }>([
          {
            $match: {
              partnerId,
              // OFFERED is still live and CANCELLED was withdrawn by the
              // platform: neither was the rider's choice.
              status: {
                $in: [
                  AssignmentStatus.ACCEPTED,
                  AssignmentStatus.REJECTED,
                  AssignmentStatus.EXPIRED,
                ],
              },
            },
          },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ])
        .exec(),
      this.orders
        .find({
          deliveryPartnerId: partnerId,
          status: OrderStatus.DELIVERED,
          deliveredAt: { $gte: since },
        })
        .select('deliveredAt')
        .lean<{ deliveredAt?: Date | null }[]>()
        .exec(),
    ]);

    const countOf = (status: AssignmentStatus): number =>
      offerRows.find((entry) => entry._id === status)?.count ?? 0;
    const offers = {
      accepted: countOf(AssignmentStatus.ACCEPTED),
      rejected: countOf(AssignmentStatus.REJECTED),
      expired: countOf(AssignmentStatus.EXPIRED),
    };
    const answered = offers.accepted + offers.rejected + offers.expired;

    const weeklyDelivered = new Array<number>(SPARK_WEEKS).fill(0);
    for (const order of recent) {
      if (!order.deliveredAt) continue;
      const weeksAgo = Math.floor(
        (now - new Date(order.deliveredAt).getTime()) / WEEK_MS,
      );
      if (weeksAgo >= 0 && weeksAgo < SPARK_WEEKS) {
        weeklyDelivered[SPARK_WEEKS - 1 - weeksAgo] += 1;
      }
    }

    const avgRunMs = runs[0]?.avgRunMs ?? null;

    return {
      deliveredCount: runs[0]?.deliveredCount ?? 0,
      failedCount,
      avgRunMinutes: avgRunMs === null ? null : Math.round(avgRunMs / 60_000),
      offers,
      acceptRatePct:
        answered === 0
          ? null
          : Math.round((offers.accepted / answered) * 1000) / 10,
      weeklyDelivered,
    };
  }

  /**
   * Orders on which THIS rider recorded DELIVERY_FAILED.
   *
   * Matched on the status history's actor rather than on
   * `deliveryPartnerId`, because a failed order is usually re-dispatched
   * and then carries the NEXT rider's id — scoping by the current holder
   * would quietly forget the failure. The history is not indexed, so this
   * is a scan; it runs for one rider, on demand, from one admin screen.
   */
  private countFailures(userId: Types.ObjectId): Promise<number> {
    return this.orders
      .countDocuments({
        statusHistory: {
          $elemMatch: { to: OrderStatus.DELIVERY_FAILED, byUserId: userId },
        },
      })
      .exec();
  }

  private async currentAssignment(
    orderId: Types.ObjectId,
  ): Promise<PartnerDetail['currentAssignment']> {
    const [order] = await this.orders
      .aggregate<{
        _id: Types.ObjectId;
        orderNo: string;
        status: OrderStatus;
        address?: { city?: string; pincode?: string };
        statusHistory?: { to: OrderStatus; at: Date }[];
        customer?: { name?: string };
        vendor?: { storeName?: string };
      }>([
        { $match: { _id: orderId } },
        // Inclusion projection: the OTP hash is `select: false`, which an
        // aggregation does not honour.
        {
          $project: {
            orderNo: 1,
            status: 1,
            customerId: 1,
            vendorId: 1,
            'address.city': 1,
            'address.pincode': 1,
            statusHistory: 1,
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'customerId',
            foreignField: '_id',
            pipeline: [{ $project: { name: 1 } }],
            as: 'customer',
          },
        },
        { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'vendors',
            localField: 'vendorId',
            foreignField: '_id',
            pipeline: [{ $project: { storeName: 1 } }],
            as: 'vendor',
          },
        },
        { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
      ])
      .exec();

    // A dangling `activeOrderId` — the order is gone. Say so by saying
    // nothing, rather than inventing an assignment around a bare id.
    if (!order) return null;

    return {
      orderId: order._id.toString(),
      orderNo: order.orderNo,
      status: order.status,
      customerName: order.customer?.name ?? null,
      pickup: order.vendor?.storeName ?? null,
      dropCity: order.address?.city ?? '',
      dropPincode: order.address?.pincode ?? '',
      assignedAt: lastTransitionAt(order.statusHistory, OrderStatus.ASSIGNED),
    };
  }

  private async recentDeliveries(
    partnerId: Types.ObjectId,
  ): Promise<PartnerDeliveryRow[]> {
    const rows = await this.orders
      .aggregate<{
        _id: Types.ObjectId;
        orderNo: string;
        vendorId: Types.ObjectId;
        status: OrderStatus;
        pickedUpAt?: Date | null;
        deliveredAt?: Date | null;
        statusHistory?: { to: OrderStatus; at: Date }[];
        vendor?: { storeName?: string };
      }>([
        {
          $match: {
            deliveryPartnerId: partnerId,
            status: {
              $in: [OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED],
            },
          },
        },
        // `updatedAt` is when the run ended for both outcomes — a failed
        // run has no `deliveredAt` to sort on.
        { $sort: { updatedAt: -1 } },
        { $limit: HISTORY_LIMIT },
        {
          $project: {
            orderNo: 1,
            vendorId: 1,
            status: 1,
            pickedUpAt: 1,
            deliveredAt: 1,
            statusHistory: 1,
          },
        },
        {
          $lookup: {
            from: 'vendors',
            localField: 'vendorId',
            foreignField: '_id',
            pipeline: [{ $project: { storeName: 1 } }],
            as: 'vendor',
          },
        },
        { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
      ])
      .exec();

    return rows.map((order) => {
      const delivered = order.status === OrderStatus.DELIVERED;
      const pickedUpAt = order.pickedUpAt ? new Date(order.pickedUpAt) : null;
      const deliveredAt = order.deliveredAt
        ? new Date(order.deliveredAt)
        : null;

      return {
        id: order._id.toString(),
        orderNo: order.orderNo,
        vendorId: order.vendorId.toString(),
        vendorName: order.vendor?.storeName ?? null,
        status: order.status,
        pickedUpAt: pickedUpAt ? pickedUpAt.toISOString() : null,
        endedAt: delivered
          ? deliveredAt
            ? deliveredAt.toISOString()
            : null
          : lastTransitionAt(order.statusHistory, OrderStatus.DELIVERY_FAILED),
        runMinutes:
          delivered && pickedUpAt && deliveredAt
            ? Math.round((deliveredAt.getTime() - pickedUpAt.getTime()) / 60_000)
            : null,
      };
    });
  }

  /**
   * The rider's KYC, MASKED — through `RiderKycService.toView`, the same
   * function the rider's own screen uses, so the console cannot mask a
   * number differently from the app. The numbers are selected here only
   * to be reduced to their last four before anything is returned.
   */
  private async kycView(
    partnerId: Types.ObjectId,
  ): Promise<PartnerDetail['kyc']> {
    const partner = await this.partners
      .findById(partnerId)
      .select('+aadhaarNumber +panNumber +drivingLicenceNumber')
      .exec();
    if (!partner) throw new NotFoundException('Delivery partner not found');

    const due = partner.kycSlaDueAt ?? null;
    return {
      ...this.kyc.toView(partner),
      // The rider view clamps the countdown at zero; an operator needs to
      // know the promise was already missed.
      breached:
        partner.kycStatus === KycStatus.SUBMITTED &&
        due !== null &&
        due.getTime() < Date.now(),
    };
  }

  private resolveSort(requested?: string): Record<string, 1 | -1> {
    if (!requested) return { createdAt: -1 };

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!AdminDeliveryPartnersService.SORTABLE.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[
          ...AdminDeliveryPartnersService.SORTABLE,
        ].join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}

function toRow(partner: PartnerAggregateRow): PartnerRow {
  const coordinates = partner.currentLocation?.coordinates;

  return {
    id: partner._id.toString(),
    userId: partner.userId.toString(),
    name: partner.user?.name ?? null,
    phone: partner.user?.phone ?? null,
    email: partner.user?.email ?? null,
    vendorId: partner.vendorId ? partner.vendorId.toString() : null,
    vendorName: partner.vendor?.storeName ?? null,
    vehicleType: partner.vehicleType,
    isOnline: partner.isOnline,
    isAvailable: partner.isAvailable,
    status: partner.status,
    statusReason: partner.statusReason ?? null,
    completedCount: partner.completedCount,
    rating: partner.rating,
    activeOrderId: partner.activeOrderId
      ? partner.activeOrderId.toString()
      : null,
    activeOrderNo: partner.activeOrder?.orderNo ?? null,
    location:
      Array.isArray(coordinates) && coordinates.length === 2
        ? { lng: coordinates[0], lat: coordinates[1] }
        : null,
    locationAt: partner.locationAt
      ? new Date(partner.locationAt).toISOString()
      : null,
    createdAt: partner.createdAt
      ? new Date(partner.createdAt).toISOString()
      : null,
  };
}

/** When the order last moved INTO `status`, from its own history. */
function lastTransitionAt(
  history: { to: OrderStatus; at: Date }[] | undefined,
  status: OrderStatus,
): string | null {
  const entry = [...(history ?? [])]
    .reverse()
    .find((change) => change.to === status);
  return entry ? new Date(entry.at).toISOString() : null;
}
