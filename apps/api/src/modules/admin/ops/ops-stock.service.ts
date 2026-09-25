import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';

import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../../database/schemas/inventory-log.schema';
import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import { AisleKey } from '../../../common/constants/aisle.enum';
import { FAILED_STATUSES } from '../../../common/constants/order-status.enum';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { StockAlertsQueryDto, StockAlertsSummaryQueryDto } from './dto';

const MS_PER_DAY = 86_400_000;
const SALES_WINDOW_DAYS = 30;

export type StockSeverity = 'low' | 'out';

export interface StockAlertRow {
  productId: string;
  name: string;
  sku: string;
  brand: string | null;
  /** INTEGER PAISE. */
  price: number;
  isActive: boolean;
  stock: number;
  lowStockThreshold: number;
  severity: StockSeverity;
  vendorId: string;
  vendorName: string | null;
  aisleKey: AisleKey | null;
  lastRestockedAt: string | null;
  /** Units sold in the last 30 days, excluding cancelled and rejected. */
  unitsSold30d: number;
}

export interface StockAlertsSummary {
  low: number;
  out: number;
  byVendor: {
    vendorId: string;
    vendorName: string | null;
    low: number;
    out: number;
  }[];
  byAisle: { aisleKey: AisleKey; low: number; out: number }[];
}

interface StockAggregateRow {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  vendorId: Types.ObjectId;
  stock: number;
  lowStockThreshold: number;
  severityRank: number;
  deficit: number;
  product?: {
    name?: string;
    sku?: string;
    brand?: string | null;
    price?: number;
    isActive?: boolean;
  };
  vendor?: { storeName?: string };
  category?: { aisleKey?: AisleKey };
}

interface SummaryGroupRow {
  _id: Types.ObjectId | AisleKey | null;
  low: number;
  out: number;
  vendorName?: string | null;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  STOCK ALERTS
 * ════════════════════════════════════════════════════════════════════════
 *
 * Only two things matter to an operator here: what has run OUT, and what
 * is about to. The list is therefore ordered by severity and then by how
 * far under its threshold a line has fallen — not alphabetically, and not
 * by the vendor's name.
 *
 * `unitsSold30d` is the column that turns a list into a decision: eighty
 * units of something that sells twice a month is not an alert, and two
 * units of something that sells forty times a week is an emergency.
 */
@Injectable()
export class AdminOpsStockService {
  constructor(
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(InventoryLog.name)
    private readonly inventoryLogs: Model<InventoryLogDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
  ) {}

  async list(query: StockAlertsQueryDto): Promise<Paginated<StockAlertRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const pipeline: PipelineStage[] = [
      ...this.alertStages(query.vendorId),
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          pipeline: [
            {
              $project: {
                name: 1,
                sku: 1,
                brand: 1,
                price: 1,
                isActive: 1,
                categoryId: 1,
              },
            },
          ],
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'categories',
          localField: 'product.categoryId',
          foreignField: '_id',
          pipeline: [{ $project: { aisleKey: 1 } }],
          as: 'category',
        },
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
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

    if (query.aisleKey) {
      pipeline.push({ $match: { 'category.aisleKey': query.aisleKey } });
    }
    if (query.severity) {
      pipeline.push({
        $match: { severityRank: query.severity === 'out' ? 0 : 1 },
      });
    }

    // A single $facet so the total is produced by the SAME pipeline as
    // the rows: `countDocuments` cannot see the post-lookup aisle filter,
    // and a total that disagrees with the page is how "page 4 of 3"
    // bugs appear.
    const [result] = await this.inventory
      .aggregate<{ rows: StockAggregateRow[]; total: { count: number }[] }>([
        ...pipeline,
        {
          $facet: {
            rows: [
              // Out of stock first, then deepest under threshold.
              { $sort: { severityRank: 1, deficit: 1, stock: 1, _id: 1 } },
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
    if (rows.length === 0) return paginate([], total, page, limit);

    const productIds = rows.map((row) => row.productId);
    const [restocks, sold] = await Promise.all([
      this.lastRestockedAt(productIds),
      this.unitsSold(productIds),
    ]);

    return paginate(
      rows.map((row) => {
        const key = row.productId.toString();
        return {
          productId: key,
          name: row.product?.name ?? '',
          sku: row.product?.sku ?? '',
          brand: row.product?.brand ?? null,
          price: row.product?.price ?? 0,
          isActive: row.product?.isActive ?? false,
          stock: row.stock,
          lowStockThreshold: row.lowStockThreshold,
          severity: row.severityRank === 0 ? 'out' : 'low',
          vendorId: row.vendorId.toString(),
          vendorName: row.vendor?.storeName ?? null,
          aisleKey: row.category?.aisleKey ?? null,
          lastRestockedAt: restocks.get(key) ?? null,
          unitsSold30d: sold.get(key) ?? 0,
        };
      }),
      total,
      page,
      limit,
    );
  }

  async summary(
    query: StockAlertsSummaryQueryDto,
  ): Promise<StockAlertsSummary> {
    const stages = this.alertStages(query.vendorId);

    const [result] = await this.inventory
      .aggregate<{
        totals: { low: number; out: number }[];
        byVendor: SummaryGroupRow[];
        byAisle: SummaryGroupRow[];
      }>([
        ...stages,
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            pipeline: [{ $project: { categoryId: 1 } }],
            as: 'product',
          },
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        {
          $lookup: {
            from: 'categories',
            localField: 'product.categoryId',
            foreignField: '_id',
            pipeline: [{ $project: { aisleKey: 1 } }],
            as: 'category',
          },
        },
        { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
        {
          $facet: {
            totals: [{ $group: { _id: null, ...COUNTERS } }],
            byVendor: [
              { $group: { _id: '$vendorId', ...COUNTERS } },
              {
                $lookup: {
                  from: 'vendors',
                  localField: '_id',
                  foreignField: '_id',
                  pipeline: [{ $project: { storeName: 1 } }],
                  as: 'vendor',
                },
              },
              {
                $addFields: {
                  vendorName: { $arrayElemAt: ['$vendor.storeName', 0] },
                },
              },
              { $project: { vendor: 0 } },
              { $sort: { out: -1, low: -1 } },
            ],
            byAisle: [
              { $group: { _id: '$category.aisleKey', ...COUNTERS } },
              { $match: { _id: { $ne: null } } },
              { $sort: { out: -1, low: -1 } },
            ],
          },
        },
      ])
      .exec();

    const totals = result?.totals?.[0];

    return {
      low: totals?.low ?? 0,
      out: totals?.out ?? 0,
      byVendor: (result?.byVendor ?? []).map((row) => ({
        vendorId: String(row._id),
        vendorName: row.vendorName ?? null,
        low: row.low,
        out: row.out,
      })),
      byAisle: (result?.byAisle ?? []).map((row) => ({
        aisleKey: row._id as AisleKey,
        low: row.low,
        out: row.out,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────

  /**
   * Everything at or under its threshold, classified.
   *
   * `severityRank` is 0 for out of stock and 1 for low, so an ordinary
   * ascending sort puts the emergencies first. `deficit` is how far below
   * the threshold the line sits, and is negative for the worst rows —
   * again so that "worst first" is a plain ascending sort the index can
   * serve rather than a comparison in Node.
   */
  private alertStages(vendorId?: string): PipelineStage[] {
    const stages: PipelineStage[] = [];

    if (vendorId) {
      stages.push({ $match: { vendorId: new Types.ObjectId(vendorId) } });
    }

    stages.push(
      {
        $match: {
          $expr: { $lte: ['$stock', '$lowStockThreshold'] },
        },
      },
      {
        $addFields: {
          severityRank: { $cond: [{ $lte: ['$stock', 0] }, 0, 1] },
          deficit: { $subtract: ['$stock', '$lowStockThreshold'] },
        },
      },
    );

    return stages;
  }

  /** Most recent RESTOCK movement per product, in one grouped query. */
  private async lastRestockedAt(
    productIds: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const rows = await this.inventoryLogs
      .aggregate<{ _id: Types.ObjectId; at: Date }>([
        {
          $match: {
            productId: { $in: productIds },
            reason: InventoryReason.RESTOCK,
          },
        },
        { $sort: { at: -1 } },
        { $group: { _id: '$productId', at: { $first: '$at' } } },
      ])
      .exec();

    return new Map(
      rows.map((row) => [row._id.toString(), new Date(row.at).toISOString()]),
    );
  }

  /**
   * Units sold per product over the last 30 days.
   *
   * Computed for the PAGE only, after pagination — a `$lookup` into
   * `orders` per inventory row would join the whole order history to
   * produce twenty numbers.
   */
  private async unitsSold(
    productIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const since = new Date(Date.now() - SALES_WINDOW_DAYS * MS_PER_DAY);

    const rows = await this.orders
      .aggregate<{ _id: Types.ObjectId; qty: number }>([
        {
          $match: {
            placedAt: { $gte: since },
            status: { $nin: [...FAILED_STATUSES] },
            'items.productId': { $in: productIds },
          },
        },
        { $unwind: '$items' },
        {
          $match: {
            'items.productId': { $in: productIds },
            'items.fulfilled': true,
          },
        },
        {
          $group: { _id: '$items.productId', qty: { $sum: '$items.qty' } },
        },
      ])
      .exec();

    return new Map(rows.map((row) => [row._id.toString(), row.qty]));
  }
}

/** The two counters every grouping in the summary shares. */
const COUNTERS = {
  out: { $sum: { $cond: [{ $eq: ['$severityRank', 0] }, 1, 0] } },
  low: { $sum: { $cond: [{ $eq: ['$severityRank', 1] }, 1, 0] } },
};
