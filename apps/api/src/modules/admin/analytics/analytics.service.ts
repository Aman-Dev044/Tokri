import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../../database/schemas/delivery-partner.schema';
import { Role } from '../../../common/constants/roles.enum';
import {
  FAILED_STATUSES,
  OrderStatus,
  PaymentMethod,
} from '../../../common/constants/order-status.enum';
import {
  AISLE_KEYS,
  AisleKey,
} from '../../../common/constants/aisle.enum';
import {
  DateRange,
  Interval,
  Kpi,
  SeriesPoint,
  aov,
  fillSeries,
  kpi,
  previousPeriod,
  ratePct,
  resolveRange,
} from './kpi.util';
import { TimeseriesQueryDto, TopQueryDto } from './dto';
import { DateRangeQueryDto } from '../common/dto';

// ── Response shapes (the contract the admin UI codes against) ──────────

export interface OverviewResponse {
  range: { from: string; to: string };
  previousRange: { from: string; to: string };
  gmv: Kpi;
  orderCount: Kpi;
  aov: Kpi;
  activeVendors: Kpi;
  pendingVendors: Kpi;
  customerCount: Kpi;
  riderCount: Kpi;
  onlineRiders: Kpi;
  cancellationRate: Kpi;
  codShare: Kpi;
}

export interface StatusCount {
  status: OrderStatus;
  count: number;
}

export interface TopVendorRow {
  vendorId: string;
  storeName: string;
  city: string | null;
  status: VendorStatus | null;
  gmv: number;
  orderCount: number;
}

export interface TopProductRow {
  productId: string;
  name: string;
  image: string | null;
  vendorId: string | null;
  gmv: number;
  unitsSold: number;
}

export interface AisleRow {
  aisleKey: AisleKey;
  gmv: number;
  orderCount: number;
}

/** Raw counters for one window, before any delta arithmetic. */
interface WindowTotals {
  gmv: number;
  orderCount: number;
  countedOrders: number;
  failedOrders: number;
  codOrders: number;
  activeVendors: number;
  pendingVendors: number;
  customerCount: number;
  riderCount: number;
  onlineRiders: number;
}

interface OrderFacetResult {
  placed: { count: number }[];
  counted: { count: number; gmv: number; cod: number }[];
  failed: { count: number }[];
}

@Injectable()
export class AdminAnalyticsService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  //  Overview
  // ────────────────────────────────────────────────────────────────────

  /**
   * Every tile on the dashboard header, each with its movement against the
   * immediately preceding window of the same length.
   *
   * ── Definitions, because a dashboard is only useful if they are fixed ──
   *  gmv              sum of `pricing.grandTotal` over orders placed in the
   *                   window that were NOT cancelled or rejected.
   *  orderCount       ALL orders placed in the window, failures included —
   *                   it measures demand, not revenue.
   *  aov              gmv / (orders counted toward gmv). Using the wider
   *                   denominator would make AOV fall every time a
   *                   cancellation happened, which is not what it means.
   *  cancellationRate cancelled+rejected / all placed, as a percentage.
   *  codShare         COD share of the orders counted toward gmv.
   *
   * The three population counts (vendors, customers, riders) are "as at
   * the end of the window", so their delta is genuine growth rather than a
   * comparison of two unrelated snapshots. `onlineRiders` is inherently
   * live and has no historical counterpart — its delta is always null.
   */
  async overview(query: DateRangeQueryDto): Promise<OverviewResponse> {
    const range = resolveRange(query.from, query.to);
    const previous = previousPeriod(range);

    const [current, prior] = await Promise.all([
      this.collect(range),
      this.collect(previous),
    ]);

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      previousRange: {
        from: previous.from.toISOString(),
        to: previous.to.toISOString(),
      },
      gmv: kpi(current.gmv, prior.gmv),
      orderCount: kpi(current.orderCount, prior.orderCount),
      aov: kpi(
        aov(current.gmv, current.countedOrders),
        aov(prior.gmv, prior.countedOrders),
      ),
      activeVendors: kpi(current.activeVendors, prior.activeVendors),
      pendingVendors: kpi(current.pendingVendors, prior.pendingVendors),
      customerCount: kpi(current.customerCount, prior.customerCount),
      riderCount: kpi(current.riderCount, prior.riderCount),
      // Live gauge: there is no "how many were online last month" to
      // compare against, so previous mirrors current and the delta is 0.
      onlineRiders: kpi(current.onlineRiders, current.onlineRiders),
      cancellationRate: kpi(
        ratePct(current.failedOrders, current.orderCount),
        ratePct(prior.failedOrders, prior.orderCount),
      ),
      codShare: kpi(
        ratePct(current.codOrders, current.countedOrders),
        ratePct(prior.codOrders, prior.countedOrders),
      ),
    };
  }

  /**
   * One round trip for the order facts, plus four cheap counts.
   *
   * The `$facet` matters: the three order figures share a single
   * `{ placedAt: { $gte, $lte } }` match, which is served by the
   * `{ status: 1, placedAt: -1 }` index. Running them as three separate
   * aggregations would scan the same slice of the orders collection three
   * times per dashboard load, twice over (current + previous window).
   */
  private async collect(range: DateRange): Promise<WindowTotals> {
    const match: PipelineStage.Match = {
      $match: { placedAt: { $gte: range.from, $lte: range.to } },
    };

    const [facet] = await this.orders
      .aggregate<OrderFacetResult>([
        match,
        {
          $facet: {
            placed: [{ $count: 'count' }],
            counted: [
              { $match: { status: { $nin: FAILED_STATUSES } } },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  gmv: { $sum: '$pricing.grandTotal' },
                  cod: {
                    $sum: {
                      $cond: [
                        { $eq: ['$payment.method', PaymentMethod.COD] },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            failed: [
              { $match: { status: { $in: FAILED_STATUSES } } },
              { $count: 'count' },
            ],
          },
        },
      ])
      .exec();

    const counted = facet?.counted?.[0];

    const [activeVendors, pendingVendors, customerCount, riderCount, online] =
      await Promise.all([
        this.vendors
          .countDocuments({
            status: VendorStatus.APPROVED,
            createdAt: { $lte: range.to },
          })
          .exec(),
        this.vendors
          .countDocuments({
            status: VendorStatus.PENDING,
            createdAt: { $lte: range.to },
          })
          .exec(),
        this.users
          .countDocuments({ role: Role.CUSTOMER, createdAt: { $lte: range.to } })
          .exec(),
        this.partners.countDocuments({ createdAt: { $lte: range.to } }).exec(),
        this.partners.countDocuments({ isOnline: true }).exec(),
      ]);

    return {
      gmv: counted?.gmv ?? 0,
      orderCount: facet?.placed?.[0]?.count ?? 0,
      countedOrders: counted?.count ?? 0,
      failedOrders: facet?.failed?.[0]?.count ?? 0,
      codOrders: counted?.cod ?? 0,
      activeVendors,
      pendingVendors,
      customerCount,
      riderCount,
      onlineRiders: online,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Series
  // ────────────────────────────────────────────────────────────────────

  /**
   * A dense series for the dashboard's main chart.
   *
   * Buckets are UTC and every bucket in the range is present, including
   * the empty ones — see `fillSeries` for why a sparse series misleads.
   */
  async timeseries(query: TimeseriesQueryDto): Promise<SeriesPoint[]> {
    const range = resolveRange(query.from, query.to);
    const interval: Interval = query.interval ?? 'day';
    const metric = query.metric ?? 'gmv';

    const format =
      interval === 'month' ? '%Y-%m-01' : '%Y-%m-%d';

    const rows = await this.orders
      .aggregate<{ _id: string; gmv: number; orders: number }>([
        {
          $match: {
            placedAt: { $gte: range.from, $lte: range.to },
            status: { $nin: FAILED_STATUSES },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format, date: '$placedAt', timezone: 'UTC' },
            },
            gmv: { $sum: '$pricing.grandTotal' },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();

    // Weekly buckets are collapsed here rather than in Mongo: $dateToString
    // has no "start of ISO week" format, and %V/%G would produce a week
    // NUMBER, which a chart axis cannot place on a time scale.
    const daily: SeriesPoint[] = rows.map((row) => ({
      date: row._id,
      value:
        metric === 'orders'
          ? row.orders
          : metric === 'aov'
            ? aov(row.gmv, row.orders)
            : row.gmv,
    }));

    if (interval !== 'week') return fillSeries(daily, range, interval);

    const weekly = new Map<string, { gmv: number; orders: number }>();
    for (const row of rows) {
      const key = isoWeekStart(row._id);
      const bucket = weekly.get(key) ?? { gmv: 0, orders: 0 };
      bucket.gmv += row.gmv;
      bucket.orders += row.orders;
      weekly.set(key, bucket);
    }

    const weeklyPoints: SeriesPoint[] = [...weekly.entries()].map(
      ([date, bucket]) => ({
        date,
        value:
          metric === 'orders'
            ? bucket.orders
            : metric === 'aov'
              ? aov(bucket.gmv, bucket.orders)
              : bucket.gmv,
      }),
    );

    return fillSeries(weeklyPoints, range, 'week');
  }

  /**
   * Every status, including the ones with no orders — a board that hides
   * its empty columns re-orders itself on every refresh.
   */
  async ordersByStatus(query: DateRangeQueryDto): Promise<StatusCount[]> {
    const range = resolveRange(query.from, query.to);

    const rows = await this.orders
      .aggregate<{ _id: OrderStatus; count: number }>([
        { $match: { placedAt: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();

    const counts = new Map(rows.map((row) => [row._id, row.count]));

    return Object.values(OrderStatus).map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    }));
  }

  async topVendors(query: TopQueryDto): Promise<TopVendorRow[]> {
    const range = resolveRange(query.from, query.to);
    const limit = query.limit ?? 10;

    const rows = await this.orders
      .aggregate<{
        _id: unknown;
        gmv: number;
        orderCount: number;
        vendor?: {
          storeName?: string;
          status?: VendorStatus;
          address?: { city?: string };
        };
      }>([
        {
          $match: {
            placedAt: { $gte: range.from, $lte: range.to },
            status: { $nin: FAILED_STATUSES },
          },
        },
        {
          $group: {
            _id: '$vendorId',
            gmv: { $sum: '$pricing.grandTotal' },
            orderCount: { $sum: 1 },
          },
        },
        { $sort: { gmv: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'vendors',
            localField: '_id',
            foreignField: '_id',
            as: 'vendor',
          },
        },
        { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
      ])
      .exec();

    return rows.map((row) => ({
      vendorId: String(row._id),
      storeName: row.vendor?.storeName ?? 'Unknown vendor',
      city: row.vendor?.address?.city ?? null,
      status: row.vendor?.status ?? null,
      gmv: row.gmv,
      orderCount: row.orderCount,
    }));
  }

  async topProducts(query: TopQueryDto): Promise<TopProductRow[]> {
    const range = resolveRange(query.from, query.to);
    const limit = query.limit ?? 10;

    const rows = await this.orders
      .aggregate<{
        _id: unknown;
        name: string;
        gmv: number;
        unitsSold: number;
        product?: { images?: string[]; vendorId?: unknown };
      }>([
        {
          $match: {
            placedAt: { $gte: range.from, $lte: range.to },
            status: { $nin: FAILED_STATUSES },
          },
        },
        { $unwind: '$items' },
        { $match: { 'items.fulfilled': true } },
        {
          $group: {
            _id: '$items.productId',
            // The order line carries a NAME SNAPSHOT, so a renamed or
            // deleted product still reports under the name it sold as.
            name: { $first: '$items.name' },
            gmv: { $sum: '$items.lineTotal' },
            unitsSold: { $sum: '$items.qty' },
          },
        },
        { $sort: { gmv: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'products',
            localField: '_id',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      ])
      .exec();

    return rows.map((row) => ({
      productId: String(row._id),
      name: row.name,
      image: row.product?.images?.[0] ?? null,
      vendorId: row.product?.vendorId ? String(row.product.vendorId) : null,
      gmv: row.gmv,
      unitsSold: row.unitsSold,
    }));
  }

  /**
   * GMV split across the eight chromatic aisles — the chart the UI
   * colours by aisle hue, which is why every aisle is always present even
   * with no sales.
   */
  async salesByAisle(query: DateRangeQueryDto): Promise<AisleRow[]> {
    const range = resolveRange(query.from, query.to);

    const rows = await this.orders
      .aggregate<{ _id: AisleKey; gmv: number; orders: string[] }>([
        {
          $match: {
            placedAt: { $gte: range.from, $lte: range.to },
            status: { $nin: FAILED_STATUSES },
          },
        },
        { $unwind: '$items' },
        {
          $lookup: {
            from: 'products',
            localField: 'items.productId',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: '$product' },
        {
          $lookup: {
            from: 'categories',
            localField: 'product.categoryId',
            foreignField: '_id',
            as: 'category',
          },
        },
        { $unwind: '$category' },
        {
          $group: {
            _id: '$category.aisleKey',
            gmv: { $sum: '$items.lineTotal' },
            // An order touching three aisles counts once in each, never
            // three times in one — hence a set of ids, not a counter.
            orders: { $addToSet: '$_id' },
          },
        },
      ])
      .exec();

    const byAisle = new Map(
      rows.map((row) => [
        row._id,
        { gmv: row.gmv, orderCount: row.orders.length },
      ]),
    );

    return AISLE_KEYS.map((aisleKey) => ({
      aisleKey,
      gmv: byAisle.get(aisleKey)?.gmv ?? 0,
      orderCount: byAisle.get(aisleKey)?.orderCount ?? 0,
    }));
  }
}

/** `YYYY-MM-DD` -> the Monday of that ISO week, same format. */
function isoWeekStart(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}
