import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import {
  Coupon,
  CouponDocument,
  CouponType,
} from '../../../database/schemas/coupon.schema';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../audit/audit.service';
import { escapeRegex } from '../common/dto';
import {
  CreateCouponDto,
  ListCouponsQueryDto,
  UpdateCouponDto,
  UpdateCouponStatusDto,
} from './dto';

export interface CouponRow {
  id: string;
  code: string;
  type: CouponType;
  /** FLAT: INTEGER PAISE. PERCENT: whole percent. */
  value: number;
  /** INTEGER PAISE. */
  minOrder: number;
  /** INTEGER PAISE. Always set for a percent coupon. */
  maxDiscount: number | null;
  usageLimit: number;
  usedCount: number;
  perUserLimit: number;
  validFrom: string;
  validTo: string;
  isActive: boolean;
  vendorId: string | null;
  description: string | null;
  /** Derived: active AND inside its validity window AND not exhausted. */
  isLive: boolean;
  createdAt: string | null;
}

type CouponRecord = Coupon & { _id: Types.ObjectId; createdAt?: Date };

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

@Injectable()
export class AdminCouponsService {
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'createdAt',
    'code',
    'validTo',
    'validFrom',
    'usedCount',
  ]);

  constructor(
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListCouponsQueryDto): Promise<Paginated<CouponRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<CouponDocument> = {};
    if (query.type) filter.type = query.type;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.q) {
      const needle = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ code: needle }, { description: needle }];
    }
    if (query.from) filter.validTo = { $gte: new Date(query.from) };
    if (query.to) filter.validFrom = { $lte: new Date(query.to) };

    const sort = this.resolveSort(query.sort);

    const [rows, total] = await Promise.all([
      this.coupons
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<CouponRecord[]>()
        .exec(),
      this.coupons.countDocuments(filter).exec(),
    ]);

    return paginate(rows.map(toRow), total, page, limit);
  }

  async findById(id: string): Promise<CouponRow> {
    return toRow(await this.mustFindLean(id));
  }

  /**
   * ── The three rules, enforced here so they hold for every caller ─────
   *  1. A percent coupon's value is 1-100. "200% off" is not a discount,
   *     it is the platform paying the customer to shop.
   *  2. A percent coupon MUST carry `maxDiscount`. Without a cap, "50%
   *     off" on a Rs 12,000 bulk order is an unbounded liability that
   *     nobody approved.
   *  3. validFrom must precede validTo, or the coupon can never be
   *     redeemed and support spends a morning finding out why.
   */
  private assertConsistent(input: {
    type: CouponType;
    value: number;
    maxDiscount?: number | null;
    validFrom: Date;
    validTo: Date;
  }): void {
    if (input.type === CouponType.PERCENT) {
      if (input.value > 100) {
        throw new BadRequestException(
          'A percent coupon cannot exceed 100 — value is whole percent, not paise',
        );
      }
      if (!input.maxDiscount || input.maxDiscount <= 0) {
        throw new BadRequestException(
          'maxDiscount (INTEGER PAISE) is required for a percent coupon: an ' +
            'uncapped percentage is an unbounded liability on a large order',
        );
      }
    }

    if (input.validFrom.getTime() >= input.validTo.getTime()) {
      throw new BadRequestException('validFrom must be before validTo');
    }
  }

  async create(dto: CreateCouponDto, actor: JwtUser): Promise<CouponRow> {
    const validFrom = new Date(dto.validFrom);
    const validTo = new Date(dto.validTo);

    this.assertConsistent({
      type: dto.type,
      value: dto.value,
      maxDiscount: dto.maxDiscount,
      validFrom,
      validTo,
    });

    try {
      const created = await this.coupons.create({
        code: dto.code.toUpperCase(),
        type: dto.type,
        value: dto.value,
        minOrder: dto.minOrder ?? 0,
        maxDiscount:
          dto.type === CouponType.PERCENT ? dto.maxDiscount : (dto.maxDiscount ?? null),
        usageLimit: dto.usageLimit ?? 0,
        // Never accepted from the request: a caller-supplied usedCount
        // would reset a coupon's exhaustion counter at will.
        usedCount: 0,
        perUserLimit: dto.perUserLimit ?? 1,
        validFrom,
        validTo,
        isActive: dto.isActive ?? true,
        vendorId: dto.vendorId ? new Types.ObjectId(dto.vendorId) : null,
        description: dto.description ?? null,
        isDemo: false,
      });

      await this.audit.record({
        action: 'coupon.create',
        entity: 'Coupon',
        entityId: created._id.toString(),
        before: null,
        after: {
          code: created.code,
          type: created.type,
          value: created.value,
          maxDiscount: created.maxDiscount ?? null,
          validFrom: validFrom.toISOString(),
          validTo: validTo.toISOString(),
        },
        actor,
      });

      return toRow(created.toObject<CouponRecord>());
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('That coupon code already exists');
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateCouponDto,
    actor: JwtUser,
  ): Promise<CouponRow> {
    const coupon = await this.mustFind(id);

    const before = {
      type: coupon.type,
      value: coupon.value,
      minOrder: coupon.minOrder,
      maxDiscount: coupon.maxDiscount ?? null,
      usageLimit: coupon.usageLimit,
      perUserLimit: coupon.perUserLimit,
      validFrom: coupon.validFrom.toISOString(),
      validTo: coupon.validTo.toISOString(),
      isActive: coupon.isActive,
    };

    if (dto.type !== undefined) coupon.type = dto.type;
    if (dto.value !== undefined) coupon.value = dto.value;
    if (dto.minOrder !== undefined) coupon.minOrder = dto.minOrder;
    if (dto.maxDiscount !== undefined) coupon.maxDiscount = dto.maxDiscount;
    if (dto.usageLimit !== undefined) coupon.usageLimit = dto.usageLimit;
    if (dto.perUserLimit !== undefined) coupon.perUserLimit = dto.perUserLimit;
    if (dto.validFrom !== undefined) coupon.validFrom = new Date(dto.validFrom);
    if (dto.validTo !== undefined) coupon.validTo = new Date(dto.validTo);
    if (dto.description !== undefined) coupon.description = dto.description;
    if (dto.isActive !== undefined) coupon.isActive = dto.isActive;

    // Re-checked against the MERGED document, not the patch: switching a
    // flat coupon to percent without sending maxDiscount would otherwise
    // slip through because the patch alone looks harmless.
    this.assertConsistent({
      type: coupon.type,
      value: coupon.value,
      maxDiscount: coupon.maxDiscount,
      validFrom: coupon.validFrom,
      validTo: coupon.validTo,
    });

    await coupon.save();

    await this.audit.record({
      action: 'coupon.update',
      entity: 'Coupon',
      entityId: id,
      before,
      after: {
        type: coupon.type,
        value: coupon.value,
        minOrder: coupon.minOrder,
        maxDiscount: coupon.maxDiscount ?? null,
        usageLimit: coupon.usageLimit,
        perUserLimit: coupon.perUserLimit,
        validFrom: coupon.validFrom.toISOString(),
        validTo: coupon.validTo.toISOString(),
        isActive: coupon.isActive,
      },
      actor,
    });

    return toRow(coupon.toObject<CouponRecord>());
  }

  async updateStatus(
    id: string,
    dto: UpdateCouponStatusDto,
    actor: JwtUser,
  ): Promise<CouponRow> {
    const coupon = await this.mustFind(id);
    const before = { isActive: coupon.isActive };

    coupon.isActive = dto.isActive;
    await coupon.save();

    await this.audit.record({
      action: 'coupon.status.update',
      entity: 'Coupon',
      entityId: id,
      before,
      after: { isActive: dto.isActive, reason: dto.reason ?? null },
      actor,
    });

    return toRow(coupon.toObject<CouponRecord>());
  }

  /**
   * Hard delete, permitted only while the coupon has never been redeemed.
   *
   * A redeemed coupon is part of the pricing history of real orders;
   * deleting it would leave those orders referencing a discount nobody can
   * explain at audit time. Deactivation is the alternative, and the error
   * says so.
   */
  async remove(id: string, actor: JwtUser): Promise<void> {
    const coupon = await this.mustFind(id);

    if (coupon.usedCount > 0) {
      throw new ConflictException(
        `This coupon has been redeemed ${coupon.usedCount} time(s) and is ` +
          'part of order history. Deactivate it instead.',
      );
    }

    await this.coupons.deleteOne({ _id: coupon._id }).exec();

    await this.audit.record({
      action: 'coupon.delete',
      entity: 'Coupon',
      entityId: id,
      before: { code: coupon.code, type: coupon.type, value: coupon.value },
      after: null,
      actor,
    });
  }

  private async mustFind(id: string): Promise<CouponDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Coupon not found');
    }
    const coupon = await this.coupons.findById(id).exec();
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  private async mustFindLean(id: string): Promise<CouponRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Coupon not found');
    }
    const coupon = await this.coupons
      .findById(id)
      .lean<CouponRecord | null>()
      .exec();
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  private resolveSort(requested?: string): Record<string, 1 | -1> {
    if (!requested) return { createdAt: -1 };

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!AdminCouponsService.SORTABLE.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[...AdminCouponsService.SORTABLE].join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}

function toRow(coupon: CouponRecord): CouponRow {
  const now = Date.now();
  const exhausted =
    coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit;

  return {
    id: coupon._id.toString(),
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    minOrder: coupon.minOrder,
    maxDiscount: coupon.maxDiscount ?? null,
    usageLimit: coupon.usageLimit,
    usedCount: coupon.usedCount,
    perUserLimit: coupon.perUserLimit,
    validFrom: new Date(coupon.validFrom).toISOString(),
    validTo: new Date(coupon.validTo).toISOString(),
    isActive: coupon.isActive,
    vendorId: coupon.vendorId ? coupon.vendorId.toString() : null,
    description: coupon.description ?? null,
    isLive:
      coupon.isActive &&
      !exhausted &&
      new Date(coupon.validFrom).getTime() <= now &&
      new Date(coupon.validTo).getTime() >= now,
    createdAt: coupon.createdAt
      ? new Date(coupon.createdAt).toISOString()
      : null,
  };
}
