import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductDocument = HydratedDocument<Product>;

export enum ProductUnit {
  KG = 'kg',
  G = 'g',
  L = 'l',
  ML = 'ml',
  PIECE = 'piece',
  PACK = 'pack',
}

@Schema({ timestamps: true, collection: 'products' })
export class Product {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Category', required: true })
  categoryId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ type: String, default: null })
  description?: string | null;

  @Prop({ type: [String], default: [] })
  images: string[];

  @Prop({ type: String, default: null })
  brand?: string | null;

  @Prop({ type: String, enum: ProductUnit, required: true })
  unit: ProductUnit;

  @Prop({ type: Number, required: true })
  unitValue: number;

  @Prop({ required: true, trim: true })
  sku: string;

  /**
   * The code printed on the pack (EAN-13, UPC-A, Code 128…) — what a
   * counter scanner types. Optional; unique per store WHEN SET, which is
   * why the index below is partial: a hundred products without a barcode
   * must not collide on `null`.
   */
  @Prop({ type: String, default: null, trim: true })
  barcode?: string | null;

  /** Maximum retail price - INTEGER PAISE. */
  @Prop({ type: Number, required: true, min: 0 })
  mrp: number;

  /** Selling price - INTEGER PAISE. Never a float rupee value. */
  @Prop({ type: Number, required: true, min: 0 })
  price: number;

  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  discountPct: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  /** Lowercased name + brand + tags. Backs the `text` index below. */
  @Prop({ type: String, default: '' })
  searchText: string;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

ProductSchema.index({ vendorId: 1, categoryId: 1, isActive: 1 });
ProductSchema.index({ vendorId: 1, sku: 1 }, { unique: true });
ProductSchema.index(
  { vendorId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } },
);
ProductSchema.index({ searchText: 'text' });
ProductSchema.index({ categoryId: 1 });
ProductSchema.index({ isDemo: 1 });
