import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';

import { User, UserDocument } from '../../../database/schemas/user.schema';
import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  Address,
  AddressDocument,
} from '../../../database/schemas/address.schema';
import { Role, UserStatus } from '../../../common/constants/roles.enum';
import { FAILED_STATUSES } from '../../../common/constants/order-status.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { UsersService } from '../../users/users.service';
import { AuditService } from '../audit/audit.service';
import { escapeRegex } from '../common/dto';
import { ListCustomersQueryDto, UpdateCustomerStatusDto } from './dto';

export interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  status: UserStatus;
  orderCount: number;
  /** Lifetime, excluding cancelled and rejected. INTEGER PAISE. */
  totalSpend: number;
  lastOrderAt: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface CustomerDetail extends CustomerRow {
  addresses: {
    id: string;
    label: string;
    line1: string;
    line2: string | null;
    city: string;
    pincode: string;
    phone: string;
    isDefault: boolean;
  }[];
  /** The most recent orders, newest first, every status included. */
  orders: {
    id: string;
    orderNo: string;
    vendorName: string | null;
    status: string;
    /** Units across all lines, not the number of lines. */
    itemCount: number;
    totalPaise: number;
    placedAt: string | null;
  }[];
  lifetime: {
    /** Same population as `orderCount`: everything but cancelled/rejected. */
    ordersCount: number;
    grossPaise: number;
    avgOrderPaise: number;
    /** Every refund ever recorded against this customer's orders. */
    refundedPaise: number;
    /** Cancelled + rejected. */
    cancelledCount: number;
    firstOrderAt: string | null;
    /** Spend per calendar month (UTC) for the last six, oldest first. */
    spark: number[];
  };
}

const RECENT_ORDERS = 20;
const SPARK_MONTHS = 6;

interface CustomerAggregateRow {
  _id: Types.ObjectId;
  name: string;
  email?: string | null;
  phone: string;
  status: UserStatus;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  orderCount?: number;
  totalSpend?: number;
  lastOrderAt?: Date | null;
}

@Injectable()
export class AdminCustomersService {
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'createdAt',
    'name',
    'orderCount',
    'totalSpend',
    'lastOrderAt',
    'lastLoginAt',
  ]);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Address.name)
    private readonly addresses: Model<AddressDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The customer table with lifetime value joined in.
   *
   * `totalSpend` and `lastOrderAt` come from a grouped sub-pipeline per
   * customer. Both exclude cancelled and rejected orders: a customer who
   * placed and cancelled a Rs 4,000 order has not spent Rs 4,000, and
   * treating them as a high-value account is how support priorities get
   * pointed at the wrong person.
   */
  async list(query: ListCustomersQueryDto): Promise<Paginated<CustomerRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<UserDocument> = { role: Role.CUSTOMER };
    if (query.status) filter.status = query.status;
    if (query.q) {
      const needle = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: needle }, { email: needle }, { phone: needle }];
    }
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.$gte = new Date(query.from);
      if (query.to) createdAt.$lte = new Date(query.to);
      filter.createdAt = createdAt;
    }

    const sort = this.resolveSort(query.sort);

    const pipeline: PipelineStage[] = [
      { $match: filter },
      {
        $lookup: {
          from: 'orders',
          let: { customerId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$customerId', '$$customerId'] },
                status: { $nin: FAILED_STATUSES },
              },
            },
            {
              $group: {
                _id: null,
                orderCount: { $sum: 1 },
                totalSpend: { $sum: '$pricing.grandTotal' },
                lastOrderAt: { $max: '$placedAt' },
              },
            },
          ],
          as: 'stats',
        },
      },
      {
        $addFields: {
          orderCount: {
            $ifNull: [{ $arrayElemAt: ['$stats.orderCount', 0] }, 0],
          },
          totalSpend: {
            $ifNull: [{ $arrayElemAt: ['$stats.totalSpend', 0] }, 0],
          },
          lastOrderAt: { $arrayElemAt: ['$stats.lastOrderAt', 0] },
        },
      },
      // Explicit projection: passwordHash and the refresh-token fields are
      // `select: false` on the schema, but an aggregation pipeline ignores
      // that — `select` is a query-level feature, not a schema guarantee.
      {
        $project: {
          name: 1,
          email: 1,
          phone: 1,
          status: 1,
          lastLoginAt: 1,
          createdAt: 1,
          orderCount: 1,
          totalSpend: 1,
          lastOrderAt: 1,
        },
      },
      { $sort: sort },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ];

    const [rows, total] = await Promise.all([
      this.users.aggregate<CustomerAggregateRow>(pipeline).exec(),
      this.users.countDocuments(filter).exec(),
    ]);

    return paginate(rows.map(toRow), total, page, limit);
  }

  async findById(id: string): Promise<CustomerDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Customer not found');
    }

    const [row] = await this.users
      .aggregate<CustomerAggregateRow>([
        { $match: { _id: new Types.ObjectId(id), role: Role.CUSTOMER } },
        {
          $lookup: {
            from: 'orders',
            let: { customerId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$customerId', '$$customerId'] },
                  status: { $nin: FAILED_STATUSES },
                },
              },
              {
                $group: {
                  _id: null,
                  orderCount: { $sum: 1 },
                  totalSpend: { $sum: '$pricing.grandTotal' },
                  lastOrderAt: { $max: '$placedAt' },
                },
              },
            ],
            as: 'stats',
          },
        },
        {
          $addFields: {
            orderCount: {
              $ifNull: [{ $arrayElemAt: ['$stats.orderCount', 0] }, 0],
            },
            totalSpend: {
              $ifNull: [{ $arrayElemAt: ['$stats.totalSpend', 0] }, 0],
            },
            lastOrderAt: { $arrayElemAt: ['$stats.lastOrderAt', 0] },
          },
        },
        {
          $project: {
            name: 1,
            email: 1,
            phone: 1,
            status: 1,
            lastLoginAt: 1,
            createdAt: 1,
            orderCount: 1,
            totalSpend: 1,
            lastOrderAt: 1,
          },
        },
      ])
      .exec();

    if (!row) throw new NotFoundException('Customer not found');

    const addresses = await this.addresses
      .find({ customerId: row._id })
      .sort({ isDefault: -1 })
      .lean<
        {
          _id: Types.ObjectId;
          label: string;
          line1: string;
          line2?: string | null;
          city: string;
          pincode: string;
          phone: string;
          isDefault: boolean;
        }[]
      >()
      .exec();

    const [lifetime, orders] = await Promise.all([
      this.lifetimeFor(row._id),
      this.recentOrdersFor(row._id),
    ]);

    return {
      ...toRow(row),
      orders,
      lifetime,
      addresses: addresses.map((address) => ({
        id: address._id.toString(),
        label: address.label,
        line1: address.line1,
        line2: address.line2 ?? null,
        city: address.city,
        pincode: address.pincode,
        phone: address.phone,
        isDefault: address.isDefault,
      })),
    };
  }

  /**
   * Lifetime figures for the detail page, every one of them counted from
   * the customer's orders — the screen used to read these off a fixture,
   * and a live customer took the whole page down.
   */
  private async lifetimeFor(
    customerId: Types.ObjectId,
  ): Promise<CustomerDetail['lifetime']> {
    const now = new Date();
    const sparkFrom = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (SPARK_MONTHS - 1), 1),
    );

    const [facet] = await this.orders
      .aggregate<{
        kept: { count: number; gross: number; first: Date | null }[];
        cancelled: { count: number }[];
        refunded: { total: number }[];
        months: { _id: { y: number; m: number }; spend: number }[];
      }>([
        { $match: { customerId } },
        {
          $facet: {
            kept: [
              { $match: { status: { $nin: FAILED_STATUSES } } },
              {
                $group: {
                  _id: null,
                  count: { $sum: 1 },
                  gross: { $sum: '$pricing.grandTotal' },
                  first: { $min: '$placedAt' },
                },
              },
            ],
            cancelled: [
              { $match: { status: { $in: FAILED_STATUSES } } },
              { $count: 'count' },
            ],
            refunded: [
              {
                $group: {
                  _id: null,
                  total: { $sum: { $ifNull: ['$payment.refundedAmount', 0] } },
                },
              },
            ],
            months: [
              {
                $match: {
                  status: { $nin: FAILED_STATUSES },
                  placedAt: { $gte: sparkFrom },
                },
              },
              {
                $group: {
                  _id: { y: { $year: '$placedAt' }, m: { $month: '$placedAt' } },
                  spend: { $sum: '$pricing.grandTotal' },
                },
              },
            ],
          },
        },
      ])
      .exec();

    const kept = facet?.kept[0];
    const ordersCount = kept?.count ?? 0;
    const grossPaise = kept?.gross ?? 0;

    const byMonth = new Map(
      (facet?.months ?? []).map((m) => [`${m._id.y}-${m._id.m}`, m.spend]),
    );
    const spark = Array.from({ length: SPARK_MONTHS }, (_, i) => {
      const d = new Date(
        Date.UTC(sparkFrom.getUTCFullYear(), sparkFrom.getUTCMonth() + i, 1),
      );
      return byMonth.get(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`) ?? 0;
    });

    return {
      ordersCount,
      grossPaise,
      avgOrderPaise: ordersCount === 0 ? 0 : Math.round(grossPaise / ordersCount),
      refundedPaise: facet?.refunded[0]?.total ?? 0,
      cancelledCount: facet?.cancelled[0]?.count ?? 0,
      firstOrderAt: kept?.first ? new Date(kept.first).toISOString() : null,
      spark,
    };
  }

  private async recentOrdersFor(
    customerId: Types.ObjectId,
  ): Promise<CustomerDetail['orders']> {
    const rows = await this.orders
      .aggregate<{
        _id: Types.ObjectId;
        orderNo: string;
        status: string;
        placedAt?: Date | null;
        totalPaise?: number;
        itemCount?: number;
        vendorName?: string | null;
      }>([
        { $match: { customerId } },
        { $sort: { placedAt: -1 } },
        { $limit: RECENT_ORDERS },
        {
          $lookup: {
            from: 'vendors',
            localField: 'vendorId',
            foreignField: '_id',
            pipeline: [{ $project: { storeName: 1 } }],
            as: 'vendor',
          },
        },
        {
          $project: {
            orderNo: 1,
            status: 1,
            placedAt: 1,
            totalPaise: '$pricing.grandTotal',
            itemCount: { $sum: '$items.qty' },
            vendorName: { $arrayElemAt: ['$vendor.storeName', 0] },
          },
        },
      ])
      .exec();

    return rows.map((order) => ({
      id: order._id.toString(),
      orderNo: order.orderNo,
      vendorName: order.vendorName ?? null,
      status: order.status,
      itemCount: order.itemCount ?? 0,
      totalPaise: order.totalPaise ?? 0,
      placedAt: order.placedAt ? new Date(order.placedAt).toISOString() : null,
    }));
  }

  /**
   * Suspend or reactivate a customer.
   *
   * The actual write is delegated to `UsersService.updateStatus`, which
   * already enforces the invariants that matter — no self-modification, no
   * touching a platform account as a non-SUPER_ADMIN, no touching a seeded
   * system account, and clearing the refresh-token family so a suspension
   * takes effect on the next request rather than in fifteen minutes.
   * Reimplementing that here would be a second copy to keep correct.
   */
  async updateStatus(
    id: string,
    dto: UpdateCustomerStatusDto,
    actor: JwtUser,
  ): Promise<CustomerDetail> {
    const before = await this.findById(id);

    await this.usersService.updateStatus(
      id,
      { status: dto.status, reason: dto.reason },
      actor,
    );

    await this.audit.record({
      action: 'customer.status.update',
      entity: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: dto.status, reason: dto.reason ?? null },
      actor,
    });

    return this.findById(id);
  }

  private resolveSort(requested?: string): Record<string, 1 | -1> {
    if (!requested) return { createdAt: -1 };

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!AdminCustomersService.SORTABLE.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[
          ...AdminCustomersService.SORTABLE,
        ].join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}

function toRow(row: CustomerAggregateRow): CustomerRow {
  return {
    id: row._id.toString(),
    name: row.name,
    email: row.email ?? null,
    phone: row.phone,
    status: row.status,
    orderCount: row.orderCount ?? 0,
    totalSpend: row.totalSpend ?? 0,
    lastOrderAt: row.lastOrderAt
      ? new Date(row.lastOrderAt).toISOString()
      : null,
    lastLoginAt: row.lastLoginAt
      ? new Date(row.lastLoginAt).toISOString()
      : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
  };
}
