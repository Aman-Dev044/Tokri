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
  PartnerStatus,
  VehicleType,
} from '../../../database/schemas/delivery-partner.schema';
import { UserStatus } from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
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
  location: { lat: number; lng: number } | null;
  locationAt: string | null;
  createdAt: string | null;
}

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
    private readonly usersService: UsersService,
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
    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);

    const sort = this.resolveSort(query.sort);

    const pipeline: PipelineStage[] = [
      { $match: filter },
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

  async findById(id: string): Promise<PartnerRow> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Delivery partner not found');
    }

    const [row] = await this.partners
      .aggregate<PartnerAggregateRow>([
        { $match: { _id: new Types.ObjectId(id) } },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
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
      ])
      .exec();

    if (!row) throw new NotFoundException('Delivery partner not found');
    return toRow(row);
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
  ): Promise<PartnerRow> {
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
