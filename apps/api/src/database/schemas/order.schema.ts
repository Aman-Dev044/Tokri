import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { Role } from '../../common/constants/roles.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../common/constants/order-status.enum';
import { GeoPoint, GeoPointSchema } from './geo-point';

export type OrderDocument = HydratedDocument<Order>;

@Schema({ _id: false })
export class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  /** Snapshot: the catalogue may change, the order may not. */
  @Prop({ required: true })
  name: string;

  @Prop({ type: String, default: null })
  image?: string | null;

  @Prop({ required: true })
  unit: string;

  /** INTEGER PAISE, snapshotted at checkout. */
  @Prop({ type: Number, required: true })
  price: number;

  @Prop({ type: Number, required: true })
  qty: number;

  /** price * qty, in paise. Stored so a report never re-derives it. */
  @Prop({ type: Number, required: true })
  lineTotal: number;

  /** False when the vendor partially fulfils and drops this line. */
  @Prop({ type: Boolean, default: true })
  fulfilled: boolean;
}
export const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

/**
 * Every field is INTEGER PAISE.
 *
 * `commissionPct` / `commissionAmount` / `vendorPayout` are a SNAPSHOT
 * taken from the vendor at creation time. Re-deriving the payout from the
 * vendor's current rate at settlement time would retroactively re-price
 * every order the vendor has ever fulfilled.
 */
@Schema({ _id: false })
export class OrderPricing {
  @Prop({ type: Number, required: true })
  itemsSubtotal: number;

  @Prop({ type: Number, required: true, default: 0 })
  discount: number;

  /** Platform revenue, not the vendor's. */
  @Prop({ type: Number, required: true, default: 0 })
  deliveryFee: number;

  @Prop({ type: Number, required: true, default: 0 })
  taxes: number;

  @Prop({ type: Number, required: true })
  grandTotal: number;

  @Prop({ type: Number, required: true })
  commissionPct: number;

  @Prop({ type: Number, required: true })
  commissionAmount: number;

  /** itemsSubtotal - discount - commissionAmount. */
  @Prop({ type: Number, required: true })
  vendorPayout: number;
}
export const OrderPricingSchema = SchemaFactory.createForClass(OrderPricing);

@Schema({ _id: false })
export class OrderAddress {
  @Prop({ type: String, default: null })
  label?: string | null;

  @Prop({ required: true })
  line1: string;

  @Prop({ type: String, default: null })
  line2?: string | null;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  pincode: string;

  @Prop({ type: GeoPointSchema, required: true })
  location: GeoPoint;

  @Prop({ required: true })
  phone: string;
}
export const OrderAddressSchema = SchemaFactory.createForClass(OrderAddress);

@Schema({ _id: false })
export class OrderPayment {
  @Prop({ type: String, enum: PaymentMethod, required: true })
  method: PaymentMethod;

  @Prop({
    type: String,
    enum: PaymentStatus,
    required: true,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Prop({ type: String, default: null })
  provider?: string | null;

  @Prop({ type: String, default: null })
  providerOrderId?: string | null;

  @Prop({ type: String, default: null })
  providerPaymentId?: string | null;

  @Prop({ type: Date, default: null })
  paidAt?: Date | null;

  /** INTEGER PAISE. */
  @Prop({ type: Number, default: 0 })
  refundedAmount: number;
}
export const OrderPaymentSchema = SchemaFactory.createForClass(OrderPayment);

/** One row per transition, written inside the same write as the status. */
@Schema({ _id: false })
export class OrderStatusChange {
  @Prop({ type: String, enum: OrderStatus, default: null })
  from?: OrderStatus | null;

  @Prop({ type: String, enum: OrderStatus, required: true })
  to: OrderStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  byUserId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  byRole?: Role | null;

  @Prop({ type: String, default: null })
  reason?: string | null;

  @Prop({ type: Date, required: true })
  at: Date;
}
export const OrderStatusChangeSchema =
  SchemaFactory.createForClass(OrderStatusChange);

@Schema({ _id: false })
export class OrderProof {
  @Prop({ type: Date, default: null })
  otpVerifiedAt?: Date | null;

  @Prop({ type: String, default: null })
  photoUrl?: string | null;
}
export const OrderProofSchema = SchemaFactory.createForClass(OrderProof);

@Schema({ _id: false })
export class OrderCancellation {
  @Prop({ type: String, default: null })
  by?: Role | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  byUserId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  reason?: string | null;

  @Prop({ type: Date, default: null })
  at?: Date | null;
}
export const OrderCancellationSchema =
  SchemaFactory.createForClass(OrderCancellation);

/**
 * The customer's one rating of a delivered order: the store, and the rider
 * if there was one.
 *
 * Embedded rather than its own collection because "once per order" is
 * then a property of a single document: the write that sets it filters on
 * `customerRating: null`, so two taps of Submit cannot both land.
 */
@Schema({ _id: false })
export class OrderCustomerRating {
  @Prop({ type: Number, required: true, min: 1, max: 5 })
  store: number;

  /** Null when the order had no rider, or the customer skipped them. */
  @Prop({ type: Number, default: null, min: 1, max: 5 })
  rider?: number | null;

  @Prop({ type: String, default: null })
  comment?: string | null;

  @Prop({ type: Date, required: true })
  at: Date;
}
export const OrderCustomerRatingSchema =
  SchemaFactory.createForClass(OrderCustomerRating);

@Schema({ timestamps: true, collection: 'orders' })
export class Order {
  /** Human-readable: MND-20260924-0001. Unique. */
  @Prop({ required: true, trim: true })
  orderNo: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'DeliveryPartner', default: null })
  deliveryPartnerId?: Types.ObjectId | null;

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  @Prop({ type: OrderPricingSchema, required: true })
  pricing: OrderPricing;

  @Prop({ type: OrderAddressSchema, required: true })
  address: OrderAddress;

  @Prop({ type: OrderPaymentSchema, required: true })
  payment: OrderPayment;

  @Prop({
    type: String,
    enum: OrderStatus,
    required: true,
    default: OrderStatus.PLACED,
  })
  status: OrderStatus;

  @Prop({ type: [OrderStatusChangeSchema], default: [] })
  statusHistory: OrderStatusChange[];

  /**
   * The 4-digit proof-of-delivery OTP, HASHED.
   *
   * Never stored in plain text: anyone with read access to the orders
   * collection would otherwise be able to mark deliveries complete.
   */
  @Prop({ type: String, default: null, select: false })
  deliveryOtpHash?: string | null;

  @Prop({ type: OrderProofSchema, default: () => ({}) })
  proof: OrderProof;

  @Prop({ type: OrderCancellationSchema, default: () => ({}) })
  cancellation: OrderCancellation;

  @Prop({ type: Date, required: true })
  placedAt: Date;

  @Prop({ type: Date, default: null })
  acceptedAt?: Date | null;

  @Prop({ type: Date, default: null })
  readyAt?: Date | null;

  @Prop({ type: Date, default: null })
  pickedUpAt?: Date | null;

  @Prop({ type: Date, default: null })
  deliveredAt?: Date | null;

  /** Set once, by the customer, after delivery. See `OrderCustomerRating`. */
  @Prop({ type: OrderCustomerRatingSchema, default: null })
  customerRating?: OrderCustomerRating | null;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// ── Indexes ───────────────────────────────────────────────────────────
// The analytics pipelines all filter on { status, placedAt } before they
// group. Without these an admin dashboard refresh is a collection scan of
// every order the platform has ever taken.
OrderSchema.index({ orderNo: 1 }, { unique: true });
OrderSchema.index({ vendorId: 1, status: 1, placedAt: -1 });
OrderSchema.index({ customerId: 1, placedAt: -1 });
OrderSchema.index({ deliveryPartnerId: 1, status: 1 });
OrderSchema.index({ status: 1, placedAt: -1 });
OrderSchema.index({ placedAt: -1 });
OrderSchema.index({ 'payment.providerOrderId': 1 }, { sparse: true });
OrderSchema.index({ isDemo: 1 });

/** The OTP hash must never be serialised, even if a query selects it. */
OrderSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    const out = ret as unknown as Record<string, unknown>;
    delete out.deliveryOtpHash;
    delete out.__v;
    return out;
  },
});
