import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InventoryDocument = HydratedDocument<Inventory>;

/**
 * Stock lives HERE and nowhere else.
 *
 * It is deliberately absent from the product document: two writers to the
 * same quantity in two collections is how oversell bugs are born.
 */
@Schema({ timestamps: true, collection: 'inventory' })
export class Inventory {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  /** Authoritative available count. */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  stock: number;

  /** Held by in-flight checkouts, not yet committed. */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  reserved: number;

  @Prop({ type: Number, default: 10 })
  lowStockThreshold: number;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const InventorySchema = SchemaFactory.createForClass(Inventory);

InventorySchema.index({ productId: 1 }, { unique: true });
InventorySchema.index({ vendorId: 1, stock: 1 });
InventorySchema.index({ isDemo: 1 });
