import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import { FAILED_STATUSES } from '../../../common/constants/order-status.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../audit/audit.service';
import { escapeRegex } from '../common/dto';
import {
  ListVendorsQueryDto,
  UpdateVendorCommissionDto,
  UpdateVendorStatusDto,
} from './dto';

export interface VendorRow {
  id: string;
  ownerId: string;
  storeName: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
  };
  location: { lat: number; lng: number } | null;
  serviceRadiusKm: number;
  /** Percent. The rate applied to FUTURE orders. */
  commissionPct: number;
  codEnabled: boolean;
  /** INTEGER PAISE. */
  codMaxAmount: number;
  isOpen: boolean;
  openingHours: { day: number; open: string; close: string }[];
  status: VendorStatus;
  rating: number;
  statusReason: string | null;
  /** Lifetime, excluding cancelled and rejected orders. INTEGER PAISE. */
  gmv: number;
  orderCount: number;
  createdAt: string | null;
}

type VendorRecord = Vendor & {
  _id: Types.ObjectId;
  createdAt?: Date;
  gmv?: number;
  orderCount?: number;
};

@Injectable()
export class AdminVendorsService {
  /** Allowlist — an arbitrary sort key is attacker-controlled input. */
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'createdAt',
    'storeName',
    'commissionPct',
    'rating',
    'status',
    'gmv',
    'orderCount',
  ]);

  constructor(
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly audit: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  //  Reads
  // ────────────────────────────────────────────────────────────────────

  /**
   * The vendor table, with lifetime GMV and order count joined in.
   *
   * The `$lookup` runs a grouped sub-pipeline per vendor rather than
   * pulling every order into memory and counting in Node. It is applied
   * AFTER `$skip`/`$limit` would be too late to matter for sorting on
   * `gmv`, so the join precedes the sort — the cost is bounded by the
   * number of vendors, which is a business-sized number, not a log-sized
   * one.
   */
  async list(query: ListVendorsQueryDto): Promise<Paginated<VendorRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<VendorDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.q) {
      const needle = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [
        { storeName: needle },
        { slug: needle },
        { 'address.city': needle },
        { 'address.pincode': needle },
      ];
    }

    const sort = this.resolveSort(query.sort);

    const pipeline: PipelineStage[] = [
      { $match: filter },
      {
        $lookup: {
          from: 'orders',
          let: { vendorId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$vendorId', '$$vendorId'] },
                status: { $nin: FAILED_STATUSES },
              },
            },
            {
              $group: {
                _id: null,
                gmv: { $sum: '$pricing.grandTotal' },
                orderCount: { $sum: 1 },
              },
            },
          ],
          as: 'stats',
        },
      },
      {
        $addFields: {
          gmv: { $ifNull: [{ $arrayElemAt: ['$stats.gmv', 0] }, 0] },
          orderCount: {
            $ifNull: [{ $arrayElemAt: ['$stats.orderCount', 0] }, 0],
          },
        },
      },
      { $project: { stats: 0 } },
      { $sort: sort },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ];

    const [rows, total] = await Promise.all([
      this.vendors.aggregate<VendorRecord>(pipeline).exec(),
      this.vendors.countDocuments(filter).exec(),
    ]);

    return paginate(rows.map(toRow), total, page, limit);
  }

  async findById(id: string): Promise<VendorRow> {
    const vendor = await this.mustFindLean(id);

    const [stats] = await this.vendors
      .aggregate<{ gmv: number; orderCount: number }>([
        { $match: { _id: vendor._id } },
        {
          $lookup: {
            from: 'orders',
            let: { vendorId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$vendorId', '$$vendorId'] },
                  status: { $nin: FAILED_STATUSES },
                },
              },
              {
                $group: {
                  _id: null,
                  gmv: { $sum: '$pricing.grandTotal' },
                  orderCount: { $sum: 1 },
                },
              },
            ],
            as: 'stats',
          },
        },
        { $unwind: { path: '$stats', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            gmv: { $ifNull: ['$stats.gmv', 0] },
            orderCount: { $ifNull: ['$stats.orderCount', 0] },
          },
        },
      ])
      .exec();

    return toRow({ ...vendor, ...stats });
  }

  // ────────────────────────────────────────────────────────────────────
  //  Writes
  // ────────────────────────────────────────────────────────────────────

  /**
   * Approve, suspend or return a vendor to the pending queue.
   *
   * Suspending requires a reason. The vendor will ask why, support will
   * ask who, and an audit entry that says only "status: suspended" answers
   * neither.
   */
  async updateStatus(
    id: string,
    dto: UpdateVendorStatusDto,
    actor: JwtUser,
  ): Promise<VendorRow> {
    const vendor = await this.mustFind(id);

    if (dto.status === VendorStatus.SUSPENDED && !dto.reason) {
      throw new BadRequestException(
        'A reason is required when suspending a vendor',
      );
    }

    const before = {
      status: vendor.status,
      statusReason: vendor.statusReason ?? null,
    };

    vendor.status = dto.status;
    vendor.statusReason = dto.reason ?? null;
    // A suspended store must stop taking orders immediately, not at the
    // next time its owner happens to toggle the shutter.
    if (dto.status !== VendorStatus.APPROVED) vendor.isOpen = false;

    await vendor.save();

    await this.audit.record({
      action: 'vendor.status.update',
      entity: 'Vendor',
      entityId: id,
      before,
      after: { status: vendor.status, statusReason: vendor.statusReason },
      actor,
    });

    return this.findById(id);
  }

  /**
   * SUPER_ADMIN only (enforced on the route) — this is a money policy.
   *
   * The new rate applies to orders placed from now on. Existing orders
   * carry `pricing.commissionPct` as a snapshot and are untouched, which
   * is the difference between "we changed our rate" and "we retroactively
   * re-billed every order you ever fulfilled".
   */
  async updateCommission(
    id: string,
    dto: UpdateVendorCommissionDto,
    actor: JwtUser,
  ): Promise<VendorRow> {
    const vendor = await this.mustFind(id);
    const before = { commissionPct: vendor.commissionPct };

    vendor.commissionPct = dto.commissionPct;
    await vendor.save();

    await this.audit.record({
      action: 'vendor.commission.update',
      entity: 'Vendor',
      entityId: id,
      before,
      after: { commissionPct: dto.commissionPct, reason: dto.reason ?? null },
      actor,
    });

    return this.findById(id);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────────────────────────

  /** 404 for a malformed id too, so ids cannot be probed for shape. */
  private async mustFind(id: string): Promise<VendorDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Vendor not found');
    }
    const vendor = await this.vendors.findById(id).exec();
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  private async mustFindLean(id: string): Promise<VendorRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Vendor not found');
    }
    const vendor = await this.vendors
      .findById(id)
      .lean<VendorRecord | null>()
      .exec();
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  private resolveSort(requested?: string): Record<string, 1 | -1> {
    if (!requested) return { createdAt: -1 };

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!AdminVendorsService.SORTABLE.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[...AdminVendorsService.SORTABLE].join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}

function toRow(vendor: VendorRecord): VendorRow {
  const coordinates = vendor.location?.coordinates;

  return {
    id: vendor._id.toString(),
    ownerId: vendor.ownerId?.toString() ?? '',
    storeName: vendor.storeName,
    slug: vendor.slug,
    description: vendor.description ?? null,
    logoUrl: vendor.logoUrl ?? null,
    bannerUrl: vendor.bannerUrl ?? null,
    address: {
      line1: vendor.address?.line1 ?? '',
      line2: vendor.address?.line2 ?? null,
      city: vendor.address?.city ?? '',
      state: vendor.address?.state ?? '',
      pincode: vendor.address?.pincode ?? '',
    },
    // Stored as GeoJSON [lng, lat]; exposed as named fields so no consumer
    // can transpose the pair by reading the array in the obvious order.
    location:
      Array.isArray(coordinates) && coordinates.length === 2
        ? { lng: coordinates[0], lat: coordinates[1] }
        : null,
    serviceRadiusKm: vendor.serviceRadiusKm,
    commissionPct: vendor.commissionPct,
    codEnabled: vendor.codEnabled,
    codMaxAmount: vendor.codMaxAmount,
    isOpen: vendor.isOpen,
    openingHours: (vendor.openingHours ?? []).map((hour) => ({
      day: hour.day,
      open: hour.open,
      close: hour.close,
    })),
    status: vendor.status,
    rating: vendor.rating,
    statusReason: vendor.statusReason ?? null,
    gmv: vendor.gmv ?? 0,
    orderCount: vendor.orderCount ?? 0,
    createdAt: vendor.createdAt ? new Date(vendor.createdAt).toISOString() : null,
  };
}
