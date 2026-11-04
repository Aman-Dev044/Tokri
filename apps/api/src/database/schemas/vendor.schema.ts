import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { GeoPoint, GeoPointSchema } from './geo-point';

export type VendorDocument = HydratedDocument<Vendor>;

export enum VendorStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  SUSPENDED = 'suspended',
}

@Schema({ _id: false })
export class VendorAddress {
  @Prop({ required: true, trim: true })
  line1: string;

  @Prop({ type: String, default: null, trim: true })
  line2?: string | null;

  @Prop({ required: true, trim: true })
  city: string;

  @Prop({ required: true, trim: true })
  state: string;

  @Prop({ required: true, trim: true })
  pincode: string;
}
export const VendorAddressSchema = SchemaFactory.createForClass(VendorAddress);

@Schema({ _id: false })
export class OpeningHour {
  /** 0 = Sunday … 6 = Saturday, matching `Date#getDay()`. */
  @Prop({ type: Number, required: true, min: 0, max: 6 })
  day: number;

  /** 24-hour `HH:mm`. */
  @Prop({ required: true })
  open: string;

  @Prop({ required: true })
  close: string;
}
export const OpeningHourSchema = SchemaFactory.createForClass(OpeningHour);

@Schema({ timestamps: true, collection: 'vendors' })
export class Vendor {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  storeName: string;

  // Unique index declared once below, via VendorSchema.index().
  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ type: String, default: null })
  description?: string | null;

  @Prop({ type: String, default: null })
  logoUrl?: string | null;

  @Prop({ type: String, default: null })
  bannerUrl?: string | null;

  @Prop({ type: VendorAddressSchema, required: true })
  address: VendorAddress;

  @Prop({ type: GeoPointSchema, required: true })
  location: GeoPoint;

  @Prop({ type: Number, default: 5 })
  serviceRadiusKm: number;

  /**
   * Admin-set platform commission, in percent.
   *
   * COPIED onto every order at creation time (`pricing.commissionPct`).
   * Changing it here never rewrites financial history — that snapshot is
   * the difference between a rate change and a retroactive re-billing of
   * every order the vendor has ever fulfilled.
   */
  @Prop({ type: Number, required: true, min: 0, max: 100 })
  commissionPct: number;

  @Prop({ type: Boolean, default: true })
  codEnabled: boolean;

  /** INTEGER PAISE. Rs 2,000 is stored as 200000. */
  @Prop({ type: Number, default: 200000 })
  codMaxAmount: number;

  @Prop({ type: Boolean, default: true })
  isOpen: boolean;

  @Prop({ type: [OpeningHourSchema], default: [] })
  openingHours: OpeningHour[];

  @Prop({ type: String, enum: VendorStatus, default: VendorStatus.PENDING })
  status: VendorStatus;

  /**
   * 0-5, one decimal place — the mean of every customer's order rating.
   *
   * Written ONLY by `OrderRatingService`, in the same transaction that
   * claims the order's one rating, and always as `ratingSum / ratingCount`.
   * Keeping the sum beside the count is what makes the mean exact: an
   * incremental average recomputed from its own rounded value drifts a
   * little further from the truth with every rating it absorbs.
   */
  @Prop({ type: Number, default: 0 })
  rating: number;

  /** How many order ratings `rating` is the mean of. */
  @Prop({ type: Number, default: 0, min: 0 })
  ratingCount: number;

  /** Sum of every store rating received (each 1-5). */
  @Prop({ type: Number, default: 0, min: 0 })
  ratingSum: number;

  /** Reason recorded the last time an admin suspended or re-pended it. */
  @Prop({ type: String, default: null })
  statusReason?: string | null;

  /** Planted by `seed:demo`; the only records `--fresh` will delete. */
  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const VendorSchema = SchemaFactory.createForClass(Vendor);

VendorSchema.index({ location: '2dsphere' });
VendorSchema.index({ slug: 1 }, { unique: true });
VendorSchema.index({ status: 1, isOpen: 1 });
VendorSchema.index({ ownerId: 1 });
VendorSchema.index({ isDemo: 1 });
