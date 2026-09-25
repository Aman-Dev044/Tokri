import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
  LedgerEntryType,
} from '../../../database/schemas/ledger-entry.schema';
import {
  Settlement,
  SettlementDocument,
  SettlementStatus,
} from '../../../database/schemas/settlement.schema';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { iso, resolveRange } from '../common/dto';
import { scopeId } from '../common/vendor-scope.decorator';
import {
  EarningsQueryDto,
  ListLedgerQueryDto,
  ListSettlementsQueryDto,
  SalesGroupBy,
  SalesReportQueryDto,
  TopProductsQueryDto,
} from './dto';

export interface EarningsSummary {
  range: { from: string; to: string };
  /** Sum of `pricing.itemsSubtotal` over DELIVERED orders. INTEGER PAISE. */
  gross: number;
  /** Sum of `pricing.commissionAmount` — the SNAPSHOT rate. */
  commission: number;
  /** Refund ledger rows in the window, as a positive magnitude. */
  refunds: number;
  /** gross − commission − refunds. What the vendor has earned. */
  net: number;
  orderCount: number;
  /** INTEGER PAISE across settlements that have not been paid yet. */
  payoutPending: number;
  lastSettlement: {
    id: string;
    periodStart: string | null;
    periodEnd: string | null;
    netPayable: number;
    status: SettlementStatus;
    paidAt: string | null;
  } | null;
}

export interface LedgerRow {
  id: string;
  orderId: string | null;
  type: LedgerEntryType;
  /** SIGNED INTEGER PAISE, from the vendor's point of view. */
  amount: number;
  note: string | null;
  settlementId: string | null;
  at: string | null;
}

export interface SettlementRow {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossSales: number;
  totalCommission: number;
  refunds: number;
  netPayable: number;
  orderCount: number;
  status: SettlementStatus;
  paidAt: string | null;
  reference: string | null;
  failureReason: string | null;
}

export interface SalesBucket {
  /** `2026-09-25`, `2026-W39` or `2026-09`, per `groupBy`. */
  period: string;
  periodStart: string;
  orders: number;
  itemsSold: number;
  gross: number;
  commission: number;
  net: number;
  /** Average order value, INTEGER PAISE. */
  aov: number;
}

export interface SalesReport {
  range: { from: string; to: string };
  groupBy: SalesGroupBy;
  buckets: SalesBucket[];
  totals: {
    orders: number;
    itemsSold: number;
    gross: number;
    commission: number;
    net: number;
    aov: number;
  };
}

export interface TopProductRow {
  productId: string;
  name: string;
  unitsSold: number;
  /** INTEGER PAISE. */
  revenue: number;
  orders: number;
}

export interface TopProductsReport {
  range: { from: string; to: string };
  products: TopProductRow[];
}

type LedgerRecord = LedgerEntry & { _id: Types.ObjectId };
type SettlementRecord = Settlement & { _id: Types.ObjectId };

/** Settlements whose money has not left the platform yet. */
const UNPAID: readonly SettlementStatus[] = [
  SettlementStatus.PENDING,
  SettlementStatus.PROCESSING,
  SettlementStatus.FAILED,
];

/**
 * `$dateToString` formats per grouping. Week uses ISO week numbering
 * (`%G-W%V`) rather than `%Y-W%U`, so the last days of December land in
 * the week they actually belong to instead of a phantom week 53 of the
 * wrong year.
 */
const PERIOD_FORMAT: Readonly<Record<SalesGroupBy, string>> = {
  [SalesGroupBy.DAY]: '%Y-%m-%d',
  [SalesGroupBy.WEEK]: '%G-W%V',
  [SalesGroupBy.MONTH]: '%Y-%m',
};

/**
 * ════════════════════════════════════════════════════════════════════════
 *  EARNINGS, LEDGER, SETTLEMENTS AND REPORTS
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── Only DELIVERED orders earn ──────────────────────────────────────────
 * Revenue is counted on delivery, not on placement. An order that is
 * still being packed is not income, and a vendor dashboard that says
 * otherwise turns every cancellation into a number that goes backwards.
 *
 * ── Commission comes from the order, never from the vendor ──────────────
 * `pricing.commissionAmount` is the snapshot taken at checkout
 * (decision #6). Re-deriving it from the vendor's CURRENT rate would
 * retroactively re-price every order they have ever fulfilled, which is
 * the difference between a rate change and a re-billing.
 *
 * ── Every read is scoped ────────────────────────────────────────────────
 * `vendorId: scope` is in the `$match` of every pipeline and the filter
 * of every query. There is no code path here that takes a vendor id from
 * the request.
 */
@Injectable()
export class VendorEarningsService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(LedgerEntry.name)
    private readonly ledger: Model<LedgerEntryDocument>,
    @InjectModel(Settlement.name)
    private readonly settlements: Model<SettlementDocument>,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Summary
  // ──────────────────────────────────────────────────────────────────

  async summary(
    vendorScope: string,
    query: EarningsQueryDto,
  ): Promise<EarningsSummary> {
    const range = resolveRange(query);
    const vendorId = scopeId(vendorScope);

    const [sales, refunds, pending, last] = await Promise.all([
      this.orders
        .aggregate<{
          gross: number;
          commission: number;
          orderCount: number;
        }>([
          {
            $match: {
              vendorId,
              status: OrderStatus.DELIVERED,
              deliveredAt: { $gte: range.from, $lte: range.to },
            },
          },
          {
            $group: {
              _id: null,
              gross: { $sum: '$pricing.itemsSubtotal' },
              commission: { $sum: '$pricing.commissionAmount' },
              orderCount: { $sum: 1 },
            },
          },
        ])
        .exec(),

      this.ledger
        .aggregate<{ total: number }>([
          {
            $match: {
              vendorId,
              type: LedgerEntryType.REFUND,
              at: { $gte: range.from, $lte: range.to },
            },
          },
          { $group: { _id: null, total: { $sum: '$amount' } } },
          // Stored signed (negative); reported as a magnitude.
          { $project: { _id: 0, total: { $abs: '$total' } } },
        ])
        .exec(),

      this.settlements
        .aggregate<{ total: number }>([
          { $match: { vendorId, status: { $in: [...UNPAID] } } },
          { $group: { _id: null, total: { $sum: '$netPayable' } } },
        ])
        .exec(),

      this.settlements
        .findOne({ vendorId })
        .sort({ periodEnd: -1 })
        .lean<SettlementRecord | null>()
        .exec(),
    ]);

    const gross = sales[0]?.gross ?? 0;
    const commission = sales[0]?.commission ?? 0;
    const refunded = refunds[0]?.total ?? 0;

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      gross,
      commission,
      refunds: refunded,
      net: gross - commission - refunded,
      orderCount: sales[0]?.orderCount ?? 0,
      payoutPending: pending[0]?.total ?? 0,
      lastSettlement: last
        ? {
            id: last._id.toString(),
            periodStart: iso(last.periodStart),
            periodEnd: iso(last.periodEnd),
            netPayable: last.netPayable,
            status: last.status,
            paidAt: iso(last.paidAt),
          }
        : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Ledger
  // ──────────────────────────────────────────────────────────────────

  async ledgerPage(
    vendorScope: string,
    query: ListLedgerQueryDto,
  ): Promise<Paginated<LedgerRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<LedgerEntryDocument> = {
      vendorId: scopeId(vendorScope),
    };
    if (query.type) filter.type = query.type;
    if (query.from || query.to) {
      const range = resolveRange(query);
      filter.at = { $gte: range.from, $lte: range.to };
    }

    const [rows, total] = await Promise.all([
      this.ledger
        .find(filter)
        .sort({ at: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LedgerRecord[]>()
        .exec(),
      this.ledger.countDocuments(filter).exec(),
    ]);

    return paginate(
      rows.map((row) => ({
        id: row._id.toString(),
        orderId: row.orderId ? row.orderId.toString() : null,
        type: row.type,
        amount: row.amount,
        note: row.note ?? null,
        settlementId: row.settlementId ? row.settlementId.toString() : null,
        at: iso(row.at),
      })),
      total,
      page,
      limit,
    );
  }

  // ──────────────────────────────────────────────────────────────────
  //  Settlements
  // ──────────────────────────────────────────────────────────────────

  async settlementsPage(
    vendorScope: string,
    query: ListSettlementsQueryDto,
  ): Promise<Paginated<SettlementRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<SettlementDocument> = {
      vendorId: scopeId(vendorScope),
    };
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      const range = resolveRange(query, 180);
      filter.periodEnd = { $gte: range.from, $lte: range.to };
    }

    const [rows, total] = await Promise.all([
      this.settlements
        .find(filter)
        .sort({ periodEnd: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<SettlementRecord[]>()
        .exec(),
      this.settlements.countDocuments(filter).exec(),
    ]);

    return paginate(
      rows.map((row) => ({
        id: row._id.toString(),
        periodStart: iso(row.periodStart),
        periodEnd: iso(row.periodEnd),
        grossSales: row.grossSales,
        totalCommission: row.totalCommission,
        refunds: row.refunds,
        netPayable: row.netPayable,
        orderCount: row.orderCount,
        status: row.status,
        paidAt: iso(row.paidAt),
        reference: row.reference ?? null,
        failureReason: row.failureReason ?? null,
      })),
      total,
      page,
      limit,
    );
  }

  /**
   * One settlement — `{ _id, vendorId }`, both clauses.
   *
   * Another vendor's settlement is a 404, not a 403: a 403 would confirm
   * the id is real, and settlement ids are sequential enough in practice
   * that confirming one confirms the shape of the rest.
   */
  async findSettlement(
    vendorScope: string,
    id: string,
  ): Promise<SettlementRow> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Settlement not found');
    }

    const row = await this.settlements
      .findOne({
        _id: new Types.ObjectId(id),
        vendorId: scopeId(vendorScope),
      })
      .lean<SettlementRecord | null>()
      .exec();

    if (!row) throw new NotFoundException('Settlement not found');

    return {
      id: row._id.toString(),
      periodStart: iso(row.periodStart),
      periodEnd: iso(row.periodEnd),
      grossSales: row.grossSales,
      totalCommission: row.totalCommission,
      refunds: row.refunds,
      netPayable: row.netPayable,
      orderCount: row.orderCount,
      status: row.status,
      paidAt: iso(row.paidAt),
      reference: row.reference ?? null,
      failureReason: row.failureReason ?? null,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Reports
  // ──────────────────────────────────────────────────────────────────

  async salesReport(
    vendorScope: string,
    query: SalesReportQueryDto,
  ): Promise<SalesReport> {
    const groupBy = query.groupBy ?? SalesGroupBy.DAY;
    const range = resolveRange(query, groupBy === SalesGroupBy.DAY ? 30 : 180);

    const rows = await this.orders
      .aggregate<{
        _id: string;
        periodStart: Date;
        orders: number;
        itemsSold: number;
        gross: number;
        commission: number;
        net: number;
      }>([
        {
          $match: {
            vendorId: scopeId(vendorScope),
            status: OrderStatus.DELIVERED,
            deliveredAt: { $gte: range.from, $lte: range.to },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: PERIOD_FORMAT[groupBy],
                date: '$deliveredAt',
              },
            },
            periodStart: { $min: '$deliveredAt' },
            orders: { $sum: 1 },
            // Only fulfilled lines count: a line the vendor dropped was
            // refunded and never sold.
            itemsSold: {
              $sum: {
                $reduce: {
                  input: '$items',
                  initialValue: 0,
                  in: {
                    $add: [
                      '$$value',
                      { $cond: ['$$this.fulfilled', '$$this.qty', 0] },
                    ],
                  },
                },
              },
            },
            gross: { $sum: '$pricing.itemsSubtotal' },
            commission: { $sum: '$pricing.commissionAmount' },
            net: { $sum: '$pricing.vendorPayout' },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();

    const buckets: SalesBucket[] = rows.map((row) => ({
      period: row._id,
      periodStart: new Date(row.periodStart).toISOString(),
      orders: row.orders,
      itemsSold: row.itemsSold,
      gross: row.gross,
      commission: row.commission,
      net: row.net,
      aov: row.orders > 0 ? Math.round(row.gross / row.orders) : 0,
    }));

    const totals = buckets.reduce(
      (acc, bucket) => ({
        orders: acc.orders + bucket.orders,
        itemsSold: acc.itemsSold + bucket.itemsSold,
        gross: acc.gross + bucket.gross,
        commission: acc.commission + bucket.commission,
        net: acc.net + bucket.net,
        aov: 0,
      }),
      { orders: 0, itemsSold: 0, gross: 0, commission: 0, net: 0, aov: 0 },
    );
    totals.aov = totals.orders > 0 ? Math.round(totals.gross / totals.orders) : 0;

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      groupBy,
      buckets,
      totals,
    };
  }

  async topProducts(
    vendorScope: string,
    query: TopProductsQueryDto,
  ): Promise<TopProductsReport> {
    const range = resolveRange(query);
    const limit = query.limit ?? 10;

    const pipeline: PipelineStage[] = [
      {
        $match: {
          vendorId: scopeId(vendorScope),
          status: OrderStatus.DELIVERED,
          deliveredAt: { $gte: range.from, $lte: range.to },
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.fulfilled': true } },
      {
        $group: {
          _id: '$items.productId',
          // The snapshot name from the order line, not a join to the
          // catalogue: a product renamed last week must not retroactively
          // rename itself in a report about the week before.
          name: { $first: '$items.name' },
          unitsSold: { $sum: '$items.qty' },
          revenue: { $sum: '$items.lineTotal' },
          orders: { $addToSet: '$_id' },
        },
      },
      {
        $project: {
          name: 1,
          unitsSold: 1,
          revenue: 1,
          orders: { $size: '$orders' },
        },
      },
      { $sort: { revenue: -1, unitsSold: -1 } },
      { $limit: limit },
    ];

    const rows = await this.orders
      .aggregate<{
        _id: Types.ObjectId;
        name: string;
        unitsSold: number;
        revenue: number;
        orders: number;
      }>(pipeline)
      .exec();

    return {
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      products: rows.map((row) => ({
        productId: row._id.toString(),
        name: row.name,
        unitsSold: row.unitsSold,
        revenue: row.revenue,
        orders: row.orders,
      })),
    };
  }
}
