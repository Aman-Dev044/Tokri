import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  FilterQuery,
  Model,
  PipelineStage,
  Types,
} from 'mongoose';

import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../../database/schemas/inventory-log.schema';
import { AisleKey } from '../../../common/constants/aisle.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../../admin/audit/audit.service';
import { escapeRegex, iso } from '../common/dto';
import { scopeId, toObjectIdOrNull } from '../common/vendor-scope.decorator';
import {
  AdjustStockDto,
  BulkAdjustStockDto,
  ListInventoryLogsQueryDto,
  ListInventoryQueryDto,
  VendorInventoryReason,
} from './dto';

export interface InventoryRow {
  productId: string;
  vendorId: string;
  name: string;
  sku: string;
  brand: string | null;
  categoryId: string | null;
  aisleKey: AisleKey | null;
  /** INTEGER PAISE. */
  price: number;
  isActive: boolean;
  stock: number;
  reserved: number;
  /** stock − reserved: what a new checkout may actually take. */
  available: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  updatedAt: string | null;
}

export interface BulkAdjustResult {
  adjusted: number;
  items: InventoryRow[];
}

/** One row of the per-product movement trail (`GET .../:productId/logs`). */
export interface InventoryLogRow {
  id: string;
  productId: string;
  vendorId: string;
  /** Signed: +25 on a restock, -2 when an order commits. */
  delta: number;
  reason: InventoryReason;
  refId: string | null;
  byUserId: string | null;
  at: string;
}

interface InventoryAggregateRow {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  updatedAt?: Date;
  product?: {
    name?: string;
    sku?: string;
    brand?: string | null;
    price?: number;
    isActive?: boolean;
    categoryId?: Types.ObjectId;
  };
  category?: { aisleKey?: AisleKey };
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  INVENTORY
 * ════════════════════════════════════════════════════════════════════════
 *
 * Two invariants, both enforced here rather than trusted:
 *
 *  1. STOCK IS ADJUSTED, NEVER SET. Every movement is a signed `$inc`
 *     with a matching `InventoryLog` row written in the SAME transaction.
 *     The log therefore reconstructs the current quantity exactly, and a
 *     disputed count is settled from data instead of memory.
 *
 *  2. STOCK NEVER GOES NEGATIVE. For a decrement the guard lives in the
 *     FILTER — `{ stock: { $gte: -delta } }` — so the check and the write
 *     are one atomic operation. `findOne` → compare → `save()` is the bug
 *     (§8.2): two concurrent decrements both read 1, both pass, and the
 *     row lands on −1.
 */
@Injectable()
export class VendorInventoryService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    // Named `inventoryLogs`, not `logs`: `logs()` below is the public
    // `GET .../:productId/logs` method, and the two names would collide.
    @InjectModel(InventoryLog.name)
    private readonly inventoryLogs: Model<InventoryLogDocument>,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Read
  // ──────────────────────────────────────────────────────────────────

  async list(
    vendorScope: string,
    query: ListInventoryQueryDto,
  ): Promise<Paginated<InventoryRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<InventoryDocument> = {
      vendorId: scopeId(vendorScope),
    };

    const pipeline: PipelineStage[] = [
      { $match: filter },
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
    ];

    if (query.lowStock) {
      pipeline.push({
        $match: { $expr: { $lte: ['$stock', '$lowStockThreshold'] } },
      });
    }
    if (query.outOfStock) {
      pipeline.push({ $match: { stock: { $lte: 0 } } });
    }
    if (query.categoryId) {
      pipeline.push({
        $match: {
          'product.categoryId': new Types.ObjectId(query.categoryId),
        },
      });
    }
    if (query.q) {
      const needle = escapeRegex(query.q);
      pipeline.push({
        $match: {
          $or: [
            { 'product.name': { $regex: needle, $options: 'i' } },
            { 'product.sku': { $regex: needle, $options: 'i' } },
            { 'product.brand': { $regex: needle, $options: 'i' } },
          ],
        },
      });
    }

    const [result] = await this.inventory
      .aggregate<{ rows: InventoryAggregateRow[]; total: { count: number }[] }>(
        [
          ...pipeline,
          {
            $facet: {
              rows: [
                // Emergencies first: out of stock, then deepest under
                // threshold. An ascending sort the index can serve,
                // rather than a comparison in Node.
                {
                  $addFields: {
                    deficit: { $subtract: ['$stock', '$lowStockThreshold'] },
                  },
                },
                { $sort: { deficit: 1, stock: 1, _id: 1 } },
                { $skip: (page - 1) * limit },
                { $limit: limit },
              ],
              total: [{ $count: 'count' }],
            },
          },
        ],
      )
      .exec();

    return paginate(
      (result?.rows ?? []).map(toInventoryRow),
      result?.total?.[0]?.count ?? 0,
      page,
      limit,
    );
  }

  async findOne(vendorScope: string, productId: string): Promise<InventoryRow> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('Inventory row not found');
    }

    const [row] = await this.inventory
      .aggregate<InventoryAggregateRow>([
        {
          $match: {
            productId: new Types.ObjectId(productId),
            vendorId: scopeId(vendorScope),
          },
        },
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
      ])
      .exec();

    if (!row) throw new NotFoundException('Inventory row not found');
    return toInventoryRow(row);
  }

  /**
   * `GET /vendor/inventory/:productId/logs` — the per-product movement
   * trail. Every adjustment already writes an `InventoryLog` row in the
   * SAME transaction as the stock `$inc` (`applyAdjustment` below);
   * nothing before this read it back.
   *
   * Ownership is checked the same way every other route in this
   * controller checks it: the Inventory row must exist for THIS
   * vendor's scope, or it is a 404 — never a 403, so a foreign product
   * id cannot be distinguished from one that does not exist. The
   * `InventoryLog` query itself is filtered by `vendorId` too, as
   * defence in depth (the same double-check `applyAdjustment` already
   * applies).
   *
   * Sorted newest-first off the existing `{ productId: 1, at: -1 }`
   * index on `InventoryLog` — no new index needed.
   */
  async logs(
    vendorScope: string,
    productId: string,
    query: ListInventoryLogsQueryDto,
  ): Promise<Paginated<InventoryLogRow>> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException('Inventory row not found');
    }

    const vendorId = scopeId(vendorScope);
    const product = new Types.ObjectId(productId);

    const owns = await this.inventory
      .exists({ productId: product, vendorId })
      .exec();
    if (!owns) throw new NotFoundException('Inventory row not found');

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = { productId: product, vendorId };

    const [docs, total] = await Promise.all([
      this.inventoryLogs
        .find(filter)
        .sort({ at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<InventoryLogLean[]>()
        .exec(),
      this.inventoryLogs.countDocuments(filter).exec(),
    ]);

    return paginate(docs.map(toInventoryLogRow), total, page, limit);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Write — one product
  // ──────────────────────────────────────────────────────────────────

  async adjust(
    vendorScope: string,
    productId: string,
    dto: AdjustStockDto,
    actor: JwtUser,
  ): Promise<InventoryRow> {
    if (dto.delta === 0 && dto.lowStockThreshold === undefined) {
      throw new BadRequestException(
        'A delta of 0 changes nothing. Send a non-zero delta or a new ' +
          'lowStockThreshold.',
      );
    }

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.applyAdjustment(
          session,
          vendorScope,
          productId,
          dto.delta,
          dto.reason,
          actor,
          dto.lowStockThreshold,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'vendor.inventory.adjust',
      entity: 'Inventory',
      entityId: productId,
      before: null,
      after: {
        delta: dto.delta,
        reason: dto.reason,
        note: dto.note ?? null,
        lowStockThreshold: dto.lowStockThreshold ?? null,
      },
      actor,
    });

    return this.findOne(vendorScope, productId);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Write — many products, one transaction
  // ──────────────────────────────────────────────────────────────────

  /**
   * A stock-take. All lines land or none do.
   *
   * A partially applied batch is worse than a rejected one: the vendor
   * has no way to tell which of their sixty lines took effect, so the
   * only safe recovery is to recount the whole shop.
   */
  async bulkAdjust(
    vendorScope: string,
    dto: BulkAdjustStockDto,
    actor: JwtUser,
  ): Promise<BulkAdjustResult> {
    const seen = new Set<string>();
    for (const item of dto.adjustments) {
      if (seen.has(item.productId)) {
        throw new BadRequestException(
          `productId ${item.productId} appears twice. Combine the deltas ` +
            'into one line — two rows for one product make the log ' +
            'ambiguous about ordering.',
        );
      }
      seen.add(item.productId);
    }

    const fallbackReason = dto.reason ?? VendorInventoryReason.MANUAL;

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        for (const item of dto.adjustments) {
          await this.applyAdjustment(
            session,
            vendorScope,
            item.productId,
            item.delta,
            item.reason ?? fallbackReason,
            actor,
          );
        }
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'vendor.inventory.bulk',
      entity: 'Inventory',
      entityId: null,
      before: null,
      after: {
        count: dto.adjustments.length,
        note: dto.note ?? null,
        adjustments: dto.adjustments.map((item) => ({
          productId: item.productId,
          delta: item.delta,
        })),
      },
      actor,
    });

    const items = await Promise.all(
      dto.adjustments.map((item) => this.findOne(vendorScope, item.productId)),
    );

    return { adjusted: items.length, items };
  }

  // ──────────────────────────────────────────────────────────────────
  //  The single atomic movement
  // ──────────────────────────────────────────────────────────────────

  private async applyAdjustment(
    session: ClientSession,
    vendorScope: string,
    productId: string,
    delta: number,
    reason: VendorInventoryReason,
    actor: JwtUser,
    lowStockThreshold?: number,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new NotFoundException(`Inventory row not found: ${productId}`);
    }

    const vendorId = scopeId(vendorScope);
    const product = new Types.ObjectId(productId);

    const filter: FilterQuery<InventoryDocument> = {
      productId: product,
      // The tenant clause is part of the FILTER, so a foreign product id
      // matches nothing and the transaction aborts — it never reaches a
      // second "is this mine?" check that somebody could remove later.
      vendorId,
    };

    // The invariant lives in the filter. Mongo will not match a document
    // that lacks the stock, so check and decrement are ONE operation and
    // two concurrent callers cannot both pass (§8.2).
    if (delta < 0) filter.stock = { $gte: -delta };

    const update: Record<string, unknown> = {};
    if (delta !== 0) update.$inc = { stock: delta };
    if (lowStockThreshold !== undefined) {
      update.$set = { lowStockThreshold };
    }

    const result = await this.inventory
      .updateOne(filter, update, { session })
      .exec();

    if (result.matchedCount === 0) {
      // Two causes, deliberately distinguished: the row is not this
      // vendor's (404 — it does not exist as far as they are concerned)
      // or it is theirs and has too little stock (409 — a real conflict).
      const exists = await this.inventory
        .countDocuments({ productId: product, vendorId })
        .session(session)
        .exec();

      if (exists === 0) {
        throw new NotFoundException(`Inventory row not found: ${productId}`);
      }

      throw new ConflictException(
        `Insufficient stock for product ${productId}: cannot apply ${delta}`,
      );
    }

    if (delta === 0) return;

    // Same transaction as the $inc. A movement without its log row is a
    // quantity nobody can explain; a log row without its movement is a
    // quantity nobody can reproduce. Neither may exist alone.
    await this.inventoryLogs.create(
      [
        {
          vendorId,
          productId: product,
          delta,
          reason: reason as unknown as InventoryReason,
          refId: null,
          byUserId: toObjectIdOrNull(actor.sub),
          at: new Date(),
        },
      ],
      { session },
    );
  }
}

function toInventoryRow(row: InventoryAggregateRow): InventoryRow {
  const stock = row.stock ?? 0;
  const reserved = row.reserved ?? 0;
  const threshold = row.lowStockThreshold ?? 0;

  return {
    productId: row.productId.toString(),
    vendorId: row.vendorId.toString(),
    name: row.product?.name ?? '',
    sku: row.product?.sku ?? '',
    brand: row.product?.brand ?? null,
    categoryId: row.product?.categoryId
      ? row.product.categoryId.toString()
      : null,
    aisleKey: row.category?.aisleKey ?? null,
    price: row.product?.price ?? 0,
    isActive: row.product?.isActive ?? false,
    stock,
    reserved,
    available: Math.max(stock - reserved, 0),
    lowStockThreshold: threshold,
    isLowStock: stock <= threshold,
    isOutOfStock: stock <= 0,
    updatedAt: iso(row.updatedAt),
  };
}

interface InventoryLogLean {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  delta: number;
  reason: InventoryReason;
  refId?: Types.ObjectId | null;
  byUserId?: Types.ObjectId | null;
  at: Date;
}

function toInventoryLogRow(row: InventoryLogLean): InventoryLogRow {
  return {
    id: row._id.toString(),
    productId: row.productId.toString(),
    vendorId: row.vendorId.toString(),
    delta: row.delta,
    reason: row.reason,
    refId: row.refId ? row.refId.toString() : null,
    byUserId: row.byUserId ? row.byUserId.toString() : null,
    at: new Date(row.at).toISOString(),
  };
}
