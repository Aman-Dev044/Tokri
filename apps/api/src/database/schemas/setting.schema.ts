import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type SettingDocument = HydratedDocument<Setting>;

/**
 * Platform configuration that OPERATIONS owns, not deployment.
 *
 * The distinction matters: a secret belongs in `.env` and is validated at
 * boot; a delivery fee is a business decision an admin changes at 9am
 * without a redeploy. Nothing secret is ever stored here.
 */
@Schema({ timestamps: true, collection: 'settings' })
export class Setting {
  @Prop({ required: true, trim: true })
  key: string;

  @Prop({ type: SchemaTypes.Mixed, required: true })
  value: unknown;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const SettingSchema = SchemaFactory.createForClass(Setting);

SettingSchema.index({ key: 1 }, { unique: true });
