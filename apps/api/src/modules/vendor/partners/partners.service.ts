import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
  VehicleType,
} from '../../../database/schemas/delivery-partner.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import { Role, UserStatus } from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { PasswordService } from '../../../common/utils/password.service';
import { AuditService } from '../../admin/audit/audit.service';
import { escapeRegex, iso, isDuplicateKeyError } from '../common/dto';
import { scopeId } from '../common/vendor-scope.decorator';
import {
  CreatePartnerDto,
  ListPartnersQueryDto,
  UpdatePartnerDto,
  UpdatePartnerStatusDto,
} from './dto';

export interface PartnerRow {
  id: string;
  userId: string;
  vendorId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  vehicleType: VehicleType;
  status: PartnerStatus;
  statusReason: string | null;
  isOnline: boolean;
  isAvailable: boolean;
  activeOrderId: string | null;
  completedCount: number;
  rating: number;
  location: { lat: number; lng: number } | null;
  locationAt: string | null;
  createdAt: string | null;
}

interface PartnerAggregateRow {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  vendorId?: Types.ObjectId | null;
  vehicleType: VehicleType;
  status: PartnerStatus;
  statusReason?: string | null;
  isOnline: boolean;
  isAvailable: boolean;
  activeOrderId?: Types.ObjectId | null;
  completedCount: number;
  rating: number;
  currentLocation?: { coordinates?: number[] } | null;
  locationAt?: Date | null;
  createdAt?: Date;
  user?: { name?: string; phone?: string; email?: string };
}

/**
 * The rider's administrative state and their login account status are two
 * different things that must move together.
 */
const USER_STATUS_FOR: Readonly<Record<PartnerStatus, UserStatus>> = {
  [PartnerStatus.ACTIVE]: UserStatus.ACTIVE,
  [PartnerStatus.PENDING]: UserStatus.PENDING,
  [PartnerStatus.SUSPENDED]: UserStatus.SUSPENDED,
};

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE STORE'S OWN RIDERS
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── Two documents, one transaction ──────────────────────────────────────
 * A rider is a `User` (the login) plus a `DeliveryPartner` (the operating
 * record). Created separately, a crash between them leaves either an
 * account that can log in and see nothing, or a partner record nobody can
 * sign in as — and the phone number is now taken, so the vendor cannot
 * simply try again.
 *
 * ── The password ────────────────────────────────────────────────────────
 * Hashed with `PasswordService` (argon2id + the ARGON2_PEPPER from the
 * environment) before it reaches the database. It is never echoed back
 * and never logged.
 *
 * ── Tenancy ─────────────────────────────────────────────────────────────
 * `vendorId` is stamped from the JWT scope on creation and is part of the
 * filter on every read and write. Another store's rider is a 404 here,
 * not a 403.
 */
@Injectable()
export class VendorPartnersService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Read
  // ──────────────────────────────────────────────────────────────────

  async list(
    vendorScope: string,
    query: ListPartnersQueryDto,
  ): Promise<Paginated<PartnerRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<DeliveryPartnerDocument> = {
      vendorId: scopeId(vendorScope),
    };
    if (query.status) filter.status = query.status;
    if (query.vehicleType) filter.vehicleType = query.vehicleType;
    if (query.isOnline !== undefined) filter.isOnline = query.isOnline;
    if (query.isAvailable !== undefined) filter.isAvailable = query.isAvailable;

    const pipeline: PipelineStage[] = [{ $match: filter }, ...LOOKUP_USER];

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
              { $sort: { createdAt: -1, _id: 1 } },
              { $skip: (page - 1) * limit },
              { $limit: limit },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    return paginate(
      (result?.rows ?? []).map(toPartnerRow),
      result?.total?.[0]?.count ?? 0,
      page,
      limit,
    );
  }

  async findOne(vendorScope: string, id: string): Promise<PartnerRow> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Delivery partner not found');
    }

    const [row] = await this.partners
      .aggregate<PartnerAggregateRow>([
        {
          $match: {
            _id: new Types.ObjectId(id),
            vendorId: scopeId(vendorScope),
          },
        },
        ...LOOKUP_USER,
      ])
      .exec();

    if (!row) throw new NotFoundException('Delivery partner not found');
    return toPartnerRow(row);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Create
  // ──────────────────────────────────────────────────────────────────

  async create(
    vendorScope: string,
    dto: CreatePartnerDto,
    actor: JwtUser,
  ): Promise<PartnerRow> {
    const vendorId = scopeId(vendorScope);

    // Hashed OUTSIDE the transaction: argon2id at the OWASP parameters
    // takes tens of milliseconds, and holding a Mongo transaction open
    // across it would lock the documents for no reason.
    const passwordHash = await this.passwords.hash(dto.password);

    const session = await this.connection.startSession();
    let partnerId: Types.ObjectId | null = null;

    try {
      await session.withTransaction(async () => {
        const [user] = await this.users.create(
          [
            {
              name: dto.name,
              email: dto.email,
              phone: dto.phone,
              passwordHash,
              role: Role.DELIVERY,
              status: UserStatus.ACTIVE,
              // The rider inherits the creating store's tenancy from the
              // JWT — never from the request body.
              vendorId,
            },
          ],
          { session },
        );

        const [partner] = await this.partners.create(
          [
            {
              userId: user._id,
              vendorId,
              vehicleType: dto.vehicleType,
              isAvailable: false,
              isOnline: false,
              status: PartnerStatus.ACTIVE,
            },
          ],
          { session },
        );

        partnerId = partner._id;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'That phone number or email already belongs to an account',
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (!partnerId) throw new ConflictException('Partner creation failed');

    await this.audit.record({
      action: 'vendor.partner.create',
      entity: 'DeliveryPartner',
      entityId: String(partnerId),
      before: null,
      // The password is deliberately absent. An audit trail exists to be
      // read by people investigating an incident; it must not be a
      // second archive of credentials.
      after: {
        name: dto.name,
        phone: dto.phone,
        vehicleType: dto.vehicleType,
      },
      actor,
    });

    return this.findOne(vendorScope, String(partnerId));
  }

  // ──────────────────────────────────────────────────────────────────
  //  Update
  // ──────────────────────────────────────────────────────────────────

  async update(
    vendorScope: string,
    id: string,
    dto: UpdatePartnerDto,
    actor: JwtUser,
  ): Promise<PartnerRow> {
    const partner = await this.mustFindOwn(vendorScope, id);
    const before = { vehicleType: partner.vehicleType };

    if (dto.vehicleType !== undefined) partner.vehicleType = dto.vehicleType;
    await partner.save();

    if (dto.name !== undefined || dto.email !== undefined) {
      const update: Record<string, unknown> = {};
      if (dto.name !== undefined) update.name = dto.name;
      if (dto.email !== undefined) update.email = dto.email;

      try {
        await this.users
          .updateOne(
            // The user filter carries the tenancy too, so a tampered
            // `userId` on the partner record still cannot reach an
            // account outside this store.
            { _id: partner.userId, vendorId: scopeId(vendorScope) },
            { $set: update },
          )
          .exec();
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ConflictException('That email already belongs to an account');
        }
        throw error;
      }
    }

    await this.audit.record({
      action: 'vendor.partner.update',
      entity: 'DeliveryPartner',
      entityId: id,
      before,
      after: {
        vehicleType: partner.vehicleType,
        name: dto.name ?? null,
        email: dto.email ?? null,
      },
      actor,
    });

    return this.findOne(vendorScope, id);
  }

  /**
   * Suspend, re-activate or hold a rider.
   *
   * The partner record and the login account move in ONE transaction. A
   * suspended rider whose `User` is still ACTIVE keeps a valid access
   * token until it expires and can carry on calling `/delivery/*` — the
   * suspension would be a label rather than a control.
   */
  async setStatus(
    vendorScope: string,
    id: string,
    dto: UpdatePartnerStatusDto,
    actor: JwtUser,
  ): Promise<PartnerRow> {
    const partner = await this.mustFindOwn(vendorScope, id);

    if (
      dto.status !== PartnerStatus.ACTIVE &&
      partner.activeOrderId !== null &&
      partner.activeOrderId !== undefined
    ) {
      throw new ConflictException(
        'This rider is carrying an order. Reassign it before suspending them.',
      );
    }

    const before = { status: partner.status, isOnline: partner.isOnline };

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        partner.status = dto.status;
        partner.statusReason = dto.reason ?? null;
        if (dto.status !== PartnerStatus.ACTIVE) {
          partner.isOnline = false;
          partner.isAvailable = false;
        }
        await partner.save({ session });

        await this.users
          .updateOne(
            { _id: partner.userId, vendorId: scopeId(vendorScope) },
            {
              $set: { status: USER_STATUS_FOR[dto.status] },
              // Revokes every live session: rotation cannot continue a
              // family that no longer exists.
              ...(dto.status === PartnerStatus.ACTIVE
                ? {}
                : { $unset: { refreshTokenFamily: '', refreshTokenHash: '' } }),
            },
          )
          .session(session)
          .exec();
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'vendor.partner.status',
      entity: 'DeliveryPartner',
      entityId: id,
      before,
      after: { status: dto.status, reason: dto.reason ?? null },
      actor,
    });

    return this.findOne(vendorScope, id);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Delete
  // ──────────────────────────────────────────────────────────────────

  /**
   * Removes a rider who never took an order.
   *
   * Once orders reference `deliveryPartnerId`, deletion would orphan
   * delivery history — so it is refused with a 409 that names the
   * alternative. That is the honest answer: "suspend instead" preserves
   * the audit trail, and a vendor who really wants the record gone is
   * asking for something the platform should not do quietly.
   */
  async remove(
    vendorScope: string,
    id: string,
    actor: JwtUser,
  ): Promise<void> {
    const partner = await this.mustFindOwn(vendorScope, id);

    if (partner.activeOrderId) {
      throw new ConflictException(
        'This rider is carrying an order and cannot be removed',
      );
    }

    const history = await this.orders
      .countDocuments({
        vendorId: scopeId(vendorScope),
        deliveryPartnerId: partner._id,
      })
      .exec();

    if (history > 0) {
      throw new ConflictException(
        `This rider has ${history} order(s) in their history, which would be ` +
          'orphaned by a delete. Suspend them instead: PATCH ' +
          '/vendor/delivery-partners/:id/status { "status": "suspended" }.',
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.partners
          .deleteOne({ _id: partner._id, vendorId: scopeId(vendorScope) })
          .session(session)
          .exec();

        await this.users
          .deleteOne({
            _id: partner.userId,
            vendorId: scopeId(vendorScope),
            role: Role.DELIVERY,
          })
          .session(session)
          .exec();
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'vendor.partner.delete',
      entity: 'DeliveryPartner',
      entityId: id,
      before: { userId: partner.userId.toString() },
      after: null,
      actor,
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────

  private async mustFindOwn(
    vendorScope: string,
    id: string,
  ): Promise<DeliveryPartnerDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Delivery partner not found');
    }

    const partner = await this.partners
      .findOne({ _id: new Types.ObjectId(id), vendorId: scopeId(vendorScope) })
      .exec();

    if (!partner) throw new NotFoundException('Delivery partner not found');
    return partner;
  }
}

/**
 * The rider's name and phone, with an EXPLICIT projection.
 *
 * `$lookup` ignores `select: false`, so without it the rider's
 * `passwordHash` and refresh-token material would be returned in every
 * list response.
 */
const LOOKUP_USER: PipelineStage[] = [
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
];

function toPartnerRow(row: PartnerAggregateRow): PartnerRow {
  const coordinates = row.currentLocation?.coordinates;
  const location =
    Array.isArray(coordinates) && coordinates.length === 2
      ? { lat: coordinates[1], lng: coordinates[0] }
      : null;

  return {
    id: row._id.toString(),
    userId: row.userId.toString(),
    vendorId: row.vendorId ? row.vendorId.toString() : '',
    name: row.user?.name ?? null,
    phone: row.user?.phone ?? null,
    email: row.user?.email ?? null,
    vehicleType: row.vehicleType,
    status: row.status,
    statusReason: row.statusReason ?? null,
    isOnline: row.isOnline,
    isAvailable: row.isAvailable,
    activeOrderId: row.activeOrderId ? row.activeOrderId.toString() : null,
    completedCount: row.completedCount,
    rating: row.rating,
    location,
    locationAt: iso(row.locationAt),
    createdAt: iso(row.createdAt),
  };
}
