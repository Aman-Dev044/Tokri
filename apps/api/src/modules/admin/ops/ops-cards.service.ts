import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../../../database/schemas/delivery-partner.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  Vendor,
  VendorDocument,
} from '../../../database/schemas/vendor.schema';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { Sla, buildSla, minutesBetween } from './sla.util';

/**
 * The single card shape the whole ADMIN operations console renders.
 *
 * The board, the stuck list and the dispatch monitor all return this, so
 * one component draws an order everywhere it appears and a field added
 * here appears in all three at once.
 *
 * `grandTotal` is INTEGER PAISE. Every timestamp is ISO-8601.
 */
export interface OpsOrderCard {
  id: string;
  orderNo: string;
  status: OrderStatus;
  vendorId: string;
  vendorName: string | null;
  customerName: string | null;
  itemCount: number;
  grandTotal: number;
  placedAt: string;
  /** Whole minutes since the LAST `statusHistory` entry. */
  minutesInStatus: number;
  riderId: string | null;
  riderName: string | null;
  sla: Sla;
}

/**
 * The lean projection every ops pipeline ends with.
 *
 * `itemCount` and `lastChangeAt` are computed in the database rather than
 * in Node: shipping the full `items` array and the entire `statusHistory`
 * of every live order across the wire, to take a length and a last
 * element, is a payload that grows with the busiest orders on the board.
 */
export const OPS_CARD_PROJECTION: Record<string, unknown> = {
  orderNo: 1,
  status: 1,
  vendorId: 1,
  customerId: 1,
  deliveryPartnerId: 1,
  placedAt: 1,
  readyAt: 1,
  itemCount: { $size: { $ifNull: ['$items', []] } },
  grandTotal: '$pricing.grandTotal',
  lastChangeAt: {
    $ifNull: [{ $arrayElemAt: ['$statusHistory.at', -1] }, '$placedAt'],
  },
};

/** What `OPS_CARD_PROJECTION` produces. */
export interface OpsOrderRecord {
  _id: Types.ObjectId;
  orderNo: string;
  status: OrderStatus;
  vendorId: Types.ObjectId;
  customerId: Types.ObjectId;
  deliveryPartnerId?: Types.ObjectId | null;
  placedAt: Date;
  readyAt?: Date | null;
  itemCount: number;
  grandTotal: number;
  lastChangeAt: Date;
}

/** Names resolved once per page, then shared by every card on it. */
export interface OpsNameMaps {
  vendors: Map<string, string>;
  customers: Map<string, string>;
  riders: Map<string, string>;
}

const EMPTY_NAMES: OpsNameMaps = {
  vendors: new Map(),
  customers: new Map(),
  riders: new Map(),
};

@Injectable()
export class OpsCardsService {
  constructor(
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
  ) {}

  /**
   * Resolves every display name a batch of orders needs, in four queries
   * regardless of how many orders there are.
   *
   * A `populate()` per row would issue one query per order per reference,
   * which on a fifty-card lane is a hundred and fifty round trips to
   * render one column.
   */
  async resolveNames(records: OpsOrderRecord[]): Promise<OpsNameMaps> {
    if (records.length === 0) return EMPTY_NAMES;

    const vendorIds = unique(records.map((r) => r.vendorId));
    const customerIds = unique(records.map((r) => r.customerId));
    const partnerIds = unique(
      records
        .map((r) => r.deliveryPartnerId)
        .filter((id): id is Types.ObjectId => Boolean(id)),
    );

    const [vendors, customers, partners] = await Promise.all([
      this.vendors
        .find({ _id: { $in: vendorIds } })
        .select('storeName')
        .lean<{ _id: Types.ObjectId; storeName: string }[]>()
        .exec(),
      this.users
        .find({ _id: { $in: customerIds } })
        .select('name')
        .lean<{ _id: Types.ObjectId; name: string }[]>()
        .exec(),
      partnerIds.length > 0
        ? this.partners
            .find({ _id: { $in: partnerIds } })
            .select('userId')
            .lean<{ _id: Types.ObjectId; userId: Types.ObjectId }[]>()
            .exec()
        : Promise.resolve([]),
    ]);

    const riderUsers =
      partners.length > 0
        ? await this.users
            .find({ _id: { $in: partners.map((p) => p.userId) } })
            .select('name')
            .lean<{ _id: Types.ObjectId; name: string }[]>()
            .exec()
        : [];

    const riderNameByUserId = new Map(
      riderUsers.map((u) => [u._id.toString(), u.name]),
    );

    return {
      vendors: new Map(vendors.map((v) => [v._id.toString(), v.storeName])),
      customers: new Map(customers.map((c) => [c._id.toString(), c.name])),
      riders: new Map(
        partners.map((p) => [
          p._id.toString(),
          riderNameByUserId.get(p.userId.toString()) ?? '',
        ]),
      ),
    };
  }

  toCard(
    record: OpsOrderRecord,
    names: OpsNameMaps,
    now: Date,
    slaMinutes: number,
  ): OpsOrderCard {
    const riderId = record.deliveryPartnerId
      ? record.deliveryPartnerId.toString()
      : null;
    const riderName = riderId ? (names.riders.get(riderId) ?? null) : null;

    return {
      id: record._id.toString(),
      orderNo: record.orderNo,
      status: record.status,
      vendorId: record.vendorId.toString(),
      vendorName: names.vendors.get(record.vendorId.toString()) ?? null,
      customerName: names.customers.get(record.customerId.toString()) ?? null,
      itemCount: record.itemCount ?? 0,
      grandTotal: record.grandTotal ?? 0,
      placedAt: new Date(record.placedAt).toISOString(),
      minutesInStatus: minutesBetween(
        new Date(record.lastChangeAt ?? record.placedAt),
        now,
      ),
      riderId,
      riderName: riderName === '' ? null : riderName,
      sla: buildSla(new Date(record.placedAt), now, slaMinutes),
    };
  }

  async toCards(
    records: OpsOrderRecord[],
    now: Date,
    slaMinutes: number,
  ): Promise<OpsOrderCard[]> {
    const names = await this.resolveNames(records);
    return records.map((record) => this.toCard(record, names, now, slaMinutes));
  }

  /**
   * One card by id, for the endpoints that mutate an order and must hand
   * the console back the row it just changed.
   *
   * Returns `null` rather than throwing: the caller has already proved
   * the order exists by writing to it, and a missing row here would mean
   * a concurrent delete, not a bad request.
   */
  async cardById(
    id: Types.ObjectId,
    now: Date,
    slaMinutes: number,
  ): Promise<OpsOrderCard | null> {
    const [record] = await this.orders
      .aggregate<OpsOrderRecord>([
        { $match: { _id: id } },
        { $project: OPS_CARD_PROJECTION },
      ])
      .exec();

    if (!record) return null;

    const names = await this.resolveNames([record]);
    return this.toCard(record, names, now, slaMinutes);
  }
}

function unique(ids: Types.ObjectId[]): Types.ObjectId[] {
  const seen = new Map<string, Types.ObjectId>();
  for (const id of ids) {
    if (id) seen.set(id.toString(), id);
  }
  return [...seen.values()];
}
