import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role } from '../../common/constants/roles.enum';
import { VendorAddress, VendorAddressSchema } from './vendor.schema';

export type PosSaleDocument = HydratedDocument<PosSale>;

export enum PosPaymentMode {
  CASH = 'cash',
  UPI = 'upi',
  CARD = 'card',
}

export enum PosSaleStatus {
  COMPLETED = 'completed',
  VOIDED = 'voided',
}

/**
 * One line of a counter sale, SNAPSHOTTED.
 *
 * Every figure is copied from the product at the moment of sale, so
 * repricing, renaming or deleting the product tomorrow never rewrites an
 * invoice the customer already holds. All amounts INTEGER PAISE.
 */
@Schema({ _id: false })
export class PosSaleItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  sku: string;

  @Prop({ type: String, default: null })
  barcode?: string | null;

  /** "500 g", "1 piece" — display only. */
  @Prop({ required: true })
  unitLabel: string;

  @Prop({ type: Number, required: true, min: 1 })
  qty: number;

  /** The store's selling price per unit, read from the product. */
  @Prop({ type: Number, required: true, min: 0 })
  unitPrice: number;

  @Prop({ type: Number, required: true, min: 0 })
  mrp: number;

  /** Whole percent, the rate the online checkout charges (pricing.ts). */
  @Prop({ type: Number, required: true, min: 0 })
  gstRate: number;

  /** This line's share of the invoice tax. The lines sum to `taxes`. */
  @Prop({ type: Number, required: true, min: 0 })
  gst: number;

  /** `unitPrice × qty`, before discount and tax. */
  @Prop({ type: Number, required: true, min: 0 })
  lineTotal: number;
}
export const PosSaleItemSchema = SchemaFactory.createForClass(PosSaleItem);

/**
 * A walk-in sale rung up at the store's own counter.
 *
 * ── Not an Order, and not platform revenue ──────────────────────────────
 * The customer paid the shop directly, in the shop. There is no delivery,
 * no platform commission and no settlement: nothing here is written to
 * `ledger_entries`, and nothing reads this collection into a payout. It is
 * the store's own till, kept in the same system so its stock stays true.
 *
 * ── The invoice number ──────────────────────────────────────────────────
 * `INV/<STORECODE>/<FY>/<SEQ>`, allocated from `invoice_counters` INSIDE
 * the sale's transaction — so a sale that rolls back also rolls back its
 * number and the series stays gapless, which is what a GST invoice series
 * is expected to be.
 */
@Schema({ timestamps: true, collection: 'pos_sales' })
export class PosSale {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ required: true })
  invoiceNo: string;

  /** Indian financial year, April–March: `2026-27`. */
  @Prop({ required: true })
  financialYear: string;

  @Prop({ type: Number, required: true, min: 1 })
  seq: number;

  /** Store name and address as printed on THIS invoice. */
  @Prop({ required: true })
  storeName: string;

  @Prop({ type: VendorAddressSchema, required: true })
  storeAddress: VendorAddress;

  @Prop({ type: [PosSaleItemSchema], required: true })
  items: PosSaleItem[];

  /** Σ lineTotal. INTEGER PAISE. */
  @Prop({ type: Number, required: true, min: 0 })
  subtotal: number;

  /** Capped at `subtotal`. INTEGER PAISE. */
  @Prop({ type: Number, required: true, min: 0 })
  discount: number;

  /** `subtotal − discount` — what GST is charged on. */
  @Prop({ type: Number, required: true, min: 0 })
  taxableValue: number;

  @Prop({ type: Number, required: true, min: 0 })
  taxes: number;

  @Prop({ type: Number, required: true, min: 0 })
  grandTotal: number;

  @Prop({ type: String, enum: PosPaymentMode, required: true })
  paymentMode: PosPaymentMode;

  /** Cash only. INTEGER PAISE. */
  @Prop({ type: Number, default: null })
  cashTendered?: number | null;

  /** Cash only: `cashTendered − grandTotal`. */
  @Prop({ type: Number, default: null })
  change?: number | null;

  @Prop({ type: String, default: null })
  customerPhone?: string | null;

  @Prop({ type: String, default: null })
  customerName?: string | null;

  /** Who rang it up — the owner or a staff member. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  cashierId: Types.ObjectId;

  @Prop({ required: true })
  cashierName: string;

  @Prop({ type: String, enum: Role, required: true })
  cashierRole: Role;

  @Prop({ type: String, enum: PosSaleStatus, default: PosSaleStatus.COMPLETED })
  status: PosSaleStatus;

  @Prop({ type: String, default: null })
  voidReason?: string | null;

  @Prop({ type: Date, default: null })
  voidedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  voidedById?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  voidedByName?: string | null;
}

export const PosSaleSchema = SchemaFactory.createForClass(PosSale);

PosSaleSchema.index({ vendorId: 1, invoiceNo: 1 }, { unique: true });
PosSaleSchema.index({ vendorId: 1, createdAt: -1 });
PosSaleSchema.index({ vendorId: 1, status: 1, createdAt: -1 });

/**
 * Per-store, per-financial-year invoice sequence.
 *
 * `findOneAndUpdate($inc)` is one atomic operation, so concurrent sales
 * get distinct numbers. Unlike `order_counters` it is incremented INSIDE
 * the sale transaction: the contention is per store (one counter), not
 * platform-wide, and a rolled-back sale must hand its number back.
 */
@Schema({ collection: 'invoice_counters', timestamps: true })
export class InvoiceCounter {
  /** `<vendorId>:<financialYear>`. */
  @Prop({ required: true })
  key: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}

export type InvoiceCounterDocument = HydratedDocument<InvoiceCounter>;
export const InvoiceCounterSchema = SchemaFactory.createForClass(InvoiceCounter);

InvoiceCounterSchema.index({ key: 1 }, { unique: true });
