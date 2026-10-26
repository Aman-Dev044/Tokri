import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
  LedgerEntryType,
} from '../../../database/schemas/ledger-entry.schema';
import {
  Vendor,
  VendorDocument,
} from '../../../database/schemas/vendor.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../../common/constants/order-status.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from '../../shop/payments/payment-provider';
import { problem } from '../../shop/common/problem';
import { AuditService } from '../audit/audit.service';
import { escapeRegex, inclusiveTo } from '../common/dto';
import { ListPaymentsQueryDto, RefundPaymentDto } from './dto';

/**
 * One payment, as the transactions table reads it.
 *
 * There is no `payments` collection: the payment record is `Order.payment`,
 * and this row is that sub-document flattened onto its order. `id` IS the
 * order id — it is what `POST /admin/payments/:id/refund` takes.
 */
export interface PaymentRow {
  id: string;
  orderId: string;
  orderNo: string;
  /** null when the account no longer exists — never a made-up name. */
  customerName: string | null;
  vendorName: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  /** INTEGER PAISE — `pricing.grandTotal`, the order's current total. */
  amountPaise: number;
  /** INTEGER PAISE — `payment.refundedAmount`. */
  refundedPaise: number;
  /** `'razorpay'` for online, `'cod'` for cash; null if never recorded. */
  provider: string | null;
  /** `providerPaymentId` — null for COD, which has no gateway leg at all. */
  gatewayRef: string | null;
  /** `placedAt`, the instant the payment was initiated at checkout. */
  at: string;
}

interface OrderPaymentRecord {
  _id: Types.ObjectId;
  orderNo: string;
  customerId: Types.ObjectId;
  vendorId: Types.ObjectId;
  pricing: { grandTotal: number };
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    provider?: string | null;
    providerPaymentId?: string | null;
    refundedAmount?: number;
  };
  placedAt: Date;
}

const ROW_FIELDS = 'orderNo customerId vendorId pricing.grandTotal payment placedAt';

/**
 * Money that has actually been collected. AUTHORIZED is excluded on
 * purpose: checkout auto-captures, so an authorized payment is one still
 * in flight, and refunding money that has not landed is refunding nothing.
 */
const REFUNDABLE: readonly PaymentStatus[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
];

/**
 * How many customers / vendors a name search may expand into. A search
 * for "a" would otherwise turn into an `$in` of every account on the
 * platform.
 */
const NAME_MATCH_CAP = 200;

@Injectable()
export class AdminPaymentsService {
  private readonly logger = new Logger(AdminPaymentsService.name);

  /** Public sort key → stored field. Nothing else reaches `.sort()`. */
  private static readonly SORTABLE: Readonly<Record<string, string>> = {
    at: 'placedAt',
    placedAt: 'placedAt',
    amount: 'pricing.grandTotal',
    orderNo: 'orderNo',
  };

  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(LedgerEntry.name)
    private readonly ledger: Model<LedgerEntryDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly audit: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  //  Reads
  // ────────────────────────────────────────────────────────────────────

  /**
   * Every order's payment leg, newest first.
   *
   * `q` matches the order number, the gateway payment id, the customer's
   * name or the store's name — the same four fields the page searches on
   * its fixture path, so a search means the same thing either way.
   */
  async list(query: ListPaymentsQueryDto): Promise<Paginated<PaymentRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<OrderDocument> = {};
    if (query.method) filter['payment.method'] = query.method;
    if (query.status) filter['payment.status'] = query.status;

    if (query.from || query.to) {
      const placedAt: Record<string, Date> = {};
      if (query.from) placedAt.$gte = new Date(query.from);
      if (query.to) placedAt.$lte = inclusiveTo(query.to);
      filter.placedAt = placedAt;
    }

    if (query.q) {
      const term = { $regex: escapeRegex(query.q), $options: 'i' };
      const [customers, vendors] = await Promise.all([
        this.users
          .find({ name: term })
          .select('_id')
          .limit(NAME_MATCH_CAP)
          .lean<{ _id: Types.ObjectId }[]>()
          .exec(),
        this.vendors
          .find({ storeName: term })
          .select('_id')
          .limit(NAME_MATCH_CAP)
          .lean<{ _id: Types.ObjectId }[]>()
          .exec(),
      ]);

      filter.$or = [
        { orderNo: term },
        { 'payment.providerPaymentId': term },
        { customerId: { $in: customers.map((row) => row._id) } },
        { vendorId: { $in: vendors.map((row) => row._id) } },
      ];
    }

    const sort = this.resolveSort(query.sort);

    const [docs, total] = await Promise.all([
      this.orders
        .find(filter)
        .select(ROW_FIELDS)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<OrderPaymentRecord[]>()
        .exec(),
      this.orders.countDocuments(filter).exec(),
    ]);

    const names = await this.resolveNames(docs);
    return paginate(
      docs.map((doc) => toPaymentRow(doc, names)),
      total,
      page,
      limit,
    );
  }

  async findRow(id: string): Promise<PaymentRow> {
    const order = await this.mustFind(id);
    const names = await this.resolveNames([order]);
    return toPaymentRow(order, names);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Refund
  // ────────────────────────────────────────────────────────────────────

  /**
   * Returns `amountPaise` of a collected payment to the customer.
   *
   * ── ONLINE ──────────────────────────────────────────────────────────
   * The gateway must accept the refund before anything is recorded. With
   * no Razorpay keys on the deployment that is impossible, so the answer
   * is the same clean 503 `PAYMENT_PROVIDER_NOT_CONFIGURED` checkout and
   * wallet top-up give — before a single write, and never a pretend
   * success.
   *
   * ── CASH ON DELIVERY ────────────────────────────────────────────────
   * There is no gateway leg to reverse: the rider collected cash. The
   * refund is recorded — payment fields, a `refund` ledger row against
   * the vendor, an audit entry — and the cash itself is handed back out
   * of band, which is what the console's confirm dialog tells the admin.
   *
   * ── Why claim first ─────────────────────────────────────────────────
   * The order is updated with a compare-and-set on the refunded amount
   * the request READ. Two concurrent refunds of the same remainder both
   * read the same value, only one of them can match it, and the loser is
   * a 409 before it reaches the gateway. If the gateway then refuses, the
   * claim is put back, so a refused refund leaves no trace on the order.
   */
  async refund(
    id: string,
    dto: RefundPaymentDto,
    actor: JwtUser,
  ): Promise<PaymentRow> {
    const order = await this.mustFind(id);
    const { payment } = order;

    if (!REFUNDABLE.includes(payment.status)) {
      throw new ConflictException(
        problem(
          'PAYMENT_NOT_REFUNDABLE',
          `A ${payment.status} payment cannot be refunded. Only money that ` +
            'has actually been collected can be given back.',
          { status: payment.status },
        ),
      );
    }

    const refunded = payment.refundedAmount ?? 0;
    const grandTotal = order.pricing.grandTotal;
    const remaining = grandTotal - refunded;

    if (dto.amountPaise > remaining) {
      throw new BadRequestException(
        problem(
          'REFUND_EXCEEDS_REMAINING',
          `At most ${remaining} paise can still be refunded on ${order.orderNo}.`,
          { remainingPaise: remaining },
        ),
      );
    }

    const online = payment.method === PaymentMethod.ONLINE;

    if (online) {
      if (!this.provider.isConfigured()) {
        throw new ServiceUnavailableException(
          problem(
            'PAYMENT_PROVIDER_NOT_CONFIGURED',
            'Online refunds are not available yet — the payment provider is ' +
              'not configured on this deployment. No money moved.',
            { provider: this.provider.name },
          ),
        );
      }
      if (!payment.providerPaymentId) {
        throw new ConflictException(
          problem(
            'PAYMENT_HAS_NO_GATEWAY_REF',
            `${order.orderNo} has no captured gateway payment to refund against.`,
          ),
        );
      }
    }

    const nextRefunded = refunded + dto.amountPaise;
    const nextStatus =
      nextRefunded >= grandTotal
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;

    const claim = await this.orders
      .updateOne(
        {
          _id: order._id,
          'payment.status': payment.status,
          'payment.refundedAmount': refunded,
        },
        {
          $set: {
            'payment.refundedAmount': nextRefunded,
            'payment.status': nextStatus,
          },
        },
      )
      .exec();

    if (claim.modifiedCount !== 1) {
      throw new ConflictException(
        problem(
          'REFUND_CONFLICT',
          'This payment changed while the refund was being made. Reload and ' +
            'try again — no money moved.',
        ),
      );
    }

    let gatewayRefundId: string | null = null;
    if (online && payment.providerPaymentId) {
      try {
        const accepted = await this.provider.refundPayment({
          providerPaymentId: payment.providerPaymentId,
          amount: dto.amountPaise,
          notes: { orderNo: order.orderNo, reason: dto.reason },
        });
        gatewayRefundId = accepted.providerRefundId;
      } catch (error) {
        // The gateway did not take it, so neither does the order.
        await this.orders
          .updateOne(
            {
              _id: order._id,
              'payment.status': nextStatus,
              'payment.refundedAmount': nextRefunded,
            },
            {
              $set: {
                'payment.refundedAmount': refunded,
                'payment.status': payment.status,
              },
            },
          )
          .exec();
        throw error;
      }
    }

    const now = new Date();
    await this.ledger.create({
      vendorId: order.vendorId,
      orderId: order._id,
      type: LedgerEntryType.REFUND,
      // Signed, INTEGER PAISE. Negative: money leaving the platform.
      amount: -dto.amountPaise,
      note:
        gatewayRefundId !== null
          ? `Refund ${order.orderNo} via ${this.provider.name} ${gatewayRefundId}: ${dto.reason}`
          : `Refund ${order.orderNo} (cash, settled out of band): ${dto.reason}`,
      at: now,
    });

    await this.audit.record({
      action: 'payment.refund',
      entity: 'Order',
      entityId: order._id.toString(),
      before: { paymentStatus: payment.status, refundedAmount: refunded },
      after: {
        paymentStatus: nextStatus,
        refundedAmount: nextRefunded,
        amountPaise: dto.amountPaise,
        method: payment.method,
        gatewayRefundId,
        reason: dto.reason,
      },
      actor,
    });

    this.logger.log(
      `Refunded ${dto.amountPaise} paise on ${order.orderNo} (${payment.method})`,
    );

    return this.findRow(id);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────────────────────────

  private async mustFind(id: string): Promise<OrderPaymentRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Payment not found');
    }
    const order = await this.orders
      .findById(id)
      .select(ROW_FIELDS)
      .lean<OrderPaymentRecord | null>()
      .exec();
    if (!order) throw new NotFoundException('Payment not found');
    return order;
  }

  /** Two batched `$in` lookups per page, never one per row. */
  private async resolveNames(
    orders: OrderPaymentRecord[],
  ): Promise<{ vendors: Map<string, string>; customers: Map<string, string> }> {
    if (orders.length === 0) {
      return { vendors: new Map(), customers: new Map() };
    }

    const vendorIds = [...new Set(orders.map((o) => o.vendorId.toString()))];
    const customerIds = [
      ...new Set(orders.map((o) => o.customerId.toString())),
    ];

    const [vendors, customers] = await Promise.all([
      this.vendors
        .find({ _id: { $in: vendorIds.map((v) => new Types.ObjectId(v)) } })
        .select('storeName')
        .lean<{ _id: Types.ObjectId; storeName: string }[]>()
        .exec(),
      this.users
        .find({ _id: { $in: customerIds.map((c) => new Types.ObjectId(c)) } })
        .select('name')
        .lean<{ _id: Types.ObjectId; name: string }[]>()
        .exec(),
    ]);

    return {
      vendors: new Map(vendors.map((v) => [v._id.toString(), v.storeName])),
      customers: new Map(customers.map((c) => [c._id.toString(), c.name])),
    };
  }

  private resolveSort(requested: string | undefined): Record<string, 1 | -1> {
    if (!requested) return { placedAt: -1 };

    const desc = requested.startsWith('-');
    const key = desc ? requested.slice(1) : requested;
    const field = AdminPaymentsService.SORTABLE[key];

    if (!field) {
      throw new BadRequestException(
        `sort must be one of: ${Object.keys(AdminPaymentsService.SORTABLE).join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}

function toPaymentRow(
  order: OrderPaymentRecord,
  names: { vendors: Map<string, string>; customers: Map<string, string> },
): PaymentRow {
  const id = order._id.toString();
  const method = order.payment.method;
  return {
    id,
    orderId: id,
    orderNo: order.orderNo,
    customerName: names.customers.get(order.customerId.toString()) ?? null,
    vendorName: names.vendors.get(order.vendorId.toString()) ?? null,
    method,
    status: order.payment.status,
    amountPaise: order.pricing.grandTotal,
    refundedPaise: order.payment.refundedAmount ?? 0,
    // Checkout stores `provider: null` for COD; "cod" is the method, not
    // a guess, and it is what the table shows for a cash payment.
    provider:
      order.payment.provider ?? (method === PaymentMethod.COD ? 'cod' : null),
    gatewayRef: order.payment.providerPaymentId ?? null,
    at: new Date(order.placedAt).toISOString(),
  };
}
