import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  FAILED_STATUSES,
  IN_FLIGHT_STATUSES,
  OrderStatus,
} from '../../../common/constants/order-status.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { AuditService } from '../../admin/audit/audit.service';
import { dayKey, iso, startOfDay } from '../common/dto';
import { scopeId } from '../common/vendor-scope.decorator';
import {
  UpdateStoreHoursDto,
  UpdateStoreProfileDto,
  UpdateStoreStatusDto,
} from './dto';

const MS_PER_DAY = 86_400_000;
const SPARKLINE_DAYS = 7;

export interface StoreProfile {
  id: string;
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
  location: { lat: number; lng: number };
  serviceRadiusKm: number;
  /** Read-only here — set by an admin, snapshotted onto every order. */
  commissionPct: number;
  codEnabled: boolean;
  /** INTEGER PAISE. */
  codMaxAmount: number;
  isOpen: boolean;
  openingHours: { day: number; open: string; close: string }[];
  status: VendorStatus;
  rating: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StoreStatus {
  id: string;
  isOpen: boolean;
  status: VendorStatus;
  updatedAt: string | null;
}

export interface DashboardSparkPoint {
  /** `YYYY-MM-DD`, local time. */
  date: string;
  orders: number;
  /** INTEGER PAISE. */
  revenue: number;
}

export interface VendorDashboard {
  vendorId: string;
  storeName: string;
  isOpen: boolean;
  status: VendorStatus;
  rating: number;
  /** Local midnight of the day these numbers cover. */
  today: string;
  ordersToday: {
    total: number;
    byStatus: Record<OrderStatus, number>;
  };
  revenueToday: {
    /** Sum of `pricing.grandTotal`, excluding cancelled and rejected. */
    gross: number;
    /** Sum of `pricing.itemsSubtotal` — the vendor's own line. */
    itemsSubtotal: number;
    commission: number;
    /** Sum of `pricing.vendorPayout`. */
    net: number;
    orderCount: number;
  };
  /** PLACED orders waiting for accept/reject. The alert number. */
  pendingCount: number;
  /** Everything still moving, at any stage. */
  inFlightCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  /** Oldest first, last 7 days including today. */
  sparkline: DashboardSparkPoint[];
}

type VendorRecord = Vendor & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

const EMPTY_STATUS_COUNTS = (): Record<OrderStatus, number> =>
  Object.values(OrderStatus).reduce(
    (acc, status) => {
      acc[status] = 0;
      return acc;
    },
    {} as Record<OrderStatus, number>,
  );

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE STORE ITSELF
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every method takes `vendorScope` as a REQUIRED first argument and puts
 * it in the query filter. There is no overload without it, so the tenant
 * filter cannot be forgotten — §8.1, layer 2.
 */
@Injectable()
export class VendorStoreService {
  constructor(
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Profile
  // ──────────────────────────────────────────────────────────────────

  async getProfile(vendorScope: string): Promise<StoreProfile> {
    return toProfile(await this.mustFind(vendorScope));
  }

  async updateProfile(
    vendorScope: string,
    dto: UpdateStoreProfileDto,
    actor: JwtUser,
  ): Promise<StoreProfile> {
    const vendor = await this.mustFindDoc(vendorScope);
    const before = toProfile(vendor.toObject() as VendorRecord);

    if (dto.storeName !== undefined) vendor.storeName = dto.storeName;
    if (dto.description !== undefined) vendor.description = dto.description;
    if (dto.logoUrl !== undefined) vendor.logoUrl = dto.logoUrl;
    if (dto.bannerUrl !== undefined) vendor.bannerUrl = dto.bannerUrl;
    if (dto.serviceRadiusKm !== undefined) {
      vendor.serviceRadiusKm = dto.serviceRadiusKm;
    }
    if (dto.codEnabled !== undefined) vendor.codEnabled = dto.codEnabled;
    if (dto.codMaxAmount !== undefined) vendor.codMaxAmount = dto.codMaxAmount;

    if (dto.address) {
      vendor.address = {
        line1: dto.address.line1,
        line2: dto.address.line2 ?? null,
        city: dto.address.city,
        state: dto.address.state,
        pincode: dto.address.pincode,
      };
    }

    if (dto.location) {
      // GeoJSON is [lng, lat]. Reversing it is the single most common
      // geo bug, and it silently puts the store in the wrong hemisphere.
      vendor.location = {
        type: 'Point',
        coordinates: [dto.location.lng, dto.location.lat],
      };
    }

    await vendor.save();
    const after = toProfile(vendor.toObject() as VendorRecord);

    await this.audit.record({
      action: 'vendor.profile.update',
      entity: 'Vendor',
      entityId: vendorScope,
      before,
      after,
      actor,
    });

    return after;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Open / closed
  // ──────────────────────────────────────────────────────────────────

  /**
   * The shutter.
   *
   * A SUSPENDED or PENDING vendor cannot open: the store toggle is not a
   * route around an admin decision, and a suspended store that could flip
   * itself back open would make suspension advisory.
   */
  async setOpen(
    vendorScope: string,
    dto: UpdateStoreStatusDto,
    actor: JwtUser,
  ): Promise<StoreStatus> {
    const vendor = await this.mustFindDoc(vendorScope);

    if (dto.isOpen && vendor.status !== VendorStatus.APPROVED) {
      throw new BadRequestException(
        `A store with status "${vendor.status}" cannot open for orders`,
      );
    }

    const before = vendor.isOpen;
    vendor.isOpen = dto.isOpen;
    await vendor.save();

    await this.audit.record({
      action: 'vendor.store.status',
      entity: 'Vendor',
      entityId: vendorScope,
      before: { isOpen: before },
      after: { isOpen: vendor.isOpen },
      actor,
    });

    return {
      id: vendor._id.toString(),
      isOpen: vendor.isOpen,
      status: vendor.status,
      updatedAt: iso((vendor as VendorRecord).updatedAt),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Opening hours
  // ──────────────────────────────────────────────────────────────────

  async setHours(
    vendorScope: string,
    dto: UpdateStoreHoursDto,
    actor: JwtUser,
  ): Promise<StoreProfile> {
    for (const hour of dto.hours) {
      if (hour.open >= hour.close) {
        throw new BadRequestException(
          `Opening hours for day ${hour.day} end at or before they start ` +
            `(${hour.open}-${hour.close}). Split an overnight window into ` +
            'two rows instead.',
        );
      }
    }

    const vendor = await this.mustFindDoc(vendorScope);
    const before = vendor.openingHours.map((hour) => ({ ...hour }));

    vendor.openingHours = dto.hours.map((hour) => ({
      day: hour.day,
      open: hour.open,
      close: hour.close,
    }));
    await vendor.save();

    await this.audit.record({
      action: 'vendor.store.hours',
      entity: 'Vendor',
      entityId: vendorScope,
      before: { openingHours: before },
      after: { openingHours: vendor.openingHours },
      actor,
    });

    return toProfile(vendor.toObject() as VendorRecord);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Dashboard
  // ──────────────────────────────────────────────────────────────────

  /**
   * The one screen a shop owner leaves open all day.
   *
   * Five aggregations run in parallel rather than one giant `$facet`:
   * they hit three different collections, and three of them are served
   * straight off `{ vendorId, status, placedAt }` without touching a
   * document.
   */
  async dashboard(vendorScope: string): Promise<VendorDashboard> {
    const vendor = await this.mustFind(vendorScope);

    const now = new Date();
    const todayStart = startOfDay(now);
    const windowStart = new Date(
      todayStart.getTime() - (SPARKLINE_DAYS - 1) * MS_PER_DAY,
    );
    const vendorId = scopeId(vendorScope);

    const [byStatus, revenue, pending, inFlight, stock, spark] =
      await Promise.all([
        this.orders
          .aggregate<{ _id: OrderStatus; count: number }>([
            { $match: { vendorId, placedAt: { $gte: todayStart } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
          ])
          .exec(),

        this.orders
          .aggregate<{
            gross: number;
            itemsSubtotal: number;
            commission: number;
            net: number;
            orderCount: number;
          }>([
            {
              $match: {
                vendorId,
                placedAt: { $gte: todayStart },
                status: { $nin: [...FAILED_STATUSES] },
              },
            },
            {
              $group: {
                _id: null,
                gross: { $sum: '$pricing.grandTotal' },
                itemsSubtotal: { $sum: '$pricing.itemsSubtotal' },
                commission: { $sum: '$pricing.commissionAmount' },
                net: { $sum: '$pricing.vendorPayout' },
                orderCount: { $sum: 1 },
              },
            },
          ])
          .exec(),

        this.orders
          .countDocuments({ vendorId, status: OrderStatus.PLACED })
          .exec(),

        this.orders
          .countDocuments({ vendorId, status: { $in: [...IN_FLIGHT_STATUSES] } })
          .exec(),

        this.inventory
          .aggregate<{ low: number; out: number }>([
            { $match: { vendorId } },
            {
              $group: {
                _id: null,
                out: { $sum: { $cond: [{ $lte: ['$stock', 0] }, 1, 0] } },
                low: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $gt: ['$stock', 0] },
                          { $lte: ['$stock', '$lowStockThreshold'] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ])
          .exec(),

        this.orders
          .aggregate<{ _id: string; orders: number; revenue: number }>([
            {
              $match: {
                vendorId,
                placedAt: { $gte: windowStart },
                status: { $nin: [...FAILED_STATUSES] },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: { format: '%Y-%m-%d', date: '$placedAt' },
                },
                orders: { $sum: 1 },
                revenue: { $sum: '$pricing.grandTotal' },
              },
            },
          ])
          .exec(),
      ]);

    const counts = EMPTY_STATUS_COUNTS();
    let total = 0;
    for (const row of byStatus) {
      counts[row._id] = row.count;
      total += row.count;
    }

    const money = revenue[0];
    const stockRow = stock[0];

    const sparkByDay = new Map(spark.map((row) => [row._id, row]));
    const sparkline: DashboardSparkPoint[] = [];
    for (let offset = SPARKLINE_DAYS - 1; offset >= 0; offset -= 1) {
      const at = new Date(todayStart.getTime() - offset * MS_PER_DAY);
      const key = dayKey(at);
      const row = sparkByDay.get(key);
      sparkline.push({
        date: key,
        orders: row?.orders ?? 0,
        revenue: row?.revenue ?? 0,
      });
    }

    return {
      vendorId: vendorScope,
      storeName: vendor.storeName,
      isOpen: vendor.isOpen,
      status: vendor.status,
      rating: vendor.rating,
      today: todayStart.toISOString(),
      ordersToday: { total, byStatus: counts },
      revenueToday: {
        gross: money?.gross ?? 0,
        itemsSubtotal: money?.itemsSubtotal ?? 0,
        commission: money?.commission ?? 0,
        net: money?.net ?? 0,
        orderCount: money?.orderCount ?? 0,
      },
      pendingCount: pending,
      inFlightCount: inFlight,
      lowStockCount: stockRow?.low ?? 0,
      outOfStockCount: stockRow?.out ?? 0,
      sparkline,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────

  private async mustFind(vendorScope: string): Promise<VendorRecord> {
    const vendor = await this.vendors
      .findById(vendorScope)
      .lean<VendorRecord | null>()
      .exec();

    if (!vendor) throw new NotFoundException('Store not found');
    return vendor;
  }

  private async mustFindDoc(vendorScope: string): Promise<VendorDocument> {
    const vendor = await this.vendors.findById(vendorScope).exec();
    if (!vendor) throw new NotFoundException('Store not found');
    return vendor;
  }
}

function toProfile(vendor: VendorRecord): StoreProfile {
  const [lng, lat] = vendor.location?.coordinates ?? [0, 0];

  return {
    id: vendor._id.toString(),
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
    location: { lat, lng },
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
    createdAt: iso(vendor.createdAt),
    updatedAt: iso(vendor.updatedAt),
  };
}
