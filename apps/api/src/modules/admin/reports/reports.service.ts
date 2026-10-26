import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  FAILED_STATUSES,
  OrderStatus,
} from '../../../common/constants/order-status.enum';
import { AisleKey } from '../../../common/constants/aisle.enum';
import { Paginated } from '../../../common/dto/paginated';
import { DateRange, aov, ratePct, round1 } from '../analytics/kpi.util';
import { AdminSettingsService } from '../settings/settings.service';
import { ReportQueryDto } from './dto';
import {
  REPORT_GROUPINGS,
  ReportKey,
  ReportRow,
  TimeGrouping,
  bucketOf,
  reportEnvelope,
  reportWindow,
  slabLabel,
} from './report.util';

/** `$dateToString` of a date field as a UTC `YYYY-MM-DD`. */
const utcDay = (field: string) => ({
  $dateToString: { format: '%Y-%m-%d', date: field, timezone: 'UTC' },
});

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ADMIN REPORTS
 * ════════════════════════════════════════════════════════════════════════
 *
 * Five read models over what the orders collection actually stores. The
 * rule throughout: a column is computed from a stored field or it does
 * not exist. Rows are SPARSE — a day with no orders has no row rather
 * than a row of zeros — because an "average delivery time" over zero
 * deliveries is not 0 minutes, it is no answer.
 *
 * Two clocks, each the one the question is about:
 *   placedAt     sales, vendor and product performance — what was sold
 *   deliveredAt  delivery performance and tax — what was handed over,
 *                which is when a delivery is timed and a supply is taxed
 *
 * GMV is `pricing.grandTotal` over orders that were not cancelled or
 * rejected — the dashboard's definition, so the two never disagree.
 */
@Injectable()
export class AdminReportsService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly settings: AdminSettingsService,
  ) {}

  async run(query: ReportQueryDto): Promise<Paginated<ReportRow>> {
    const allowed = REPORT_GROUPINGS[query.report];
    const grouping = query.grouping ?? allowed[0];

    if (grouping === undefined || !allowed.includes(grouping)) {
      throw new BadRequestException(
        `grouping must be one of: ${allowed.join(', ')} for report ${query.report}`,
      );
    }

    const window = reportWindow(query.from, query.to);
    return reportEnvelope(await this.rows(query.report, grouping, window));
  }

  private rows(
    report: ReportKey,
    grouping: string,
    window: DateRange,
  ): Promise<ReportRow[]> {
    switch (report) {
      case 'sales':
        return this.sales(window, grouping as TimeGrouping);
      case 'vendor_performance':
        return this.vendorPerformance(window);
      case 'product_performance':
        return this.productPerformance(window);
      case 'delivery_performance':
        return this.deliveryPerformance(window);
      case 'tax_summary':
        return this.taxSummary(window);
    }
  }

  // ────────────────────────────────────────────────────────────────────
  //  Sales
  // ────────────────────────────────────────────────────────────────────

  /**
   * Orders, GMV, average order, discounts and commission per bucket.
   *
   * Commission is the `pricing.commissionAmount` SNAPSHOT each order
   * carries — the rate in force when it was placed, re-priced only by a
   * partial fulfilment — never the vendor's current rate.
   *
   * Grouped by UTC day in Mongo and collapsed to weeks or months here:
   * `$dateToString` has no "start of ISO week" format.
   */
  private async sales(
    window: DateRange,
    grouping: TimeGrouping,
  ): Promise<ReportRow[]> {
    const daily = await this.orders
      .aggregate<{
        _id: string;
        orders: number;
        gmv: number;
        discount: number;
        commission: number;
      }>([
        {
          $match: {
            placedAt: { $gte: window.from, $lte: window.to },
            status: { $nin: FAILED_STATUSES },
          },
        },
        {
          $group: {
            _id: utcDay('$placedAt'),
            orders: { $sum: 1 },
            gmv: { $sum: '$pricing.grandTotal' },
            discount: { $sum: '$pricing.discount' },
            commission: { $sum: '$pricing.commissionAmount' },
          },
        },
      ])
      .exec();

    const buckets = new Map<
      string,
      { orders: number; gmv: number; discount: number; commission: number }
    >();
    for (const day of daily) {
      const key = bucketOf(day._id, grouping);
      const bucket = buckets.get(key) ?? {
        orders: 0,
        gmv: 0,
        discount: 0,
        commission: 0,
      };
      bucket.orders += day.orders;
      bucket.gmv += day.gmv;
      bucket.discount += day.discount;
      bucket.commission += day.commission;
      buckets.set(key, bucket);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({
        date,
        orders: bucket.orders,
        gmvPaise: bucket.gmv,
        aovPaise: aov(bucket.gmv, bucket.orders),
        discountPaise: bucket.discount,
        commissionPaise: bucket.commission,
      }));
  }

  // ────────────────────────────────────────────────────────────────────
  //  Vendor performance
  // ────────────────────────────────────────────────────────────────────

  /**
   * Per store: completed-or-live orders, their GMV and commission, and
   * the share of everything placed that was cancelled or rejected.
   *
   * There is no rating column. `Vendor.rating` exists in the schema but
   * nothing in the platform writes it, so every store would read 0.0 — a
   * claim about a real business that nobody measured.
   */
  private async vendorPerformance(window: DateRange): Promise<ReportRow[]> {
    const notFailed = { $not: [{ $in: ['$status', FAILED_STATUSES] }] };

    const rows = await this.orders
      .aggregate<{
        _id: Types.ObjectId;
        placed: number;
        failed: number;
        orders: number;
        gmv: number;
        commission: number;
        vendor?: { storeName?: string; address?: { city?: string } };
      }>([
        { $match: { placedAt: { $gte: window.from, $lte: window.to } } },
        {
          $group: {
            _id: '$vendorId',
            placed: { $sum: 1 },
            failed: { $sum: { $cond: [notFailed, 0, 1] } },
            orders: { $sum: { $cond: [notFailed, 1, 0] } },
            gmv: { $sum: { $cond: [notFailed, '$pricing.grandTotal', 0] } },
            commission: {
              $sum: { $cond: [notFailed, '$pricing.commissionAmount', 0] },
            },
          },
        },
        {
          $lookup: {
            from: 'vendors',
            localField: '_id',
            foreignField: '_id',
            pipeline: [{ $project: { storeName: 1, 'address.city': 1 } }],
            as: 'vendor',
          },
        },
        { $unwind: { path: '$vendor', preserveNullAndEmptyArrays: true } },
        { $sort: { gmv: -1, _id: 1 } },
      ])
      .exec();

    return rows.map((row) => ({
      vendorId: row._id.toString(),
      // A deleted store keeps its history; it does not get a made-up name.
      vendor: row.vendor?.storeName ?? `Removed store ${row._id.toString()}`,
      city: row.vendor?.address?.city ?? null,
      orders: row.orders,
      gmvPaise: row.gmv,
      commissionPaise: row.commission,
      cancelPct: ratePct(row.failed, row.placed),
    }));
  }

  // ────────────────────────────────────────────────────────────────────
  //  Product performance
  // ────────────────────────────────────────────────────────────────────

  /**
   * Fulfilled lines, rolled up by the aisle of the product's category.
   *
   * Rows carry `aisleKey` and no display name: the name and the hue both
   * belong to the design system, and the console looks them up there.
   * A line whose product or category has since been deleted cannot be
   * placed in an aisle and is left out rather than guessed at.
   */
  private async productPerformance(window: DateRange): Promise<ReportRow[]> {
    const rows = await this.orders
      .aggregate<{
        _id: AisleKey;
        products: number;
        units: number;
        gmv: number;
      }>([
        {
          $match: {
            placedAt: { $gte: window.from, $lte: window.to },
            status: { $nin: FAILED_STATUSES },
          },
        },
        { $unwind: '$items' },
        // A dropped line was never sold.
        { $match: { 'items.fulfilled': { $ne: false } } },
        {
          $lookup: {
            from: 'products',
            localField: 'items.productId',
            foreignField: '_id',
            pipeline: [{ $project: { categoryId: 1 } }],
            as: 'product',
          },
        },
        { $unwind: '$product' },
        {
          $lookup: {
            from: 'categories',
            localField: 'product.categoryId',
            foreignField: '_id',
            pipeline: [{ $project: { aisleKey: 1 } }],
            as: 'category',
          },
        },
        { $unwind: '$category' },
        {
          $group: {
            _id: '$category.aisleKey',
            productIds: { $addToSet: '$items.productId' },
            units: { $sum: '$items.qty' },
            gmv: { $sum: '$items.lineTotal' },
          },
        },
        {
          $project: {
            products: { $size: '$productIds' },
            units: 1,
            gmv: 1,
          },
        },
        { $sort: { gmv: -1, _id: 1 } },
      ])
      .exec();

    const total = rows.reduce((sum, row) => sum + row.gmv, 0);

    return rows.map((row) => ({
      aisleKey: row._id,
      products: row.products,
      units: row.units,
      gmvPaise: row.gmv,
      sharePct: ratePct(row.gmv, total),
    }));
  }

  // ────────────────────────────────────────────────────────────────────
  //  Delivery performance
  // ────────────────────────────────────────────────────────────────────

  /**
   * Per UTC day: deliveries, placed-to-delivered minutes, on-time rate,
   * and failed delivery attempts.
   *
   * On time means within the platform SLA (`settings.slaMinutes`), with
   * elapsed minutes FLOORED exactly as the ops console does — so this
   * report and the live board call the same order late. The SLA is the
   * one in force now; orders do not snapshot it.
   *
   * `failed` counts every transition into DELIVERY_FAILED from the status
   * history, so an order that failed twice counts twice: each was a
   * customer left waiting.
   *
   * There is no "riders online" column. Only the CURRENT `isOnline` flag
   * is stored, and location pings expire after seven days, so how many
   * riders were online on a past day is not something the platform knows.
   */
  private async deliveryPerformance(window: DateRange): Promise<ReportRow[]> {
    const { slaMinutes } = await this.settings.get();
    const hasSla = Number.isFinite(slaMinutes) && slaMinutes > 0;

    const [delivered, failures] = await Promise.all([
      this.orders
        .aggregate<{
          _id: string;
          deliveries: number;
          totalMinutes: number;
          onTime: number;
        }>([
          {
            $match: {
              status: OrderStatus.DELIVERED,
              deliveredAt: { $gte: window.from, $lte: window.to },
            },
          },
          {
            $project: {
              day: utcDay('$deliveredAt'),
              minutes: {
                $max: [
                  0,
                  {
                    $divide: [
                      { $subtract: ['$deliveredAt', '$placedAt'] },
                      60_000,
                    ],
                  },
                ],
              },
            },
          },
          {
            $group: {
              _id: '$day',
              deliveries: { $sum: 1 },
              totalMinutes: { $sum: '$minutes' },
              onTime: {
                $sum: {
                  $cond: [
                    { $lte: [{ $floor: '$minutes' }, hasSla ? slaMinutes : 0] },
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
        .aggregate<{ _id: string; failed: number }>([
          {
            $match: {
              statusHistory: {
                $elemMatch: {
                  to: OrderStatus.DELIVERY_FAILED,
                  at: { $gte: window.from, $lte: window.to },
                },
              },
            },
          },
          { $unwind: '$statusHistory' },
          {
            $match: {
              'statusHistory.to': OrderStatus.DELIVERY_FAILED,
              'statusHistory.at': { $gte: window.from, $lte: window.to },
            },
          },
          {
            $group: {
              _id: utcDay('$statusHistory.at'),
              failed: { $sum: 1 },
            },
          },
        ])
        .exec(),
    ]);

    const byDay = new Map(delivered.map((row) => [row._id, row]));
    const failedByDay = new Map(failures.map((row) => [row._id, row.failed]));
    const days = [...new Set([...byDay.keys(), ...failedByDay.keys()])].sort();

    return days.map((date) => {
      const row = byDay.get(date);
      const deliveries = row?.deliveries ?? 0;
      return {
        date,
        deliveries,
        avgMinutes:
          row && deliveries > 0 ? round1(row.totalMinutes / deliveries) : null,
        onTimePct:
          row && deliveries > 0 && hasSla
            ? ratePct(row.onTime, deliveries)
            : null,
        failed: failedByDay.get(date) ?? 0,
      };
    });
  }

  // ────────────────────────────────────────────────────────────────────
  //  Tax summary
  // ────────────────────────────────────────────────────────────────────

  /**
   * Delivered orders by the GST rate they were actually charged.
   *
   * Taxable value is `itemsSubtotal − discount`, exactly what checkout
   * levied GST on (`shop/pricing/pricing.ts`); tax is the stored
   * `pricing.taxes`. The slab is `taxes ÷ taxable` as a whole percent —
   * read from each order, so a future rate change cannot re-label the
   * past.
   *
   * There is no CGST / SGST split, and no grouping by state. Whether a
   * supply is intra-state (CGST + SGST) or inter-state (IGST) depends on
   * the customer's state, and an order's address stores a city and a
   * pincode but no state. Halving the tax into two columns would be a
   * guess presented as a filing figure.
   */
  private async taxSummary(window: DateRange): Promise<ReportRow[]> {
    const rows = await this.orders
      .aggregate<{
        _id: number | null;
        orders: number;
        taxable: number;
        tax: number;
      }>([
        {
          $match: {
            status: OrderStatus.DELIVERED,
            deliveredAt: { $gte: window.from, $lte: window.to },
          },
        },
        {
          $addFields: {
            taxable: {
              $subtract: ['$pricing.itemsSubtotal', '$pricing.discount'],
            },
          },
        },
        {
          $addFields: {
            rate: {
              $cond: [
                { $gt: ['$taxable', 0] },
                {
                  $round: [
                    {
                      $divide: [
                        { $multiply: ['$pricing.taxes', 100] },
                        '$taxable',
                      ],
                    },
                    0,
                  ],
                },
                null,
              ],
            },
          },
        },
        {
          $group: {
            _id: '$rate',
            orders: { $sum: 1 },
            taxable: { $sum: '$taxable' },
            tax: { $sum: '$pricing.taxes' },
          },
        },
      ])
      .exec();

    return rows
      .sort((a, b) => (a._id ?? -1) - (b._id ?? -1))
      .map((row) => ({
        slab: slabLabel(row._id),
        orders: row.orders,
        taxablePaise: row.taxable,
        taxPaise: row.tax,
      }));
  }
}
