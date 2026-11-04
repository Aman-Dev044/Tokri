import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model, Types } from 'mongoose';

import {
  Product,
  ProductDocument,
  ProductUnit,
} from '../../../database/schemas/product.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../../database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../../database/schemas/inventory-log.schema';
import {
  Vendor,
  VendorAddress,
  VendorDocument,
} from '../../../database/schemas/vendor.schema';
import {
  InvoiceCounter,
  InvoiceCounterDocument,
  PosPaymentMode,
  PosSale,
  PosSaleDocument,
  PosSaleItem,
  PosSaleStatus,
} from '../../../database/schemas/pos-sale.schema';
import { Role } from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../../admin/audit/audit.service';
import { GST_PCT } from '../../shop/pricing/pricing';
import { problem } from '../../shop/common/problem';
import { escapeRegex, iso, isDuplicateKeyError } from '../common/dto';
import { scopeId } from '../common/vendor-scope.decorator';
import {
  financialYear,
  formatInvoiceNo,
  istDayStart,
  priceCounterSale,
  storeCode,
  unitLabel,
} from './pos-pricing';
import {
  CreatePosSaleDto,
  ListPosSalesQueryDto,
  VoidPosSaleDto,
} from './dto';

/** One product as the counter sees it. */
export interface PosProduct {
  id: string;
  name: string;
  brand: string | null;
  sku: string;
  barcode: string | null;
  unit: ProductUnit;
  unitValue: number;
  unitLabel: string;
  /** INTEGER PAISE. */
  price: number;
  /** INTEGER PAISE. */
  mrp: number;
  /** Whole percent — the rate the sale will be taxed at. */
  gstRate: number;
  /** `inventory.stock` — what the shelf holds right now. */
  available: number;
  image: string | null;
}

export interface PosProductSearch {
  query: string;
  /** The product whose barcode equals `q` exactly — a scanner hit. */
  barcodeMatch: PosProduct | null;
  items: PosProduct[];
}

export interface PosSaleLine {
  productId: string;
  name: string;
  sku: string;
  barcode: string | null;
  unitLabel: string;
  qty: number;
  unitPrice: number;
  mrp: number;
  gstRate: number;
  gst: number;
  lineTotal: number;
}

/** The invoice. Every amount INTEGER PAISE. */
export interface PosSaleDetail {
  id: string;
  invoiceNo: string;
  financialYear: string;
  status: PosSaleStatus;
  createdAt: string | null;
  store: {
    id: string;
    name: string;
    address: {
      line1: string;
      line2: string | null;
      city: string;
      state: string;
      pincode: string;
    };
  };
  cashier: { id: string; name: string; role: Role };
  items: PosSaleLine[];
  subtotal: number;
  discount: number;
  taxableValue: number;
  taxes: number;
  grandTotal: number;
  paymentMode: PosPaymentMode;
  cashTendered: number | null;
  change: number | null;
  customer: { phone: string | null; name: string | null };
  void: { reason: string; at: string | null; byName: string | null } | null;
}

export interface PosSaleRow {
  id: string;
  invoiceNo: string;
  status: PosSaleStatus;
  createdAt: string | null;
  itemCount: number;
  grandTotal: number;
  paymentMode: PosPaymentMode;
  customerPhone: string | null;
  customerName: string | null;
  cashierName: string;
}

export interface PosModeTotal {
  count: number;
  /** INTEGER PAISE. */
  total: number;
}

export interface PosTodaySummary {
  /** Midnight IST, ISO-8601. Completed sales only. */
  from: string;
  count: number;
  total: number;
  byMode: Record<PosPaymentMode, PosModeTotal>;
}

export type PosSalesPage = Paginated<PosSaleRow> & { today: PosTodaySummary };

interface ProductLean {
  _id: Types.ObjectId;
  name: string;
  brand?: string | null;
  sku: string;
  barcode?: string | null;
  unit: ProductUnit;
  unitValue: number;
  price: number;
  mrp: number;
  isActive: boolean;
  images?: string[];
}

type SaleLean = PosSale & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

interface StoreLean {
  _id: Types.ObjectId;
  storeName: string;
  slug: string;
  address: VendorAddress;
}

const PRODUCT_FIELDS =
  'name brand sku barcode unit unitValue price mrp isActive images';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  COUNTER BILLING — walk-in sales at the store's own till
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── The server does the sums ────────────────────────────────────────────
 * The request names products and quantities and nothing else. Unit price,
 * MRP and the GST rate come from the product, the totals from
 * `priceCounterSale` (which is the online checkout's `computePricing`),
 * and the change from the server's own grand total. The screen shows a
 * preview; the invoice shows what this file computed.
 *
 * ── Stock: one transaction, never negative ──────────────────────────────
 * Every line is decremented with `{ stock: { $gte: qty } }` in the FILTER
 * — the same atomic trick checkout uses — inside one transaction with the
 * invoice number and the sale itself. A short line rolls back everything,
 * including the invoice number, and the cashier gets a 409 listing every
 * short line so they can fix the basket in one pass.
 *
 * ── Not platform money ──────────────────────────────────────────────────
 * No commission, no ledger entry, no settlement. Nothing here touches
 * `ledger_entries`.
 */
@Injectable()
export class VendorPosService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(InventoryLog.name)
    private readonly inventoryLogs: Model<InventoryLogDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(PosSale.name) private readonly sales: Model<PosSaleDocument>,
    @InjectModel(InvoiceCounter.name)
    private readonly counters: Model<InvoiceCounterDocument>,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════════════════════
  //  Product lookup
  // ══════════════════════════════════════════════════════════════════

  async searchProducts(
    vendorScope: string,
    q: string,
  ): Promise<PosProductSearch> {
    const vendorId = scopeId(vendorScope);
    const term = q.trim();
    const needle = escapeRegex(term);

    const [exact, matches] = await Promise.all([
      this.products
        .findOne({ vendorId, isActive: true, barcode: term })
        .select(PRODUCT_FIELDS)
        .lean<ProductLean | null>()
        .exec(),
      this.products
        .find({
          vendorId,
          isActive: true,
          $or: [
            { name: { $regex: needle, $options: 'i' } },
            { brand: { $regex: needle, $options: 'i' } },
            { sku: { $regex: `^${needle}`, $options: 'i' } },
            { barcode: term },
          ],
        })
        .select(PRODUCT_FIELDS)
        .sort({ name: 1, _id: 1 })
        .limit(20)
        .lean<ProductLean[]>()
        .exec(),
    ]);

    const all = exact
      ? [exact, ...matches.filter((row) => !row._id.equals(exact._id))]
      : matches;
    const stock = await this.stockFor(vendorId, all.map((row) => row._id));

    const toRow = (row: ProductLean): PosProduct => ({
      id: row._id.toString(),
      name: row.name,
      brand: row.brand ?? null,
      sku: row.sku,
      barcode: row.barcode ?? null,
      unit: row.unit,
      unitValue: row.unitValue,
      unitLabel: unitLabel(row.unit, row.unitValue),
      price: row.price,
      mrp: row.mrp,
      gstRate: GST_PCT,
      available: stock.get(row._id.toString()) ?? 0,
      image: row.images?.[0] ?? null,
    });

    return {
      query: term,
      barcodeMatch: exact ? toRow(exact) : null,
      items: all.map(toRow),
    };
  }

  // ══════════════════════════════════════════════════════════════════
  //  The sale
  // ══════════════════════════════════════════════════════════════════

  async createSale(
    vendorScope: string,
    dto: CreatePosSaleDto,
    actor: JwtUser,
  ): Promise<PosSaleDetail> {
    const vendorId = scopeId(vendorScope);

    // The same product twice is one line with the sum of the quantities:
    // two separate decrements of one inventory row inside one transaction
    // would each pass the `$gte` check against the same starting stock.
    const wanted = new Map<string, number>();
    for (const line of dto.items) {
      wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.qty);
    }

    const store = await this.vendors
      .findById(vendorId)
      .select('storeName slug address')
      .lean<StoreLean | null>()
      .exec();
    if (!store) throw new NotFoundException('Store not found');

    const now = new Date();
    const fy = financialYear(now);
    const counterKey = `${vendorScope}:${fy}`;
    await this.ensureCounter(counterKey);

    const saleId = new Types.ObjectId();
    const session = await this.connection.startSession();

    try {
      await session.withTransaction(async () => {
        await this.sellInTransaction({
          session,
          vendorId,
          wanted,
          dto,
          actor,
          store,
          fy,
          counterKey,
          saleId,
          now,
        });
      });
    } finally {
      await session.endSession();
    }

    const sale = await this.mustFindLean(vendorScope, saleId.toString());

    await this.audit.record({
      action: 'vendor.pos.sale',
      entity: 'PosSale',
      entityId: saleId.toString(),
      before: null,
      after: {
        invoiceNo: sale.invoiceNo,
        grandTotal: sale.grandTotal,
        paymentMode: sale.paymentMode,
        lines: sale.items.length,
      },
      actor,
    });

    return toDetail(sale, vendorScope);
  }

  /**
   * Everything that must commit or roll back together. Called by
   * `withTransaction`, which re-runs it on a transient write conflict —
   * so it must not mutate anything outside the session.
   */
  private async sellInTransaction(input: {
    session: ClientSession;
    vendorId: Types.ObjectId;
    wanted: Map<string, number>;
    dto: CreatePosSaleDto;
    actor: JwtUser;
    store: StoreLean;
    fy: string;
    counterKey: string;
    saleId: Types.ObjectId;
    now: Date;
  }): Promise<void> {
    const { session, vendorId, wanted, dto, actor, store } = input;
    const ids = [...wanted.keys()].map((id) => new Types.ObjectId(id));

    // ── 1. The products, from THIS store, read in the session ─────────
    const products = await this.products
      .find({ _id: { $in: ids }, vendorId })
      .select(PRODUCT_FIELDS)
      .session(session)
      .lean<ProductLean[]>()
      .exec();
    const byId = new Map(products.map((row) => [row._id.toString(), row]));

    // Another store's product id is indistinguishable from a made-up
    // one: "not sold here", never a hint that it exists elsewhere.
    const unavailable = [...wanted.keys()].filter(
      (id) => !byId.get(id)?.isActive,
    );
    if (unavailable.length > 0) {
      throw new BadRequestException(
        problem(
          'PRODUCT_UNAVAILABLE',
          'Some items are not sold in this store',
          { productIds: unavailable },
        ),
      );
    }

    // ── 2. Every short line, reported at once ─────────────────────────
    const stock = await this.stockFor(vendorId, ids, session);
    const short = [...wanted.entries()]
      .filter(([id, qty]) => (stock.get(id) ?? 0) < qty)
      .map(([id, qty]) => ({
        productId: id,
        name: byId.get(id)?.name ?? '',
        requested: qty,
        available: stock.get(id) ?? 0,
      }));
    if (short.length > 0) throw insufficient(short);

    // ── 3. Decrement atomically; the filter is the guard ──────────────
    for (const [id, qty] of wanted) {
      const result = await this.inventory
        .updateOne(
          { productId: new Types.ObjectId(id), vendorId, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { session },
        )
        .exec();

      if (result.modifiedCount === 0) {
        throw insufficient([
          {
            productId: id,
            name: byId.get(id)?.name ?? '',
            requested: qty,
            available: 0,
          },
        ]);
      }
    }

    // ── 4. Price it, server-side ──────────────────────────────────────
    const ordered = [...wanted.entries()].map(([id, qty]) => {
      const product = byId.get(id) as ProductLean;
      return { product, qty };
    });
    const totals = priceCounterSale(
      ordered.map(({ product, qty }) => ({ price: product.price, qty })),
      input.dto.discountPaise ?? 0,
    );

    let cashTendered: number | null = null;
    let change: number | null = null;
    if (dto.paymentMode === PosPaymentMode.CASH) {
      if (dto.cashTenderedPaise === undefined) {
        throw new BadRequestException(
          problem('CASH_TENDERED_REQUIRED', 'Enter the cash the customer handed over'),
        );
      }
      if (dto.cashTenderedPaise < totals.grandTotal) {
        throw new BadRequestException(
          problem('CASH_SHORT', 'The cash tendered is less than the total', {
            grandTotal: totals.grandTotal,
            cashTendered: dto.cashTenderedPaise,
          }),
        );
      }
      cashTendered = dto.cashTenderedPaise;
      change = dto.cashTenderedPaise - totals.grandTotal;
    }

    const items: PosSaleItem[] = ordered.map(({ product, qty }, index) => ({
      productId: product._id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? null,
      unitLabel: unitLabel(product.unit, product.unitValue),
      qty,
      unitPrice: product.price,
      mrp: product.mrp,
      gstRate: totals.gstRate,
      gst: totals.lineGst[index] ?? 0,
      lineTotal: totals.lineTotals[index] ?? 0,
    }));

    // ── 5. The invoice number, in the same transaction ────────────────
    const counter = await this.counters
      .findOneAndUpdate(
        { key: input.counterKey },
        { $inc: { seq: 1 } },
        { new: true, session },
      )
      .lean<{ seq: number } | null>()
      .exec();
    if (!counter) {
      throw new InternalServerErrorException('Invoice counter missing');
    }

    await this.sales.create(
      [
        {
          _id: input.saleId,
          vendorId,
          invoiceNo: formatInvoiceNo(
            storeCode(store.slug, vendorId.toString()),
            input.fy,
            counter.seq,
          ),
          financialYear: input.fy,
          seq: counter.seq,
          storeName: store.storeName,
          storeAddress: store.address,
          items,
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxableValue: totals.taxableValue,
          taxes: totals.taxes,
          grandTotal: totals.grandTotal,
          paymentMode: dto.paymentMode,
          cashTendered,
          change,
          customerPhone: dto.customerPhone ?? null,
          customerName: dto.customerName?.trim() || null,
          cashierId: new Types.ObjectId(actor.sub),
          cashierName: actor.name ?? 'Store',
          cashierRole: actor.role,
          status: PosSaleStatus.COMPLETED,
        },
      ],
      { session },
    );

    // ── 6. The stock trail ────────────────────────────────────────────
    await this.inventoryLogs.insertMany(
      items.map((item) => ({
        vendorId,
        productId: item.productId,
        delta: -item.qty,
        reason: InventoryReason.POS_SALE,
        refId: input.saleId,
        byUserId: new Types.ObjectId(actor.sub),
        at: input.now,
      })),
      { session },
    );
  }

  /**
   * Creates the year's counter OUTSIDE the transaction. Two concurrent
   * first-sales-of-the-year that both upsert inside their transactions
   * collide on the unique index with a duplicate-key error, which is NOT
   * a transient error and would fail a real sale. Here the loser simply
   * finds the winner's document.
   */
  private async ensureCounter(key: string): Promise<void> {
    try {
      await this.counters
        .updateOne({ key }, { $setOnInsert: { seq: 0 } }, { upsert: true })
        .exec();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  //  History
  // ══════════════════════════════════════════════════════════════════

  async list(
    vendorScope: string,
    query: ListPosSalesQueryDto,
  ): Promise<PosSalesPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const vendorId = scopeId(vendorScope);

    const filter: FilterQuery<PosSaleDocument> = { vendorId };
    if (query.status) filter.status = query.status;
    if (query.paymentMode) filter.paymentMode = query.paymentMode;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }
    if (query.q) {
      const needle = escapeRegex(query.q);
      filter.$or = [
        { invoiceNo: { $regex: needle, $options: 'i' } },
        { customerPhone: { $regex: needle } },
        { customerName: { $regex: needle, $options: 'i' } },
      ];
    }

    const from = istDayStart(new Date());

    const [rows, total, today] = await Promise.all([
      this.sales
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<SaleLean[]>()
        .exec(),
      this.sales.countDocuments(filter).exec(),
      this.sales
        .aggregate<{ _id: PosPaymentMode; count: number; total: number }>([
          {
            $match: {
              vendorId,
              status: PosSaleStatus.COMPLETED,
              createdAt: { $gte: from },
            },
          },
          {
            $group: {
              _id: '$paymentMode',
              count: { $sum: 1 },
              total: { $sum: '$grandTotal' },
            },
          },
        ])
        .exec(),
    ]);

    const byMode: Record<PosPaymentMode, PosModeTotal> = {
      [PosPaymentMode.CASH]: { count: 0, total: 0 },
      [PosPaymentMode.UPI]: { count: 0, total: 0 },
      [PosPaymentMode.CARD]: { count: 0, total: 0 },
    };
    for (const bucket of today) {
      byMode[bucket._id] = { count: bucket.count, total: bucket.total };
    }

    return {
      ...paginate(rows.map(toRow), total, page, limit),
      today: {
        from: from.toISOString(),
        count: today.reduce((sum, bucket) => sum + bucket.count, 0),
        total: today.reduce((sum, bucket) => sum + bucket.total, 0),
        byMode,
      },
    };
  }

  async findOne(vendorScope: string, id: string): Promise<PosSaleDetail> {
    return toDetail(await this.mustFindLean(vendorScope, id), vendorScope);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Void
  // ══════════════════════════════════════════════════════════════════

  /**
   * Cancels a completed sale and puts its lines back on the shelf.
   *
   * The status flip is a conditional update — `{ status: completed }` in
   * the FILTER — inside the same transaction as the restock. Of two
   * concurrent voids exactly one matches; the other restocks nothing and
   * gets a 409. A void can therefore never return stock twice.
   */
  async voidSale(
    vendorScope: string,
    id: string,
    dto: VoidPosSaleDto,
    actor: JwtUser,
  ): Promise<PosSaleDetail> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Sale not found');
    }
    const vendorId = scopeId(vendorScope);
    const saleId = new Types.ObjectId(id);

    const session = await this.connection.startSession();
    let voided = false;

    try {
      await session.withTransaction(async () => {
        voided = false;
        const sale = await this.sales
          .findOneAndUpdate(
            { _id: saleId, vendorId, status: PosSaleStatus.COMPLETED },
            {
              $set: {
                status: PosSaleStatus.VOIDED,
                voidReason: dto.reason,
                voidedAt: new Date(),
                voidedById: new Types.ObjectId(actor.sub),
                voidedByName: actor.name ?? 'Store',
              },
            },
            { new: true, session },
          )
          .lean<SaleLean | null>()
          .exec();

        if (!sale) return;
        voided = true;

        const restocked: Types.ObjectId[] = [];
        for (const item of sale.items) {
          // A product deleted since the sale has no inventory row to put
          // the units back into. That is not a failure of the void.
          const result = await this.inventory
            .updateOne(
              { productId: item.productId, vendorId },
              { $inc: { stock: item.qty } },
              { session },
            )
            .exec();
          if (result.modifiedCount > 0) restocked.push(item.productId);
        }

        const restockedSet = new Set(restocked.map(String));
        const logs = sale.items
          .filter((item) => restockedSet.has(String(item.productId)))
          .map((item) => ({
            vendorId,
            productId: item.productId,
            delta: item.qty,
            reason: InventoryReason.POS_VOID,
            refId: saleId,
            byUserId: new Types.ObjectId(actor.sub),
            at: new Date(),
          }));
        if (logs.length > 0) {
          await this.inventoryLogs.insertMany(logs, { session });
        }
      });
    } finally {
      await session.endSession();
    }

    if (!voided) {
      // Tell "already voided" apart from "not yours / not there" — the
      // former is this store's own sale, so nothing leaks.
      const existing = await this.mustFindLean(vendorScope, id);
      throw new ConflictException(
        problem(
          'SALE_NOT_VOIDABLE',
          `Invoice ${existing.invoiceNo} is already ${existing.status}`,
        ),
      );
    }

    const sale = await this.mustFindLean(vendorScope, id);

    await this.audit.record({
      action: 'vendor.pos.void',
      entity: 'PosSale',
      entityId: id,
      before: { status: PosSaleStatus.COMPLETED },
      after: {
        status: sale.status,
        invoiceNo: sale.invoiceNo,
        reason: dto.reason,
        grandTotal: sale.grandTotal,
      },
      actor,
    });

    return toDetail(sale, vendorScope);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Helpers
  // ══════════════════════════════════════════════════════════════════

  private async stockFor(
    vendorId: Types.ObjectId,
    productIds: Types.ObjectId[],
    session?: ClientSession,
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const query = this.inventory
      .find({ vendorId, productId: { $in: productIds } })
      .select('productId stock');
    if (session) query.session(session);
    const rows = await query
      .lean<{ productId: Types.ObjectId; stock: number }[]>()
      .exec();
    return new Map(rows.map((row) => [row.productId.toString(), row.stock]));
  }

  private async mustFindLean(
    vendorScope: string,
    id: string,
  ): Promise<SaleLean> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Sale not found');
    }
    const sale = await this.sales
      .findOne({ _id: new Types.ObjectId(id), vendorId: scopeId(vendorScope) })
      .lean<SaleLean | null>()
      .exec();
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }
}

function insufficient(
  lines: { productId: string; name: string; requested: number; available: number }[],
): ConflictException {
  return new ConflictException(
    problem(
      'INSUFFICIENT_STOCK',
      lines.length === 1
        ? `Only ${lines[0]?.available ?? 0} of ${lines[0]?.name ?? 'this item'} left`
        : `${lines.length} items do not have enough stock`,
      { lines },
    ),
  );
}

function toRow(sale: SaleLean): PosSaleRow {
  return {
    id: sale._id.toString(),
    invoiceNo: sale.invoiceNo,
    status: sale.status,
    createdAt: iso(sale.createdAt),
    itemCount: sale.items.reduce((sum, item) => sum + item.qty, 0),
    grandTotal: sale.grandTotal,
    paymentMode: sale.paymentMode,
    customerPhone: sale.customerPhone ?? null,
    customerName: sale.customerName ?? null,
    cashierName: sale.cashierName,
  };
}

function toDetail(sale: SaleLean, vendorScope: string): PosSaleDetail {
  return {
    id: sale._id.toString(),
    invoiceNo: sale.invoiceNo,
    financialYear: sale.financialYear,
    status: sale.status,
    createdAt: iso(sale.createdAt),
    store: {
      id: vendorScope,
      name: sale.storeName,
      address: {
        line1: sale.storeAddress.line1,
        line2: sale.storeAddress.line2 ?? null,
        city: sale.storeAddress.city,
        state: sale.storeAddress.state,
        pincode: sale.storeAddress.pincode,
      },
    },
    cashier: {
      id: sale.cashierId.toString(),
      name: sale.cashierName,
      role: sale.cashierRole,
    },
    items: sale.items.map((item) => ({
      productId: item.productId.toString(),
      name: item.name,
      sku: item.sku,
      barcode: item.barcode ?? null,
      unitLabel: item.unitLabel,
      qty: item.qty,
      unitPrice: item.unitPrice,
      mrp: item.mrp,
      gstRate: item.gstRate,
      gst: item.gst,
      lineTotal: item.lineTotal,
    })),
    subtotal: sale.subtotal,
    discount: sale.discount,
    taxableValue: sale.taxableValue,
    taxes: sale.taxes,
    grandTotal: sale.grandTotal,
    paymentMode: sale.paymentMode,
    cashTendered: sale.cashTendered ?? null,
    change: sale.change ?? null,
    customer: {
      phone: sale.customerPhone ?? null,
      name: sale.customerName ?? null,
    },
    void:
      sale.status === PosSaleStatus.VOIDED
        ? {
            reason: sale.voidReason ?? '',
            at: iso(sale.voidedAt),
            byName: sale.voidedByName ?? null,
          }
        : null,
  };
}
