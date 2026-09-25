import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { GeoPoint, GeoPointSchema } from './geo-point';

export type DeliveryPartnerDocument = HydratedDocument<DeliveryPartner>;

export enum VehicleType {
  BICYCLE = 'bicycle',
  SCOOTER = 'scooter',
  MOTORCYCLE = 'motorcycle',
  EV_SCOOTER = 'ev_scooter',
}

export enum PartnerStatus {
  ACTIVE = 'active',
  PENDING = 'pending',
  SUSPENDED = 'suspended',
}

@Schema({ timestamps: true, collection: 'delivery_partners' })
export class DeliveryPartner {
  /** The login identity. One User, one DeliveryPartner profile. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** `null` means the shared platform pool rather than a vendor's rider. */
  @Prop({ type: Types.ObjectId, ref: 'Vendor', default: null })
  vendorId?: Types.ObjectId | null;

  @Prop({ type: String, enum: VehicleType, required: true })
  vehicleType: VehicleType;

  @Prop({ type: Boolean, default: false })
  isAvailable: boolean;

  @Prop({ type: Boolean, default: false })
  isOnline: boolean;

  @Prop({ type: GeoPointSchema, default: null })
  currentLocation?: GeoPoint | null;

  @Prop({ type: Date, default: null })
  locationAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  activeOrderId?: Types.ObjectId | null;

  @Prop({ type: Number, default: 0 })
  completedCount: number;

  /** 0-5. */
  @Prop({ type: Number, default: 0 })
  rating: number;

  /**
   * Administrative state, distinct from `isOnline`.
   * A suspended rider is not merely offline - they may not come back on.
   */
  @Prop({ type: String, enum: PartnerStatus, default: PartnerStatus.ACTIVE })
  status: PartnerStatus;

  @Prop({ type: String, default: null })
  statusReason?: string | null;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const DeliveryPartnerSchema =
  SchemaFactory.createForClass(DeliveryPartner);

DeliveryPartnerSchema.index({ currentLocation: '2dsphere' });
DeliveryPartnerSchema.index({ vendorId: 1, isAvailable: 1, isOnline: 1 });
DeliveryPartnerSchema.index({ userId: 1 }, { unique: true });
DeliveryPartnerSchema.index({ status: 1 });
DeliveryPartnerSchema.index({ isDemo: 1 });
