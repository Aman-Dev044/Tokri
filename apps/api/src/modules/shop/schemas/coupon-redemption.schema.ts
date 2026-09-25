import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CouponRedemptionDocument = HydratedDocument<CouponRedemption>;

/**
 * One row per coupon actually spent on an order.
 *
 * ── Why this collection exists ──────────────────────────────────────────
 * `Coupon.usedCount` enforces the GLOBAL usage cap, but `perUserLimit`
 * needs to know who has already redeemed it. The order document carries
 * only `pricing.discount` — an amount, with no coupon attached — so there
 * is nothing on the order to count. Without this row, "one per customer"
 * is unenforceable and the first person to notice gets the discount as
 * many times as they like.
 *
 * Written INSIDE the checkout transaction, so a rolled-back checkout never
 * burns a redemption, and a committed one can never be double-counted.
 */
@Schema({ timestamps: true, collection: 'coupon_redemptions' })
export class CouponRedemption {
  @Prop({ type: Types.ObjectId, ref: 'Coupon', required: true })
  couponId: Types.ObjectId;

  /** Denormalised so order detail can show the code without a join. */
  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  /** INTEGER PAISE actually taken off this order. */
  @Prop({ type: Number, required: true, min: 0 })
  discount: number;
}

export const CouponRedemptionSchema =
  SchemaFactory.createForClass(CouponRedemption);

/** Backs the per-user limit check. */
CouponRedemptionSchema.index({ couponId: 1, customerId: 1 });

/**
 * One redemption per order, full stop. A retried checkout that somehow
 * reached this write twice fails on the index rather than discounting
 * the same order twice.
 */
CouponRedemptionSchema.index({ orderId: 1 }, { unique: true });
