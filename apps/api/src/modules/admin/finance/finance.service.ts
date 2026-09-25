import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import {
  Settlement,
  SettlementDocument,
  SettlementStatus,
} from '../../../database/schemas/settlement.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
  LedgerEntryType,
} from '../../../database/schemas/ledger-entry.schema';
import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  Vendor,
  VendorDocument,
} from '../../../database/schemas/vendor.schema';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../audit/audit.service';
import {
  GenerateSettlementsDto,
  ListLedgerQueryDto,
  ListSettlementsQueryDto,
  PaySettlementDto,
} from './dto';

export interface SettlementRow {
  id: string;
  vendorId: string;
  vendorName: string | null;
  periodStart: string;
  periodEnd: string;
  /** All INTEGER PAISE. */
  grossSales: number;
  totalCommission: number;
  refunds: number;
  netPayable: number;
  orderCount: number;
  status: SettlementStatus;
  paidAt: string | null;
  reference: string | null;
  failureReason: string | null;
  createdAt: string | null;
}

export interface LedgerRow {
  id: string;
  vendorId: string;
  vendorName: string | null;
  orderId: string | null;
  orderNo: string | null;
  type: LedgerEntryType;
  /** SIGNED INTEGER PAISE, from the vendor's point of view. */
  amount: number;
  note: string | null;
  settlementId: string | null;
  at: string;
}

export interface SettlementDetail extends SettlementRow {
  entries: LedgerRow[];
}

export interface GenerateResult {
  periodStart: string;
  periodEnd: string;
  created: SettlementRow[];
  /** Vendors that already had a settlement for this exact window. */
  skipped: { vendorId: string; settlementId: string; reason: string }[];
  totals: { vendors: number; netPayable: number };
}

interface SettlementAggregateRow {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  periodStart: Date;
  periodEnd: Date;
  grossSales: number;
  totalCommission: number;
  refunds: number;
  netPayable: number;
  orderCount: number;
  status: SettlementStatus;
  paidAt?: Date | null;
  reference?: string | null;
  failureReason?: string | null;
  createdAt?: Date;
  vendor?: { storeName?: string };
}

interface LedgerAggregateRow {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  orderId?: Types.ObjectId | null;
  type: LedgerEntryType;
  amount: number;
  note?: string | null;
  settlementId?: Types.ObjectId | null;
  at: Date;
  vendor?: { storeName?: string };
  order?: { orderNo?: string };
}

/** Per-vendor roll-up of the delivered orders inside one window. */
interface VendorPeriodTotals {
  _id: Types.ObjectId;
  grossSales: number;
  totalCommission: number;
  orderCount: number;
  orderIds: Types.ObjectId[];
}

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

const startOfUtcDay = (value: string): Date => {
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const endOfUtcDay = (value: string): Date => {
  const d = new Date(value);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

@Injectable()
export class AdminFinanceService {
  private readonly logger = new Logger(AdminFinanceService.name);

  private static readonly SETTLEMENT_SORTABLE: ReadonlySet<string> = new Set([
    'periodEnd',
    'periodStart',
    'netPayable',
    'grossSales',
    'status',
    'createdAt',
  ]);

  private static readonly LEDGER_SORTABLE: ReadonlySet<string> = new Set([
    'at',
    'amount',
    'type',
  ]);

  constructor(
    @InjectModel(Settlement.name)
    private readonly settlements: Model<SettlementDocument>,
    @InjectModel(LedgerEntry.name)
    private readonly ledger: Model<LedgerEntryDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly audit: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  //  Settlements — reads
  // ────────────────────────────────────────────────────────────────────

  async listSettlements(
    query: ListSettlementsQueryDto,
  ): Promise<Paginated<SettlementRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<SettlementDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);

    // `from`/`to` select settlement PERIODS that overlap the window, not
    // settlements created inside it: an operator asking for "September"
    // means the September payouts, whenever the rows happened to be made.
    if (query.from) filter.periodEnd = { $gte: new Date(query.from) };
    if (query.to) filter.periodStart = { $lte: new Date(query.to) };

    const sort = this.resolveSort(
      query.sort,
      AdminFinanceService.SETTLEMENT_SORTABLE,
      { periodEnd: -1 },
    );

    const pipeline: PipelineStage[] = [
      { $match: filter },
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
      { $sort: sort },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ];

    const [rows, total] = await Promise.all([
      this.settlements.aggregate<SettlementAggregateRow>(pipeline).exec(),
      this.settlements.countDocuments(filter).exec(),
    ]);

    return paginate(rows.map(toSettlementRow), total, page, limit);
  }

  async findSettlement(id: string): Promise<SettlementDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Settlement not found');
    }

    const [row] = await this.settlements
      .aggregate<SettlementAggregateRow>([
        { $match: { _id: new Types.ObjectId(id) } },
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

    if (!row) throw new NotFoundException('Settlement not found');

    const entries = await this.ledgerRowsFor({
      settlementId: new Types.ObjectId(id),
    });

    return { ...toSettlementRow(row), entries };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Settlements — generation
  // ────────────────────────────────────────────────────────────────────

  /**
   * Rolls one period's DELIVERED orders into a Settlement per vendor.
   *
   * ── Why this is safe to run twice ───────────────────────────────────
   * `{ vendorId, periodStart, periodEnd }` is UNIQUE on the settlements
   * collection. A second run for the same window loses the insert and
   * reports the vendor as skipped rather than paying the week out again.
   * The unique index — not a pre-check — is the guarantee: a pre-check
   * loses to a concurrent run, an index does not.
   *
   * ── The arithmetic (all INTEGER PAISE) ──────────────────────────────
   *   grossSales      Sum of `pricing.itemsSubtotal` over the delivered
   *                   orders in the window.
   *   totalCommission Sum of `pricing.commissionAmount` — the SNAPSHOT
   *                   taken at order creation, never the vendor's current
   *                   rate, so a rate change never re-prices history.
   *   refunds         Refund ledger rows attached to those same orders.
   *   netPayable      grossSales − totalCommission − refunds.
   *
   * The delivery fee is deliberately absent: it is platform revenue, not
   * the vendor's (locked decision #5).
   *
   * Ledger rows are reconciled, not blindly appended — an order that
   * already has a `sale` row keeps it and is simply attached to this
   * settlement. Appending a second one would double the vendor's balance.
   */
  async generate(
    dto: GenerateSettlementsDto,
    actor: JwtUser,
  ): Promise<GenerateResult> {
    const periodStart = startOfUtcDay(dto.periodStart);
    const periodEnd = endOfUtcDay(dto.periodEnd);

    if (periodStart.getTime() > periodEnd.getTime()) {
      throw new BadRequestException('periodStart must be before periodEnd');
    }
    if (periodEnd.getTime() > Date.now()) {
      throw new BadRequestException(
        'periodEnd is in the future. A settlement window must be closed ' +
          'before it can be paid, or late deliveries land outside every run.',
      );
    }

    const match: FilterQuery<OrderDocument> = {
      status: OrderStatus.DELIVERED,
      deliveredAt: { $gte: periodStart, $lte: periodEnd },
    };
    if (dto.vendorId) match.vendorId = new Types.ObjectId(dto.vendorId);

    const totals = await this.orders
      .aggregate<VendorPeriodTotals>([
        { $match: match },
        {
          $group: {
            _id: '$vendorId',
            grossSales: { $sum: '$pricing.itemsSubtotal' },
            totalCommission: { $sum: '$pricing.commissionAmount' },
            orderCount: { $sum: 1 },
            orderIds: { $push: '$_id' },
          },
        },
      ])
      .exec();

    const created: SettlementRow[] = [];
    const skipped: GenerateResult['skipped'] = [];

    for (const vendorTotals of totals) {
      const existing = await this.settlements
        .findOne({
          vendorId: vendorTotals._id,
          periodStart,
          periodEnd,
        })
        .select('_id')
        .lean<{ _id: Types.ObjectId } | null>()
        .exec();

      if (existing) {
        skipped.push({
          vendorId: vendorTotals._id.toString(),
          settlementId: existing._id.toString(),
          reason: 'A settlement already exists for this vendor and period',
        });
        continue;
      }

      const refunds = await this.refundsFor(vendorTotals.orderIds);
      const netPayable =
        vendorTotals.grossSales - vendorTotals.totalCommission - refunds;

      let settlement: SettlementDocument;
      try {
        settlement = await this.settlements.create({
          vendorId: vendorTotals._id,
          periodStart,
          periodEnd,
          grossSales: vendorTotals.grossSales,
          totalCommission: vendorTotals.totalCommission,
          refunds,
          netPayable,
          orderCount: vendorTotals.orderCount,
          status: SettlementStatus.PENDING,
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          // Lost the race to a concurrent run. That run produced exactly
          // the row we wanted, so this is not a failure.
          const raced = await this.settlements
            .findOne({ vendorId: vendorTotals._id, periodStart, periodEnd })
            .select('_id')
            .lean<{ _id: Types.ObjectId } | null>()
            .exec();
          skipped.push({
            vendorId: vendorTotals._id.toString(),
            settlementId: raced?._id.toString() ?? 'unknown',
            reason: 'Created concurrently by another run',
          });
          continue;
        }
        throw error;
      }

      await this.reconcileLedger(settlement, vendorTotals);

      created.push(
        toSettlementRow({
          ...settlement.toObject<SettlementAggregateRow>(),
          _id: settlement._id,
        }),
      );
    }

    await this.audit.record({
      action: 'settlement.generate',
      entity: 'Settlement',
      entityId: null,
      before: null,
      after: {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        vendorId: dto.vendorId ?? null,
        created: created.length,
        skipped: skipped.length,
        netPayable: created.reduce((sum, row) => sum + row.netPayable, 0),
      },
      actor,
    });

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      created,
      skipped,
      totals: {
        vendors: created.length,
        netPayable: created.reduce((sum, row) => sum + row.netPayable, 0),
      },
    };
  }

  /**
   * Attaches the window's ledger rows to the settlement, creating the
   * `sale` / `commission` pair only for orders that do not already have
   * one. Rows already carrying a different settlementId are left alone —
   * money is never moved between settlements by a re-run.
   */
  private async reconcileLedger(
    settlement: SettlementDocument,
    totals: VendorPeriodTotals,
  ): Promise<void> {
    const existing = await this.ledger
      .find({
        orderId: { $in: totals.orderIds },
        type: { $in: [LedgerEntryType.SALE, LedgerEntryType.COMMISSION] },
      })
      .select('orderId type settlementId')
      .lean<
        {
          _id: Types.ObjectId;
          orderId: Types.ObjectId;
          type: LedgerEntryType;
          settlementId?: Types.ObjectId | null;
        }[]
      >()
      .exec();

    const covered = new Set(
      existing.map((row) => `${row.orderId.toString()}:${row.type}`),
    );

    const missing = totals.orderIds.filter(
      (orderId) =>
        !covered.has(`${orderId.toString()}:${LedgerEntryType.SALE}`),
    );

    if (missing.length > 0) {
      const orders = await this.orders
        .find({ _id: { $in: missing } })
        .select('vendorId orderNo pricing deliveredAt')
        .lean<
          {
            _id: Types.ObjectId;
            vendorId: Types.ObjectId;
            orderNo: string;
            pricing: { itemsSubtotal: number; commissionAmount: number };
            deliveredAt?: Date | null;
          }[]
        >()
        .exec();

      const rows = orders.flatMap((order) => [
        {
          vendorId: order.vendorId,
          orderId: order._id,
          type: LedgerEntryType.SALE,
          amount: order.pricing.itemsSubtotal,
          note: `Sale ${order.orderNo}`,
          settlementId: settlement._id,
          at: order.deliveredAt ?? settlement.periodEnd,
        },
        {
          vendorId: order.vendorId,
          orderId: order._id,
          type: LedgerEntryType.COMMISSION,
          // Negative: the platform's cut leaves the vendor's balance.
          amount: -order.pricing.commissionAmount,
          note: `Commission ${order.orderNo}`,
          settlementId: settlement._id,
          at: order.deliveredAt ?? settlement.periodEnd,
        },
      ]);

      if (rows.length > 0) await this.ledger.insertMany(rows);
    }

    // Sweep every still-unattached row for these orders into this
    // settlement, refunds included.
    await this.ledger
      .updateMany(
        {
          orderId: { $in: totals.orderIds },
          settlementId: null,
        },
        { $set: { settlementId: settlement._id } },
      )
      .exec();
  }

  /** Total refunded against a set of orders, as a POSITIVE magnitude. */
  private async refundsFor(orderIds: Types.ObjectId[]): Promise<number> {
    if (orderIds.length === 0) return 0;

    const [row] = await this.ledger
      .aggregate<{ total: number }>([
        {
          $match: {
            orderId: { $in: orderIds },
            type: LedgerEntryType.REFUND,
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
        { $project: { _id: 0, total: { $abs: '$total' } } },
      ])
      .exec();

    return row?.total ?? 0;
  }

  // ────────────────────────────────────────────────────────────────────
  //  Settlements — payment
  // ────────────────────────────────────────────────────────────────────

  /**
   * Marks a settlement paid and writes the matching `payout` ledger row.
   *
   * The route carries `@Idempotent()`, so a retried request replays the
   * original response instead of writing a second payout row. Belt and
   * braces: a settlement that is already PAID is a 409 here regardless.
   */
  async pay(
    id: string,
    dto: PaySettlementDto,
    actor: JwtUser,
  ): Promise<SettlementDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Settlement not found');
    }
    const settlement = await this.settlements.findById(id).exec();
    if (!settlement) throw new NotFoundException('Settlement not found');

    if (settlement.status === SettlementStatus.PAID) {
      throw new ConflictException(
        `Settlement ${id} was already paid on ${settlement.paidAt?.toISOString() ?? 'an earlier date'}`,
      );
    }

    const before = { status: settlement.status, paidAt: settlement.paidAt ?? null };
    const paidAt = new Date();

    settlement.status = SettlementStatus.PAID;
    settlement.paidAt = paidAt;
    settlement.reference = dto.reference;
    settlement.failureReason = null;
    await settlement.save();

    await this.ledger.create({
      vendorId: settlement.vendorId,
      orderId: null,
      type: LedgerEntryType.PAYOUT,
      // Negative: the balance has been transferred out to the vendor.
      amount: -settlement.netPayable,
      note: dto.note ?? `Payout ref ${dto.reference}`,
      settlementId: settlement._id,
      at: paidAt,
    });

    await this.audit.record({
      action: 'settlement.pay',
      entity: 'Settlement',
      entityId: id,
      before,
      after: {
        status: SettlementStatus.PAID,
        paidAt: paidAt.toISOString(),
        reference: dto.reference,
        netPayable: settlement.netPayable,
      },
      actor,
    });

    return this.findSettlement(id);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Ledger
  // ────────────────────────────────────────────────────────────────────

  async listLedger(query: ListLedgerQueryDto): Promise<Paginated<LedgerRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<LedgerEntryDocument> = {};
    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.type) filter.type = query.type;
    if (query.orderId) filter.orderId = new Types.ObjectId(query.orderId);
    if (query.settlementId) {
      filter.settlementId = new Types.ObjectId(query.settlementId);
    }
    if (query.from || query.to) {
      const at: Record<string, Date> = {};
      if (query.from) at.$gte = new Date(query.from);
      if (query.to) at.$lte = new Date(query.to);
      filter.at = at;
    }

    const sort = this.resolveSort(
      query.sort,
      AdminFinanceService.LEDGER_SORTABLE,
      { at: -1 },
    );

    const [rows, total] = await Promise.all([
      this.ledgerRowsFor(filter, sort, (page - 1) * limit, limit),
      this.ledger.countDocuments(filter).exec(),
    ]);

    return paginate(rows, total, page, limit);
  }

  private async ledgerRowsFor(
    filter: FilterQuery<LedgerEntryDocument>,
    sort: Record<string, 1 | -1> = { at: -1 },
    skip = 0,
    limit = 500,
  ): Promise<LedgerRow[]> {
    const rows = await this.ledger
      .aggregate<LedgerAggregateRow>([
        { $match: filter },
        { $sort: sort },
        { $skip: skip },
        { $limit: limit },
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
        {
          $lookup: {
            from: 'orders',
            localField: 'orderId',
            foreignField: '_id',
            pipeline: [{ $project: { orderNo: 1 } }],
            as: 'order',
          },
        },
        { $unwind: { path: '$order', preserveNullAndEmptyArrays: true } },
      ])
      .exec();

    return rows.map(toLedgerRow);
  }

  private resolveSort(
    requested: string | undefined,
    allowed: ReadonlySet<string>,
    fallback: Record<string, 1 | -1>,
  ): Record<string, 1 | -1> {
    if (!requested) return fallback;

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!allowed.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[...allowed].join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}

function toSettlementRow(row: SettlementAggregateRow): SettlementRow {
  return {
    id: row._id.toString(),
    vendorId: row.vendorId.toString(),
    vendorName: row.vendor?.storeName ?? null,
    periodStart: new Date(row.periodStart).toISOString(),
    periodEnd: new Date(row.periodEnd).toISOString(),
    grossSales: row.grossSales,
    totalCommission: row.totalCommission,
    refunds: row.refunds,
    netPayable: row.netPayable,
    orderCount: row.orderCount,
    status: row.status,
    paidAt: row.paidAt ? new Date(row.paidAt).toISOString() : null,
    reference: row.reference ?? null,
    failureReason: row.failureReason ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
}

function toLedgerRow(row: LedgerAggregateRow): LedgerRow {
  return {
    id: row._id.toString(),
    vendorId: row.vendorId.toString(),
    vendorName: row.vendor?.storeName ?? null,
    orderId: row.orderId ? row.orderId.toString() : null,
    orderNo: row.order?.orderNo ?? null,
    type: row.type,
    amount: row.amount,
    note: row.note ?? null,
    settlementId: row.settlementId ? row.settlementId.toString() : null,
    at: new Date(row.at).toISOString(),
  };
}
