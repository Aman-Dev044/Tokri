import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AisleKey } from '../../common/constants/aisle.enum';

export type CategoryDocument = HydratedDocument<Category>;

@Schema({ timestamps: true, collection: 'categories' })
export class Category {
  /** `null` means platform-global - shared by every vendor. */
  @Prop({ type: Types.ObjectId, ref: 'Vendor', default: null })
  vendorId?: Types.ObjectId | null;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ type: Types.ObjectId, ref: 'Category', default: null })
  parentId?: Types.ObjectId | null;

  /**
   * Drives the chromatic-aisle UI and the admin sales-by-aisle chart.
   * A closed enum, because an unrecognised key has no hue and would
   * render as an uncoloured hole in both surfaces.
   */
  @Prop({ type: String, enum: AisleKey, required: true })
  aisleKey: AisleKey;

  @Prop({ type: String, default: null })
  imageUrl?: string | null;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const CategorySchema = SchemaFactory.createForClass(Category);

CategorySchema.index({ vendorId: 1, slug: 1 }, { unique: true });
CategorySchema.index({ aisleKey: 1, sortOrder: 1 });
CategorySchema.index({ isDemo: 1 });
