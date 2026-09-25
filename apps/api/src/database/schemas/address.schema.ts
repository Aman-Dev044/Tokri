import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { GeoPoint, GeoPointSchema } from './geo-point';

export type AddressDocument = HydratedDocument<Address>;

@Schema({ timestamps: true, collection: 'addresses' })
export class Address {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId: Types.ObjectId;

  /** Home / Work / whatever the customer typed. */
  @Prop({ type: String, default: 'Home' })
  label: string;

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

  @Prop({ type: Boolean, default: false })
  isDefault: boolean;

  @Prop({ required: true })
  phone: string;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const AddressSchema = SchemaFactory.createForClass(Address);

AddressSchema.index({ customerId: 1, isDefault: -1 });
AddressSchema.index({ location: '2dsphere' });
AddressSchema.index({ isDemo: 1 });
