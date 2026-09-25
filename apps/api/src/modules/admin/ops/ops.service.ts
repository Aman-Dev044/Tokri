import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
} from '../../../database/schemas/delivery-partner.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  Issue,
  IssueDocument,
  OPEN_ISSUE_STATUSES,
} from '../../../database/schemas/issue.schema';
import {
  IN_FLIGHT_STATUSES,
  OrderStatus,
} from '../../../common/constants/order-status.enum';
import { Role } from '../../../common/constants/roles.enum';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { round1 } from '../analytics/kpi.util';
import { escapeRegex } from '../common/dto';
import { AdminSettingsService } from '../settings/settings.service';
import {
  OPS_CARD_PROJECTION,
  OpsCardsService,
  OpsOrderCard,
  OpsOrderRecord,
} from './ops-cards.service';
import { OpsBoardQueryDto } from './dto';
import {
  LANE_CARD_CAP,
  OPS_LANES,
  OpsLane,
  STUCK_STATUSES,
  STUCK_THRESHOLD_MINUTES,
  explainStuck,
  startOfUtcDay,
} from './sla.util';

// ── Response shapes ─────────────────────────────────────────────────────

export interface OpsSummary {
  liveOrders: {
    total: number;
    byStatus: { status: OrderStatus; count: number }[];
  };
  needsAction: {
    pendingVendors: number;
    pendingRiders: number;
    unassignedOrders: number;
    stuckOrders: number;
    failedDeliveries: number;
    openIssues: number;
    lowStockItems: number;
    outOfStockItems: number;
  };
  dispatch: {
    ridersOnline: number;
    ridersAvailable: number;
    ridersOnDelivery: number;
    /** Ready-for-pickup → assigned, averaged over today. */
    avgAssignMinutes: number | null;
  };
  today: {
    ordersPlaced: number;
    ordersDelivered: number;
    ordersCancelled: number;
    slaBreaches: number;
    onTimePct: number | null;
  };
}

export interface OpsBoardLane {
  lane: OpsLane;
  label: string;
  orders: OpsOrderCard[];
  /** Orders in this lane overall, not just the ones returned. */
  total: number;
  /** True when `total` exceeded the per-lane cap and cards were dropped. */
  truncated: boolean;
}

export interface StuckOrderRow extends OpsOrderCard {
  reason: string;
  suggestedAction: string;
  /** Whole minutes BEYOND the threshold for this status. */
  stuckSinceMinutes: number;
}

// ── Internal aggregate shapes ───────────────────────────────────────────

interface StuckRecord extends OpsOrderRecord {
  minutesInStatus: number;
  thresholdMinutes: number;
}

interface BoardFacet {
  counts: { _id: OrderStatus; count: number }[];
  [lane: string]: unknown;
}

const TERMINAL_FAILURES: readonly OrderStatus[] = [
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
];

/** Statuses a rider is actively carrying an order in. */
export const ON_DELIVERY_STATUSES: readonly OrderStatus[] = [
  OrderStatus.ASSIGNED,
  OrderStatus.PICKED_UP,
  OrderStatus.OUT_FOR_DELIVERY,
];

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE OPERATIONS CONSOLE
 * ════════════════════════════════════════════════════════════════════════
 *
 * SUPER_ADMIN asks "how is the business doing". ADMIN asks "what needs
 * doing right now". Every endpoint here answers the second question, so
 * nothing returns a lifetime total and everything is measured against a
 * clock.
 */
@Injectable()
export class AdminOpsService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Issue.name) private readonly issues: Model<IssueDocument>,
    private readonly cards: OpsCardsService,
    private readonly settings: AdminSettingsService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  1. Summary — the ADMIN landing payload
  // ──────────────────────────────────────────────────────────────────

  async summary(): Promise<OpsSummary> {
    const now = new Date();
    const todayStart = startOfUtcDay(now);
    const config = await this.settings.get();

    const [
      live,
      pendingVendors,
      pendingRiders,
      unassignedOrders,
      stuckOrders,
      failedDeliveries,
      openIssues,
      stock,
      ridersOnline,
      ridersAvailable,
      ridersOnDelivery,
      avgAssignMinutes,
      today,
    ] = await Promise.all([
      this.liveOrders(),
      this.vendors
        .countDocuments({ status: VendorStatus.PENDING })
        .exec(),
      this.partners
        .countDocuments({ status: PartnerStatus.PENDING })
        .exec(),
      this.orders
        .countDocuments({
          status: OrderStatus.READY_FOR_PICKUP,
          deliveryPartnerId: null,
        })
        .exec(),
      this.countStuck(now, config.stuckOrderGraceMinutes),
      this.orders
        .countDocuments({ status: OrderStatus.DELIVERY_FAILED })
        .exec(),
      this.issues
        .countDocuments({ status: { $in: OPEN_ISSUE_STATUSES } })
        .exec(),
      this.stockCounts(),
      this.partners
        .countDocuments({ isOnline: true, status: PartnerStatus.ACTIVE })
        .exec(),
      this.partners
        .countDocuments({
          isOnline: true,
          isAvailable: true,
          activeOrderId: null,
          status: PartnerStatus.ACTIVE,
        })
        .exec(),
      this.countRidersOnDelivery(),
      this.averageAssignMinutes(todayStart),
      this.todayCounts(todayStart, now, config.slaMinutes),
    ]);

    return {
      liveOrders: live,
      needsAction: {
        pendingVendors,
        pendingRiders,
        unassignedOrders,
        stuckOrders,
        failedDeliveries,
        openIssues,
        lowStockItems: stock.low,
        outOfStockItems: stock.out,
      },
      dispatch: {
        ridersOnline,
        ridersAvailable,
        ridersOnDelivery,
        avgAssignMinutes,
      },
      today,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  2. Live order board
  // ──────────────────────────────────────────────────────────────────

  /**
   * Five lanes, oldest order first inside each.
   *
   * Sorting ascending is not an aesthetic choice: the card at the top of
   * a lane is the one closest to breaching, and an operator works down
   * the column. Newest-first would put the least urgent work in the
   * position the eye lands on.
   */
  async board(query: OpsBoardQueryDto): Promise<OpsBoardLane[]> {
    const now = new Date();
    const config = await this.settings.get();

    const filter = await this.boardFilter(query);

    const facet: Record<string, PipelineStage.FacetPipelineStage[]> = {
      counts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
    };
    for (const spec of OPS_LANES) {
      facet[spec.lane] = [
        { $match: { status: { $in: [...spec.statuses] } } },
        { $sort: { placedAt: 1 } },
        // Capped rather than paginated. `truncated` is decided against
        // the `counts` branch of the same $facet, so the flag is exact
        // without a second query per lane.
        { $limit: LANE_CARD_CAP },
      ];
    }

    const [result] = await this.orders
      .aggregate<BoardFacet>([
        { $match: filter },
        { $project: OPS_CARD_PROJECTION },
        { $facet: facet },
      ])
      .exec();

    const countByStatus = new Map(
      (result?.counts ?? []).map((row) => [row._id, row.count]),
    );

    const perLane = OPS_LANES.map((spec) => ({
      spec,
      records: ((result?.[spec.lane] ?? []) as OpsOrderRecord[]) ?? [],
      total: spec.statuses.reduce(
        (sum, status) => sum + (countByStatus.get(status) ?? 0),
        0,
      ),
    }));

    // One name resolution for the whole board rather than one per lane.
    const names = await this.cards.resolveNames(
      perLane.flatMap((entry) => entry.records),
    );

    return perLane.map((entry) => ({
      lane: entry.spec.lane,
      label: entry.spec.label,
      orders: entry.records.map((record) =>
        this.cards.toCard(record, names, now, config.slaMinutes),
      ),
      total: entry.total,
      truncated: entry.total > entry.records.length,
    }));
  }

  // ──────────────────────────────────────────────────────────────────
  //  3. Stuck orders
  // ──────────────────────────────────────────────────────────────────

  async stuck(query: PaginationQueryDto): Promise<Paginated<StuckOrderRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const now = new Date();
    const config = await this.settings.get();

    if (query.sort && query.sort.replace(/^-/, '') !== 'minutesInStatus') {
      throw new BadRequestException('sort must be minutesInStatus');
    }

    const [result] = await this.orders
      .aggregate<{ rows: StuckRecord[]; total: { count: number }[] }>([
        ...this.stuckStages(now, config.stuckOrderGraceMinutes),
        {
          $facet: {
            rows: [
              // Worst first. An ops list ordered any other way makes the
              // operator do the triage the server already did.
              { $sort: { minutesInStatus: -1 } },
              { $skip: (page - 1) * limit },
              { $limit: limit },
              {
                $project: {
                  ...OPS_CARD_PROJECTION,
                  minutesInStatus: 1,
                  thresholdMinutes: 1,
                },
              },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const records = result?.rows ?? [];
    const total = result?.total?.[0]?.count ?? 0;

    const names = await this.cards.resolveNames(records);

    const rows: StuckOrderRow[] = records.map((record) => {
      const explanation = explainStuck(record.status);
      return {
        ...this.cards.toCard(record, names, now, config.slaMinutes),
        reason: explanation.reason,
        suggestedAction: explanation.suggestedAction,
        stuckSinceMinutes: Math.max(
          0,
          record.minutesInStatus - record.thresholdMinutes,
        ),
      };
    });

    return paginate(rows, total, page, limit);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Shared pipeline fragments
  // ──────────────────────────────────────────────────────────────────

  /**
   * The stuck definition, as a pipeline. Shared by the list and the
   * summary tile so the number above the table always matches the number
   * of rows in it.
   *
   * `thresholdMinutes` is null for anything that cannot be stuck, and
   * those rows are dropped BEFORE the comparison — in MongoDB's BSON
   * ordering a number is greater than null, so leaving them in would
   * report every live order as stuck.
   */
  private stuckStages(now: Date, graceMinutes: number): PipelineStage[] {
    const branches = STUCK_STATUSES.map((status) => ({
      case:
        status === OrderStatus.READY_FOR_PICKUP
          ? {
              $and: [
                { $eq: ['$status', status] },
                // A packed order with a rider on it is waiting for the
                // rider, which is the ASSIGNED problem, not this one.
                { $eq: [{ $ifNull: ['$deliveryPartnerId', null] }, null] },
              ],
            }
          : { $eq: ['$status', status] },
      then: STUCK_THRESHOLD_MINUTES[status] ?? null,
    }));

    return [
      { $match: { status: { $in: [...STUCK_STATUSES] } } },
      {
        $addFields: {
          thresholdMinutes: { $switch: { branches, default: null } },
          lastChangeAt: {
            $ifNull: [
              { $arrayElemAt: ['$statusHistory.at', -1] },
              '$placedAt',
            ],
          },
        },
      },
      { $match: { thresholdMinutes: { $ne: null } } },
      {
        $addFields: {
          minutesInStatus: {
            $floor: {
              $divide: [{ $subtract: [now, '$lastChangeAt'] }, 60_000],
            },
          },
          ageMinutes: {
            $floor: { $divide: [{ $subtract: [now, '$placedAt'] }, 60_000] },
          },
        },
      },
      {
        $match: {
          $expr: {
            $and: [
              { $gt: ['$minutesInStatus', '$thresholdMinutes'] },
              { $gte: ['$ageMinutes', graceMinutes] },
            ],
          },
        },
      },
    ];
  }

  private async countStuck(now: Date, graceMinutes: number): Promise<number> {
    const [row] = await this.orders
      .aggregate<{ count: number }>([
        ...this.stuckStages(now, graceMinutes),
        { $count: 'count' },
      ])
      .exec();
    return row?.count ?? 0;
  }

  /**
   * `?q=` matches an order number OR a customer name.
   *
   * The customer half is resolved to a set of ids first rather than
   * joined: `users` is indexed and bounded, and a `$lookup` before the
   * status match would pull the whole live board through a join to throw
   * most of it away.
   */
  private async boardFilter(
    query: OpsBoardQueryDto,
  ): Promise<FilterQuery<OrderDocument>> {
    const filter: FilterQuery<OrderDocument> = {
      status: { $in: [...IN_FLIGHT_STATUSES] },
    };

    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);

    if (query.q) {
      const needle = new RegExp(escapeRegex(query.q), 'i');
      const customers = await this.users
        .find({ role: Role.CUSTOMER, name: needle })
        .select('_id')
        .limit(200)
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();

      filter.$or = [
        { orderNo: needle },
        { customerId: { $in: customers.map((c) => c._id) } },
      ];
    }

    return filter;
  }

  private async liveOrders(): Promise<OpsSummary['liveOrders']> {
    const rows = await this.orders
      .aggregate<{ _id: OrderStatus; count: number }>([
        { $match: { status: { $in: [...IN_FLIGHT_STATUSES] } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ])
      .exec();

    const byStatusMap = new Map(rows.map((row) => [row._id, row.count]));

    // Every in-flight status is present, zero included, so the UI never
    // has to decide whether a missing bar means zero or means broken.
    const byStatus = IN_FLIGHT_STATUSES.map((status) => ({
      status,
      count: byStatusMap.get(status) ?? 0,
    }));

    return {
      total: byStatus.reduce((sum, row) => sum + row.count, 0),
      byStatus,
    };
  }

  private async stockCounts(): Promise<{ low: number; out: number }> {
    const [row] = await this.inventory
      .aggregate<{ low: number; out: number }>([
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
      .exec();

    return { low: row?.low ?? 0, out: row?.out ?? 0 };
  }

  /**
   * Riders actually carrying something, counted from the ORDERS rather
   * than from `activeOrderId`.
   *
   * The order is the authority: a rider record whose `activeOrderId` was
   * never cleared would otherwise read as busy forever, and the dispatch
   * tile would show a fleet that is fully occupied while nothing moves.
   */
  private async countRidersOnDelivery(): Promise<number> {
    const [row] = await this.orders
      .aggregate<{ count: number }>([
        {
          $match: {
            status: { $in: [...ON_DELIVERY_STATUSES] },
            deliveryPartnerId: { $ne: null },
          },
        },
        { $group: { _id: '$deliveryPartnerId' } },
        { $count: 'count' },
      ])
      .exec();
    return row?.count ?? 0;
  }

  /** Minutes from "packed" to "a rider has it", averaged over today. */
  private async averageAssignMinutes(
    todayStart: Date,
  ): Promise<number | null> {
    const [row] = await this.orders
      .aggregate<{ avg: number | null }>([
        {
          $match: {
            placedAt: { $gte: todayStart },
            status: {
              $in: [...ON_DELIVERY_STATUSES, OrderStatus.DELIVERED],
            },
          },
        },
        {
          $addFields: {
            assignedAt: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: ['$statusHistory', []] },
                    as: 'change',
                    cond: { $eq: ['$$change.to', OrderStatus.ASSIGNED] },
                  },
                },
                0,
              ],
            },
          },
        },
        { $match: { assignedAt: { $ne: null }, readyAt: { $ne: null } } },
        {
          $group: {
            _id: null,
            avg: {
              $avg: {
                $divide: [
                  { $subtract: ['$assignedAt.at', '$readyAt'] },
                  60_000,
                ],
              },
            },
          },
        },
      ])
      .exec();

    return row?.avg == null ? null : round1(row.avg);
  }

  /**
   * Today's throughput and punctuality.
   *
   * A live order that has ALREADY passed the SLA counts as a breach right
   * now — waiting for it to be delivered before admitting it was late is
   * how an ops dashboard stays green through an outage.
   */
  private async todayCounts(
    todayStart: Date,
    now: Date,
    slaMinutes: number,
  ): Promise<OpsSummary['today']> {
    const [ordersPlaced, ordersDelivered, ordersCancelled, sla] =
      await Promise.all([
        this.orders.countDocuments({ placedAt: { $gte: todayStart } }).exec(),
        this.orders
          .countDocuments({ deliveredAt: { $gte: todayStart } })
          .exec(),
        this.orders
          .countDocuments({
            status: { $in: [...TERMINAL_FAILURES] },
            placedAt: { $gte: todayStart },
          })
          .exec(),
        this.orders
          .aggregate<{
            breaches: number;
            delivered: number;
            onTime: number;
          }>([
            { $match: { placedAt: { $gte: todayStart } } },
            {
              $addFields: {
                elapsedMinutes: {
                  $floor: {
                    $divide: [
                      {
                        $subtract: [
                          { $ifNull: ['$deliveredAt', now] },
                          '$placedAt',
                        ],
                      },
                      60_000,
                    ],
                  },
                },
              },
            },
            {
              $group: {
                _id: null,
                breaches: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $not: [
                              { $in: ['$status', [...TERMINAL_FAILURES]] },
                            ],
                          },
                          { $gt: ['$elapsedMinutes', slaMinutes] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                delivered: {
                  $sum: {
                    $cond: [
                      { $eq: ['$status', OrderStatus.DELIVERED] },
                      1,
                      0,
                    ],
                  },
                },
                onTime: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: ['$status', OrderStatus.DELIVERED] },
                          { $lte: ['$elapsedMinutes', slaMinutes] },
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
      ]);

    const row = sla[0];
    const delivered = row?.delivered ?? 0;

    return {
      ordersPlaced,
      ordersDelivered,
      ordersCancelled,
      slaBreaches: row?.breaches ?? 0,
      // No deliveries yet today is not "0% on time" — it is no answer.
      onTimePct:
        delivered > 0 ? round1(((row?.onTime ?? 0) / delivered) * 100) : null,
    };
  }
}
