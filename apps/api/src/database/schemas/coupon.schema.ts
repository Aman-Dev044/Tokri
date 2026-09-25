import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CouponDocument = HydratedDocument<Coupon>;

export enum CouponType {
  FLAT = 'flat',
  PERCENT = 'percent',
}

@Schema({ timestamps: true, collection: 'coupons' })
export class Coupon {
  /** `null` = platform-wide, valid at every vendor. */
  @Prop({ type: Types.ObjectId, ref: 'Vendor', default: null })
  vendorId?: Types.ObjectId | null;

  @Prop({ required: true, uppercase: true, trim: true })
  code: string;

  @Prop({ type: String, enum: CouponType, required: true })
  type: CouponType;

  /**
   * FLAT  -> INTEGER PAISE off the subtotal.
   * PERCENT -> whole percent, 1-100.
   *
   * One field, two units. The type field is what disambiguates, and every
   * reader must branch on it; validation enforces the range per type.
   */
  @Prop({ type: Number, required: true, min: 0 })
  value: number;

  /** Minimum order subtotal, INTEGER PAISE. */
  @Prop({ type: Number, default: 0 })
  minOrder: number;

  /**
   * Cap on a percent discount, INTEGER PAISE.
   *
   * REQUIRED for PERCENT coupons: without it "50% off" on a Rs 12,000
   * bulk order is an unbounded liability.
   */
  @Prop({ type: Number, default: null })
  maxDiscount?: number | null;

  @Prop({ type: Number, default: 0 })
  usageLimit: number;

  @Prop({ type: Number, default: 0 })
  usedCount: number;

  @Prop({ type: Number, default: 1 })
  perUserLimit: number;

  @Prop({ type: Date, required: true })
  validFrom: Date;

  @Prop({ type: Date, required: true })
  validTo: Date;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: String, default: null })
  description?: string | null;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);

CouponSchema.index({ code: 1 }, { unique: true });
CouponSchema.index({ isActive: 1, validTo: 1 });
CouponSchema.index({ vendorId: 1 });
CouponSchema.index({ isDemo: 1 });
