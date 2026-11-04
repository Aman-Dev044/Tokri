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
import { Role, UserStatus } from '../../../common/constants/roles.enum';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  StaffRow,
  toStaffRow,
} from '../../vendor/staff/staff.service';
import { UsersService } from '../../users/users.service';
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

/**
 * `GET /admin/vendors/:id` — the row, plus who to call.
 *
 * A vendor document carries no contact details of its own: the name and
 * phone an operator dials belong to the owner's User account. The list
 * leaves them out (a join per row for a column nobody sorts on); the
 * detail view is where "who runs this shop" is the question.
 *
 * `owner` is null when the account behind `ownerId` no longer exists —
 * reported as missing, not papered over with the store's name.
 */
export interface VendorDetailRow extends VendorRow {
  owner: VendorOwnerView | null;
}

export interface VendorOwnerView {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

type VendorRecord = Vendor & {
  _id: Types.ObjectId;
  createdAt?: Date;
  gmv?: number;
  orderCount?: number;
};

const USER_STATUS_FOR: Readonly<Record<VendorStatus, UserStatus>> = {
  [VendorStatus.APPROVED]: UserStatus.ACTIVE,
  [VendorStatus.PENDING]: UserStatus.PENDING,
  [VendorStatus.SUSPENDED]: UserStatus.SUSPENDED,
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
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly usersService: UsersService,
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

  async findById(id: string): Promise<VendorDetailRow> {
    const vendor = await this.mustFindLean(id);

    const [stats] = await this.vendors
      .aggregate<{
        gmv: number;
        orderCount: number;
        owner: (Omit<VendorOwnerView, 'id'> & { _id: Types.ObjectId }) | null;
      }>([
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
          // `select: false` on the User schema is a QUERY feature that a
          // $lookup does not honour, so the owner is projected down to
          // the three contact fields INSIDE the sub-pipeline. A hash
          // never enters this document, rather than being stripped later.
          $lookup: {
            from: 'users',
            let: { ownerId: '$ownerId' },
            pipeline: [
              { $match: { $expr: { $eq: ['$_id', '$$ownerId'] } } },
              { $project: { _id: 1, name: 1, email: 1, phone: 1 } },
            ],
            as: 'owner',
          },
        },
        {
          $project: {
            _id: 0,
            gmv: { $ifNull: ['$stats.gmv', 0] },
            orderCount: { $ifNull: ['$stats.orderCount', 0] },
            owner: { $ifNull: [{ $arrayElemAt: ['$owner', 0] }, null] },
          },
        },
      ])
      .exec();

    const owner = stats?.owner ?? null;
    return {
      ...toRow({ ...vendor, gmv: stats?.gmv, orderCount: stats?.orderCount }),
      owner: owner
        ? {
            id: owner._id.toString(),
            name: owner.name,
            email: owner.email ?? null,
            phone: owner.phone || null,
          }
        : null,
    };
  }

  /**
   * The store's employees, read-only. Platform staff see who can act for
   * a store; managing them is the store's own business (`/vendor/staff`).
   * Same row shape as the vendor endpoint, so the two screens agree.
   */
  async staff(id: string): Promise<StaffRow[]> {
    const vendor = await this.mustFindLean(id);
    const rows = await this.users
      .find({ vendorId: vendor._id, role: Role.STAFF })
      .select(
        'name phone email role status vendorId staffProfile lastLoginAt createdAt updatedAt',
      )
      .sort({ createdAt: -1, _id: 1 })
      .limit(200)
      .lean<Parameters<typeof toStaffRow>[0][]>()
      .exec();
    return rows.map(toStaffRow);
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

    // The owner's LOGIN follows the store. A vendor applies with both the
    // account and the store PENDING, and login refuses anything that is not
    // ACTIVE, so approving only the store left an approved shop whose owner
    // could never sign in. Suspending goes through UsersService for the
    // same reason it does for riders: that clears the refresh-token family.
    if (vendor.ownerId) {
      await this.usersService.updateStatus(
        vendor.ownerId.toString(),
        { status: USER_STATUS_FOR[dto.status], reason: dto.reason },
        actor,
      );
    }

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
