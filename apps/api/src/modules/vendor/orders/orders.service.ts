import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
} from '../../../database/schemas/delivery-partner.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
  LedgerEntryType,
} from '../../../database/schemas/ledger-entry.schema';
import {
  ALLOWED_ACTOR,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  canTransition,
} from '../../../common/constants/order-status.enum';
import { Role } from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../../admin/audit/audit.service';
import { escapeRegex, iso, resolveRange } from '../common/dto';
import { scopeId, toObjectIdOrNull } from '../common/vendor-scope.decorator';
import {
  OrderPricingSnapshot,
  repriceForFulfilment,
} from './pricing.util';
import {
  AcceptOrderDto,
  AssignPartnerDto,
  ListOrdersQueryDto,
  RejectOrderDto,
  UpdateOrderItemsDto,
  UpdateOrderStatusDto,
} from './dto';

export interface OrderItemRow {
  productId: string;
  name: string;
  image: string | null;
  unit: string;
  /** INTEGER PAISE. */
  price: number;
  qty: number;
  lineTotal: number;
  fulfilled: boolean;
}

export interface OrderPricingRow extends OrderPricingSnapshot {
  /** Convenience for the console; equals `grandTotal`. */
  customerTotal: number;
}

export interface OrderPartyRow {
  id: string | null;
  name: string | null;
  phone: string | null;
}

export interface OrderRow {
  id: string;
  orderNo: string;
  status: OrderStatus;
  itemCount: number;
  /** INTEGER PAISE. */
  itemsSubtotal: number;
  grandTotal: number;
  commissionAmount: number;
  vendorPayout: number;
  payment: { method: PaymentMethod; status: PaymentStatus; refundedAmount: number };
  customer: OrderPartyRow;
  deliveryPartner: OrderPartyRow | null;
  placedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
}

export interface OrderStatusChangeRow {
  from: OrderStatus | null;
  to: OrderStatus;
  byUserId: string | null;
  byRole: Role | null;
  reason: string | null;
  at: string | null;
}

export interface OrderDetail extends OrderRow {
  items: OrderItemRow[];
  pricing: OrderPricingRow;
  address: {
    label: string | null;
    line1: string;
    line2: string | null;
    city: string;
    pincode: string;
    location: { lat: number; lng: number } | null;
    phone: string;
  };
  statusHistory: OrderStatusChangeRow[];
  cancellation: {
    by: Role | null;
    reason: string | null;
    at: string | null;
  } | null;
  proof: { otpVerifiedAt: string | null; photoUrl: string | null };
}

export interface PartialFulfilmentResult {
  order: OrderDetail;
  /** INTEGER PAISE owed back to the customer. */
  refundDelta: number;
  /** INTEGER PAISE the vendor will no longer be paid. */
  payoutDelta: number;
  droppedLineCount: number;
  ledgerEntryId: string | null;
}

interface OrderAggregateRow {
  _id: Types.ObjectId;
  orderNo: string;
  status: OrderStatus;
  items: {
    productId: Types.ObjectId;
    name: string;
    image?: string | null;
    unit: string;
    price: number;
    qty: number;
    lineTotal: number;
    fulfilled: boolean;
  }[];
  pricing: OrderPricingSnapshot;
  address: {
    label?: string | null;
    line1: string;
    line2?: string | null;
    city: string;
    pincode: string;
    location?: { coordinates?: number[] } | null;
    phone: string;
  };
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    refundedAmount?: number;
  };
  statusHistory?: {
    from?: OrderStatus | null;
    to: OrderStatus;
    byUserId?: Types.ObjectId | null;
    byRole?: Role | null;
    reason?: string | null;
    at: Date;
  }[];
  cancellation?: {
    by?: Role | null;
    reason?: string | null;
    at?: Date | null;
  } | null;
  proof?: { otpVerifiedAt?: Date | null; photoUrl?: string | null } | null;
  placedAt?: Date;
  acceptedAt?: Date | null;
  readyAt?: Date | null;
  pickedUpAt?: Date | null;
  deliveredAt?: Date | null;
  customer?: { _id?: Types.ObjectId; name?: string; phone?: string };
  partner?: { _id?: Types.ObjectId; userId?: Types.ObjectId };
  partnerUser?: { name?: string; phone?: string };
}

/** Statuses in which the vendor still holds the goods and may re-pick. */
const FULFILMENT_EDITABLE: readonly OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.PACKING,
];

/** Payment states in which money has actually been captured. */
const CAPTURED: readonly PaymentStatus[] = [
  PaymentStatus.AUTHORIZED,
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
];

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE ORDER BOARD
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── The state machine is the only authority ─────────────────────────────
 * Every write goes through `assertTransition`, which consults BOTH
 * `canTransition` (is this edge on the graph?) and `ALLOWED_ACTOR` (may a
 * vendor drive it?). No status check is hand-rolled anywhere in this
 * file: a second copy of the rules is a second copy that drifts, and the
 * one that drifts is always the one guarding money.
 *
 * ── Every transition is written with its history row ────────────────────
 * `status` and the matching `statusHistory` entry are saved together. An
 * order whose status moved without a history row is an order whose audit
 * trail has a hole exactly where the dispute is.
 */
@Injectable()
export class VendorOrdersService {
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'placedAt',
    'deliveredAt',
    'orderNo',
    'status',
  ]);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(LedgerEntry.name)
    private readonly ledger: Model<LedgerEntryDocument>,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════════
  //  Read
  // ══════════════════════════════════════════════════════════════════

  async list(
    vendorScope: string,
    query: ListOrdersQueryDto,
  ): Promise<Paginated<OrderRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<OrderDocument> = {
      vendorId: scopeId(vendorScope),
    };
    if (query.status) filter.status = query.status;

    if (query.from || query.to) {
      const range = resolveRange(query);
      filter.placedAt = { $gte: range.from, $lte: range.to };
    }

    if (query.q) {
      const needle = escapeRegex(query.q);
      filter.$or = [
        { orderNo: { $regex: needle, $options: 'i' } },
        { 'address.phone': { $regex: needle, $options: 'i' } },
        { 'items.name': { $regex: needle, $options: 'i' } },
      ];
    }

    const [result] = await this.orders
      .aggregate<{ rows: OrderAggregateRow[]; total: { count: number }[] }>([
        { $match: filter },
        ...LOOKUP_PARTIES,
        {
          $facet: {
            rows: [
              { $sort: this.resolveSort(query.sort) },
              { $skip: (page - 1) * limit },
              { $limit: limit },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    return paginate(
      (result?.rows ?? []).map(toOrderRow),
      result?.total?.[0]?.count ?? 0,
      page,
      limit,
    );
  }

  async findOne(vendorScope: string, id: string): Promise<OrderDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Order not found');
    }

    const [row] = await this.orders
      .aggregate<OrderAggregateRow>([
        {
          // BOTH clauses. `_id` alone reads another vendor's order.
          $match: {
            _id: new Types.ObjectId(id),
            vendorId: scopeId(vendorScope),
          },
        },
        ...LOOKUP_PARTIES,
      ])
      .exec();

    if (!row) throw new NotFoundException('Order not found');
    return toOrderDetail(row);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Accept / reject
  // ══════════════════════════════════════════════════════════════════

  async accept(
    vendorScope: string,
    id: string,
    dto: AcceptOrderDto,
    actor: JwtUser,
  ): Promise<OrderDetail> {
    const order = await this.mustFindOwn(vendorScope, id);
    this.assertTransition(order.status, OrderStatus.ACCEPTED);

    const now = new Date();
    const from = order.status;

    order.status = OrderStatus.ACCEPTED;
    order.acceptedAt = now;
    order.statusHistory.push({
      from,
      to: OrderStatus.ACCEPTED,
      byUserId: toObjectIdOrNull(actor.sub),
      byRole: actor.role,
      // The Order schema has no `etaMinutes` field and this module does
      // not own the schema, so the promise is recorded where it is
      // already auditable rather than bolted onto the document.
      reason:
        dto.etaMinutes === undefined ? null : `ETA ${dto.etaMinutes} minutes`,
      at: now,
    });
    await order.save();

    await this.audit.record({
      action: 'vendor.order.accept',
      entity: 'Order',
      entityId: id,
      before: { status: from },
      after: { status: OrderStatus.ACCEPTED, etaMinutes: dto.etaMinutes ?? null },
      actor,
    });

    return this.findOne(vendorScope, id);
  }

  async reject(
    vendorScope: string,
    id: string,
    dto: RejectOrderDto,
    actor: JwtUser,
  ): Promise<OrderDetail> {
    const order = await this.mustFindOwn(vendorScope, id);
    this.assertTransition(order.status, OrderStatus.REJECTED);

    const now = new Date();
    const from = order.status;

    order.status = OrderStatus.REJECTED;
    order.statusHistory.push({
      from,
      to: OrderStatus.REJECTED,
      byUserId: toObjectIdOrNull(actor.sub),
      byRole: actor.role,
      reason: dto.reason,
      at: now,
    });
    order.cancellation = {
      by: actor.role,
      byUserId: toObjectIdOrNull(actor.sub),
      reason: dto.reason,
      at: now,
    };
    await order.save();

    await this.audit.record({
      action: 'vendor.order.reject',
      entity: 'Order',
      entityId: id,
      before: { status: from },
      after: { status: OrderStatus.REJECTED, reason: dto.reason },
      actor,
    });

    return this.findOne(vendorScope, id);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Generic transition
  // ══════════════════════════════════════════════════════════════════

  async changeStatus(
    vendorScope: string,
    id: string,
    dto: UpdateOrderStatusDto,
    actor: JwtUser,
  ): Promise<OrderDetail> {
    // Two transitions have their own endpoints because they carry
    // required payload the state machine cannot express: REJECTED needs
    // a reason, ASSIGNED needs a rider. Routing them through here would
    // produce a rejected order with no reason and an assigned order with
    // no partner.
    if (dto.status === OrderStatus.REJECTED) {
      throw new BadRequestException(
        'Use PATCH /vendor/orders/:id/reject — a rejection requires a reason',
      );
    }
    if (dto.status === OrderStatus.ASSIGNED) {
      throw new BadRequestException(
        'Use POST /vendor/orders/:id/assign — an assignment requires a partner',
      );
    }
    if (dto.status === OrderStatus.CANCELLED && !dto.reason) {
      throw new BadRequestException('reason is required to cancel an order');
    }

    const order = await this.mustFindOwn(vendorScope, id);
    this.assertTransition(order.status, dto.status);

    const now = new Date();
    const from = order.status;

    order.status = dto.status;
    if (dto.status === OrderStatus.READY_FOR_PICKUP) order.readyAt = now;
    if (dto.status === OrderStatus.CANCELLED) {
      order.cancellation = {
        by: actor.role,
        byUserId: toObjectIdOrNull(actor.sub),
        reason: dto.reason ?? null,
        at: now,
      };
    }

    order.statusHistory.push({
      from,
      to: dto.status,
      byUserId: toObjectIdOrNull(actor.sub),
      byRole: actor.role,
      reason: dto.reason ?? null,
      at: now,
    });
    await order.save();

    await this.audit.record({
      action: 'vendor.order.status',
      entity: 'Order',
      entityId: id,
      before: { status: from },
      after: { status: dto.status, reason: dto.reason ?? null },
      actor,
    });

    return this.findOne(vendorScope, id);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Partial fulfilment
  // ══════════════════════════════════════════════════════════════════

  /**
   * Decision #9: drop the lines that are not on the shelf, re-price, and
   * record the refund.
   *
   * Allowed only while the vendor still holds the goods (ACCEPTED or
   * PACKING). Once the order is READY_FOR_PICKUP the bag is packed and a
   * silent re-price would change what the rider is carrying.
   *
   * Stock is deliberately NOT returned for a dropped line: the line was
   * dropped precisely because the item was not there, so `$inc`-ing it
   * back would re-create the phantom quantity that caused the problem.
   *
   * The re-price and the `LedgerEntry` are written in ONE transaction. A
   * re-priced order with no ledger row is a refund nobody can account
   * for; a ledger row with no re-price is a refund against full pricing.
   */
  async updateFulfilment(
    vendorScope: string,
    id: string,
    dto: UpdateOrderItemsDto,
    actor: JwtUser,
  ): Promise<PartialFulfilmentResult> {
    const order = await this.mustFindOwn(vendorScope, id);

    if (!FULFILMENT_EDITABLE.includes(order.status)) {
      throw new ConflictException(
        `An order in status ${order.status} can no longer be re-picked. ` +
          `Partial fulfilment is allowed in: ${FULFILMENT_EDITABLE.join(', ')}.`,
      );
    }

    const wanted = new Map(
      dto.items.map((item) => [item.productId, item.fulfilled]),
    );

    const known = new Set(
      order.items.map((item) => item.productId.toString()),
    );
    for (const productId of wanted.keys()) {
      if (!known.has(productId)) {
        throw new BadRequestException(
          `Product ${productId} is not on this order`,
        );
      }
    }

    // Picked field by field, never spread: `order.pricing` is a Mongoose
    // subdocument, and spreading one copies `_doc`, `$__` and friends
    // instead of the eight numbers.
    const before = pricingSnapshot(order.pricing);
    const beforeItems = order.items.map((item) => ({
      productId: item.productId.toString(),
      fulfilled: item.fulfilled,
    }));

    for (const item of order.items) {
      const next = wanted.get(item.productId.toString());
      if (next !== undefined) item.fulfilled = next;
    }

    if (!order.items.some((item) => item.fulfilled)) {
      throw new BadRequestException(
        'At least one line must remain fulfilled. An order with nothing in ' +
          'it is a rejection — use PATCH /vendor/orders/:id/reject, which ' +
          'records a reason and refunds in full.',
      );
    }

    const repriced = repriceForFulfilment(before, order.items);

    if (repriced.refundDelta === 0 && repriced.droppedLineCount === 0) {
      // Nothing changed. Returning early keeps the ledger free of
      // zero-value rows, which is what makes it readable.
      return {
        order: await this.findOne(vendorScope, id),
        refundDelta: 0,
        payoutDelta: 0,
        droppedLineCount: 0,
        ledgerEntryId: null,
      };
    }

    const now = new Date();
    let ledgerEntryId: Types.ObjectId | null = null;

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        order.pricing = { ...repriced.pricing };

        if (
          repriced.refundDelta > 0 &&
          order.payment.method === PaymentMethod.ONLINE &&
          CAPTURED.includes(order.payment.status)
        ) {
          // Money was actually captured, so it must actually come back.
          // A COD order has taken nothing yet — the rider simply collects
          // the lower total, and inventing a refund there would credit
          // the customer money they never paid.
          order.payment.refundedAmount =
            (order.payment.refundedAmount ?? 0) + repriced.refundDelta;
          order.payment.status =
            order.payment.refundedAmount >= before.grandTotal
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED;
        }

        order.statusHistory.push({
          from: order.status,
          to: order.status,
          byUserId: toObjectIdOrNull(actor.sub),
          byRole: actor.role,
          reason:
            dto.reason ??
            `Partial fulfilment: ${repriced.droppedLineCount} line(s) dropped`,
          at: now,
        });

        await order.save({ session });

        const [entry] = await this.ledger.create(
          [
            {
              vendorId: scopeId(vendorScope),
              orderId: order._id,
              type: LedgerEntryType.REFUND,
              // Signed from the vendor's point of view: a refund leaves
              // their balance (§5.1).
              amount: -repriced.refundDelta,
              note:
                `Partial fulfilment ${order.orderNo}: ` +
                `${repriced.droppedLineCount} line(s) dropped`,
              settlementId: null,
              at: now,
            },
          ],
          { session },
        );
        ledgerEntryId = entry._id;
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'vendor.order.fulfilment',
      entity: 'Order',
      entityId: id,
      before: { pricing: before, items: beforeItems },
      after: {
        pricing: repriced.pricing,
        refundDelta: repriced.refundDelta,
        payoutDelta: repriced.payoutDelta,
        droppedLineCount: repriced.droppedLineCount,
        reason: dto.reason ?? null,
      },
      actor,
    });

    return {
      order: await this.findOne(vendorScope, id),
      refundDelta: repriced.refundDelta,
      payoutDelta: repriced.payoutDelta,
      droppedLineCount: repriced.droppedLineCount,
      ledgerEntryId: ledgerEntryId ? String(ledgerEntryId) : null,
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  Assignment
  // ══════════════════════════════════════════════════════════════════

  /**
   * Hand the order to one of the store's own riders.
   *
   * Three things move together or not at all: the order's status, its
   * `deliveryPartnerId`, and the rider's `activeOrderId` / availability.
   * Outside a transaction, a crash between them leaves either a rider
   * holding an order that does not know about them, or an assigned order
   * whose rider is still being offered other work.
   */
  async assign(
    vendorScope: string,
    id: string,
    dto: AssignPartnerDto,
    actor: JwtUser,
  ): Promise<OrderDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Order not found');
    }

    const vendorId = scopeId(vendorScope);
    const orderId = new Types.ObjectId(id);
    const partnerId = new Types.ObjectId(dto.partnerId);
    const now = new Date();
    let from: OrderStatus = OrderStatus.READY_FOR_PICKUP;

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const order = await this.orders
          .findOne({ _id: orderId, vendorId })
          .session(session)
          .exec();
        if (!order) throw new NotFoundException('Order not found');

        this.assertTransition(order.status, OrderStatus.ASSIGNED);

        // `vendorId` in the filter: another store's rider simply does
        // not exist here, so the vendor cannot conscript them and cannot
        // learn that the id is real.
        const partner = await this.partners
          .findOne({ _id: partnerId, vendorId })
          .session(session)
          .exec();
        if (!partner) throw new NotFoundException('Delivery partner not found');

        if (partner.status !== PartnerStatus.ACTIVE) {
          throw new ConflictException(
            `Delivery partner is ${partner.status} and cannot take an order`,
          );
        }
        if (
          partner.activeOrderId &&
          !partner.activeOrderId.equals(orderId)
        ) {
          throw new ConflictException(
            'Delivery partner is already carrying another order',
          );
        }

        from = order.status;
        order.status = OrderStatus.ASSIGNED;
        order.deliveryPartnerId = partner._id;
        order.statusHistory.push({
          from,
          to: OrderStatus.ASSIGNED,
          byUserId: toObjectIdOrNull(actor.sub),
          byRole: actor.role,
          reason: null,
          at: now,
        });
        await order.save({ session });

        partner.activeOrderId = order._id;
        // Held, not merely busy: the assignment engine must stop
        // offering this rider work the moment the order is theirs.
        partner.isAvailable = false;
        await partner.save({ session });
      });
    } finally {
      await session.endSession();
    }

    await this.audit.record({
      action: 'vendor.order.assign',
      entity: 'Order',
      entityId: id,
      before: { status: from, deliveryPartnerId: null },
      after: { status: OrderStatus.ASSIGNED, deliveryPartnerId: dto.partnerId },
      actor,
    });

    return this.findOne(vendorScope, id);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════════════════════════════

  /**
   * The ONE place a status change is validated.
   *
   * Both halves matter. `canTransition` answers "is this edge on the
   * graph"; `ALLOWED_ACTOR` answers "may a vendor drive it". Without the
   * second, a vendor could mark their own order DELIVERED and collect a
   * payout for goods still sitting on the shelf.
   */
  private assertTransition(from: OrderStatus, to: OrderStatus): void {
    if (!canTransition(from, to)) {
      throw new ConflictException(
        `An order in status ${from} cannot move to ${to}`,
      );
    }

    const actors = ALLOWED_ACTOR[`${from}→${to}`];
    if (actors && !actors.includes(Role.VENDOR)) {
      throw new ConflictException(
        `${from} to ${to} is not a vendor action — it belongs to: ${actors.join(', ')}`,
      );
    }
  }

  private async mustFindOwn(
    vendorScope: string,
    id: string,
  ): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Order not found');
    }

    const order = await this.orders
      .findOne({ _id: new Types.ObjectId(id), vendorId: scopeId(vendorScope) })
      .exec();

    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private resolveSort(sort?: string): Record<string, 1 | -1> {
    const raw = sort ?? '-placedAt';
    const descending = raw.startsWith('-');
    const field = descending ? raw.slice(1) : raw;

    if (!VendorOrdersService.SORTABLE.has(field)) return { placedAt: -1 };
    return { [field]: descending ? -1 : 1 };
  }
}

/**
 * Customer and rider names, joined with EXPLICIT projections.
 *
 * `$lookup` ignores the schema's `select: false`, so without the inner
 * `$project` the customer's `passwordHash` and refresh-token material
 * would ride along in every order row the vendor loads.
 */
const LOOKUP_PARTIES: PipelineStage[] = [
  {
    $lookup: {
      from: 'users',
      localField: 'customerId',
      foreignField: '_id',
      pipeline: [{ $project: { name: 1, phone: 1 } }],
      as: 'customer',
    },
  },
  { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: 'delivery_partners',
      localField: 'deliveryPartnerId',
      foreignField: '_id',
      pipeline: [{ $project: { userId: 1 } }],
      as: 'partner',
    },
  },
  { $unwind: { path: '$partner', preserveNullAndEmptyArrays: true } },
  {
    $lookup: {
      from: 'users',
      localField: 'partner.userId',
      foreignField: '_id',
      pipeline: [{ $project: { name: 1, phone: 1 } }],
      as: 'partnerUser',
    },
  },
  { $unwind: { path: '$partnerUser', preserveNullAndEmptyArrays: true } },
  // The OTP hash is `select: false` on the schema, which an aggregation
  // does not honour. Dropping it explicitly is the second barrier.
  { $project: { deliveryOtpHash: 0 } },
];

/** The eight money fields, detached from any Mongoose machinery. */
function pricingSnapshot(pricing: OrderPricingSnapshot): OrderPricingSnapshot {
  return {
    itemsSubtotal: pricing.itemsSubtotal,
    discount: pricing.discount,
    deliveryFee: pricing.deliveryFee,
    taxes: pricing.taxes,
    grandTotal: pricing.grandTotal,
    commissionPct: pricing.commissionPct,
    commissionAmount: pricing.commissionAmount,
    vendorPayout: pricing.vendorPayout,
  };
}

function toOrderRow(row: OrderAggregateRow): OrderRow {
  return {
    id: row._id.toString(),
    orderNo: row.orderNo,
    status: row.status,
    itemCount: row.items?.length ?? 0,
    itemsSubtotal: row.pricing?.itemsSubtotal ?? 0,
    grandTotal: row.pricing?.grandTotal ?? 0,
    commissionAmount: row.pricing?.commissionAmount ?? 0,
    vendorPayout: row.pricing?.vendorPayout ?? 0,
    payment: {
      method: row.payment.method,
      status: row.payment.status,
      refundedAmount: row.payment.refundedAmount ?? 0,
    },
    customer: {
      id: row.customer?._id ? row.customer._id.toString() : null,
      name: row.customer?.name ?? null,
      phone: row.customer?.phone ?? null,
    },
    deliveryPartner: row.partner?._id
      ? {
          id: row.partner._id.toString(),
          name: row.partnerUser?.name ?? null,
          phone: row.partnerUser?.phone ?? null,
        }
      : null,
    placedAt: iso(row.placedAt),
    acceptedAt: iso(row.acceptedAt),
    readyAt: iso(row.readyAt),
    pickedUpAt: iso(row.pickedUpAt),
    deliveredAt: iso(row.deliveredAt),
  };
}

function toOrderDetail(row: OrderAggregateRow): OrderDetail {
  const coordinates = row.address?.location?.coordinates;
  const location =
    Array.isArray(coordinates) && coordinates.length === 2
      ? { lat: coordinates[1], lng: coordinates[0] }
      : null;

  return {
    ...toOrderRow(row),
    items: (row.items ?? []).map((item) => ({
      productId: item.productId.toString(),
      name: item.name,
      image: item.image ?? null,
      unit: item.unit,
      price: item.price,
      qty: item.qty,
      lineTotal: item.lineTotal,
      fulfilled: item.fulfilled,
    })),
    pricing: {
      ...row.pricing,
      customerTotal: row.pricing?.grandTotal ?? 0,
    },
    address: {
      label: row.address?.label ?? null,
      line1: row.address?.line1 ?? '',
      line2: row.address?.line2 ?? null,
      city: row.address?.city ?? '',
      pincode: row.address?.pincode ?? '',
      location,
      phone: row.address?.phone ?? '',
    },
    statusHistory: (row.statusHistory ?? []).map((change) => ({
      from: change.from ?? null,
      to: change.to,
      byUserId: change.byUserId ? change.byUserId.toString() : null,
      byRole: change.byRole ?? null,
      reason: change.reason ?? null,
      at: iso(change.at),
    })),
    cancellation: row.cancellation?.at
      ? {
          by: row.cancellation.by ?? null,
          reason: row.cancellation.reason ?? null,
          at: iso(row.cancellation.at),
        }
      : null,
    proof: {
      otpVerifiedAt: iso(row.proof?.otpVerifiedAt),
      photoUrl: row.proof?.photoUrl ?? null,
    },
  };
}
