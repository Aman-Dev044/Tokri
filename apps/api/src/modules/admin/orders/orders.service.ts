import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
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
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../../database/schemas/delivery-partner.schema';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  canTransition,
} from '../../../common/constants/order-status.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../audit/audit.service';
import { escapeRegex } from '../common/dto';
import { CancelOrderDto, ListOrdersQueryDto } from './dto';

export interface OrderPricingView {
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
  commissionPct: number;
  commissionAmount: number;
  vendorPayout: number;
}

export interface OrderRow {
  id: string;
  orderNo: string;
  status: OrderStatus;
  customerId: string;
  customerName: string | null;
  vendorId: string;
  vendorName: string | null;
  itemCount: number;
  pricing: OrderPricingView;
  payment: { method: PaymentMethod; status: PaymentStatus };
  deliveryPartnerId: string | null;
  placedAt: string;
  deliveredAt: string | null;
}

export interface OrderDetail extends OrderRow {
  items: {
    productId: string;
    name: string;
    image: string | null;
    unit: string;
    price: number;
    qty: number;
    lineTotal: number;
    fulfilled: boolean;
  }[];
  address: {
    label: string | null;
    line1: string;
    line2: string | null;
    city: string;
    pincode: string;
    phone: string;
    location: { lat: number; lng: number } | null;
  };
  paymentDetail: {
    method: PaymentMethod;
    status: PaymentStatus;
    provider: string | null;
    providerOrderId: string | null;
    providerPaymentId: string | null;
    paidAt: string | null;
    refundedAmount: number;
  };
  statusHistory: {
    from: OrderStatus | null;
    to: OrderStatus;
    byUserId: string | null;
    byRole: string | null;
    reason: string | null;
    at: string;
  }[];
  cancellation: {
    by: string | null;
    reason: string | null;
    at: string | null;
  } | null;
  proof: { otpVerifiedAt: string | null; photoUrl: string | null };
  vendor: { id: string; storeName: string; city: string | null } | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
  } | null;
  rider: {
    id: string;
    name: string | null;
    phone: string | null;
    vehicleType: string;
  } | null;
  acceptedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
}

type OrderRecord = Order & { _id: Types.ObjectId };

const iso = (date?: Date | null): string | null =>
  date ? new Date(date).toISOString() : null;

@Injectable()
export class AdminOrdersService {
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'placedAt',
    'deliveredAt',
    'orderNo',
    'status',
  ]);

  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(LedgerEntry.name)
    private readonly ledger: Model<LedgerEntryDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    private readonly audit: AuditService,
  ) {}

  // ────────────────────────────────────────────────────────────────────
  //  Reads
  // ────────────────────────────────────────────────────────────────────

  /**
   * The cross-vendor order table.
   *
   * Vendor and customer names are resolved with two batched `$in` queries
   * after the page is fetched, not with a populate per row: a 20-row page
   * costs three round trips regardless of how many distinct vendors and
   * customers appear on it.
   */
  async list(query: ListOrdersQueryDto): Promise<Paginated<OrderRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<OrderDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.vendorId) filter.vendorId = new Types.ObjectId(query.vendorId);
    if (query.customerId) {
      filter.customerId = new Types.ObjectId(query.customerId);
    }
    if (query.paymentMethod) filter['payment.method'] = query.paymentMethod;
    if (query.paymentStatus) filter['payment.status'] = query.paymentStatus;

    if (query.from || query.to) {
      const placedAt: Record<string, Date> = {};
      if (query.from) placedAt.$gte = new Date(query.from);
      if (query.to) placedAt.$lte = new Date(query.to);
      filter.placedAt = placedAt;
    }

    if (query.q) {
      filter.orderNo = { $regex: escapeRegex(query.q), $options: 'i' };
    }

    const sort = this.resolveSort(query.sort);

    const [docs, total] = await Promise.all([
      this.orders
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<OrderRecord[]>()
        .exec(),
      this.orders.countDocuments(filter).exec(),
    ]);

    const names = await this.resolveNames(docs);

    return paginate(
      docs.map((doc) => this.toRow(doc, names)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<OrderDetail> {
    const order = await this.mustFindLean(id);
    const names = await this.resolveNames([order]);

    const [vendor, customer, partner] = await Promise.all([
      this.vendors
        .findById(order.vendorId)
        .select('storeName address.city')
        .lean<{
          _id: Types.ObjectId;
          storeName: string;
          address?: { city?: string };
        } | null>()
        .exec(),
      this.users
        .findById(order.customerId)
        .select('name phone email')
        .lean<{
          _id: Types.ObjectId;
          name: string;
          phone: string;
          email?: string;
        } | null>()
        .exec(),
      order.deliveryPartnerId
        ? this.partners
            .findById(order.deliveryPartnerId)
            .select('userId vehicleType')
            .lean<{
              _id: Types.ObjectId;
              userId: Types.ObjectId;
              vehicleType: string;
            } | null>()
            .exec()
        : Promise.resolve(null),
    ]);

    const riderUser = partner
      ? await this.users
          .findById(partner.userId)
          .select('name phone')
          .lean<{ name: string; phone: string } | null>()
          .exec()
      : null;

    const coordinates = order.address?.location?.coordinates;

    return {
      ...this.toRow(order, names),
      items: (order.items ?? []).map((item) => ({
        productId: item.productId.toString(),
        name: item.name,
        image: item.image ?? null,
        unit: item.unit,
        price: item.price,
        qty: item.qty,
        lineTotal: item.lineTotal,
        fulfilled: item.fulfilled,
      })),
      address: {
        label: order.address?.label ?? null,
        line1: order.address?.line1 ?? '',
        line2: order.address?.line2 ?? null,
        city: order.address?.city ?? '',
        pincode: order.address?.pincode ?? '',
        phone: order.address?.phone ?? '',
        location:
          Array.isArray(coordinates) && coordinates.length === 2
            ? { lng: coordinates[0], lat: coordinates[1] }
            : null,
      },
      paymentDetail: {
        method: order.payment.method,
        status: order.payment.status,
        provider: order.payment.provider ?? null,
        providerOrderId: order.payment.providerOrderId ?? null,
        providerPaymentId: order.payment.providerPaymentId ?? null,
        paidAt: iso(order.payment.paidAt),
        refundedAmount: order.payment.refundedAmount ?? 0,
      },
      statusHistory: (order.statusHistory ?? []).map((change) => ({
        from: change.from ?? null,
        to: change.to,
        byUserId: change.byUserId ? change.byUserId.toString() : null,
        byRole: change.byRole ?? null,
        reason: change.reason ?? null,
        at: new Date(change.at).toISOString(),
      })),
      cancellation: order.cancellation?.at
        ? {
            by: order.cancellation.by ?? null,
            reason: order.cancellation.reason ?? null,
            at: iso(order.cancellation.at),
          }
        : null,
      proof: {
        otpVerifiedAt: iso(order.proof?.otpVerifiedAt),
        photoUrl: order.proof?.photoUrl ?? null,
      },
      vendor: vendor
        ? {
            id: vendor._id.toString(),
            storeName: vendor.storeName,
            city: vendor.address?.city ?? null,
          }
        : null,
      customer: customer
        ? {
            id: customer._id.toString(),
            name: customer.name,
            phone: customer.phone,
            email: customer.email ?? null,
          }
        : null,
      rider: partner
        ? {
            id: partner._id.toString(),
            name: riderUser?.name ?? null,
            phone: riderUser?.phone ?? null,
            vehicleType: partner.vehicleType,
          }
        : null,
      acceptedAt: iso(order.acceptedAt),
      readyAt: iso(order.readyAt),
      pickedUpAt: iso(order.pickedUpAt),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Writes
  // ────────────────────────────────────────────────────────────────────

  /**
   * Admin cancellation.
   *
   * The state machine is the authority: if `current → CANCELLED` is not on
   * the map (a delivered or already-terminal order), this is a 409, not a
   * silent no-op. An admin override that could cancel a DELIVERED order
   * would let support reverse money that has already moved.
   *
   * A PREPAID order also gets a `refund` LedgerEntry. It is written even
   * though the vendor was never credited for an undelivered order — the
   * settlement generator only sums ledger rows belonging to DELIVERED
   * orders, so this row records that money left the platform without
   * wrongly debiting the vendor's payout.
   */
  async cancel(
    id: string,
    dto: CancelOrderDto,
    actor: JwtUser,
  ): Promise<OrderDetail> {
    const order = await this.mustFind(id);

    if (!canTransition(order.status, OrderStatus.CANCELLED)) {
      throw new ConflictException(
        `An order in status ${order.status} cannot be cancelled`,
      );
    }

    const before = {
      status: order.status,
      paymentStatus: order.payment.status,
    };
    const now = new Date();
    const previousStatus = order.status;

    order.status = OrderStatus.CANCELLED;
    order.cancellation = {
      by: actor.role,
      byUserId: new Types.ObjectId(actor.sub),
      reason: dto.reason,
      at: now,
    };
    order.statusHistory.push({
      from: previousStatus,
      to: OrderStatus.CANCELLED,
      byUserId: new Types.ObjectId(actor.sub),
      byRole: actor.role,
      reason: dto.reason,
      at: now,
    });

    const wasPrepaid =
      order.payment.method === PaymentMethod.ONLINE &&
      (order.payment.status === PaymentStatus.PAID ||
        order.payment.status === PaymentStatus.AUTHORIZED);

    if (wasPrepaid) {
      order.payment.status = PaymentStatus.REFUNDED;
      order.payment.refundedAmount = order.pricing.grandTotal;
    }

    await order.save();

    if (wasPrepaid) {
      await this.ledger.create({
        vendorId: order.vendorId,
        orderId: order._id,
        type: LedgerEntryType.REFUND,
        // Signed, INTEGER PAISE. Negative: money leaving the platform.
        amount: -order.pricing.grandTotal,
        note: `Refund for cancelled order ${order.orderNo}: ${dto.reason}`,
        at: now,
      });
    }

    await this.audit.record({
      action: 'order.cancel',
      entity: 'Order',
      entityId: id,
      before,
      after: {
        status: OrderStatus.CANCELLED,
        paymentStatus: order.payment.status,
        reason: dto.reason,
        refundedAmount: order.payment.refundedAmount,
      },
      actor,
    });

    return this.findById(id);
  }

  // ────────────────────────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────────────────────────

  private async resolveNames(
    orders: OrderRecord[],
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

  private toRow(
    order: OrderRecord,
    names: { vendors: Map<string, string>; customers: Map<string, string> },
  ): OrderRow {
    const vendorId = order.vendorId.toString();
    const customerId = order.customerId.toString();

    return {
      id: order._id.toString(),
      orderNo: order.orderNo,
      status: order.status,
      customerId,
      customerName: names.customers.get(customerId) ?? null,
      vendorId,
      vendorName: names.vendors.get(vendorId) ?? null,
      itemCount: order.items?.length ?? 0,
      pricing: {
        itemsSubtotal: order.pricing.itemsSubtotal,
        discount: order.pricing.discount,
        deliveryFee: order.pricing.deliveryFee,
        taxes: order.pricing.taxes,
        grandTotal: order.pricing.grandTotal,
        commissionPct: order.pricing.commissionPct,
        commissionAmount: order.pricing.commissionAmount,
        vendorPayout: order.pricing.vendorPayout,
      },
      payment: {
        method: order.payment.method,
        status: order.payment.status,
      },
      deliveryPartnerId: order.deliveryPartnerId
        ? order.deliveryPartnerId.toString()
        : null,
      placedAt: new Date(order.placedAt).toISOString(),
      deliveredAt: iso(order.deliveredAt),
    };
  }

  private async mustFind(id: string): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Order not found');
    }
    const order = await this.orders.findById(id).exec();
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private async mustFindLean(id: string): Promise<OrderRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Order not found');
    }
    const order = await this.orders
      .findById(id)
      .lean<OrderRecord | null>()
      .exec();
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private resolveSort(requested?: string): Record<string, 1 | -1> {
    if (!requested) return { placedAt: -1 };

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!AdminOrdersService.SORTABLE.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[...AdminOrdersService.SORTABLE].join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}
