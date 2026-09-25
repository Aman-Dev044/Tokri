import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type InventoryLogDocument = HydratedDocument<InventoryLog>;

export enum InventoryReason {
  RESTOCK = 'restock',
  ORDER_RESERVE = 'order_reserve',
  ORDER_RELEASE = 'order_release',
  ORDER_COMMIT = 'order_commit',
  MANUAL = 'manual',
}

/** Append-only audit trail for every stock movement. */
@Schema({ timestamps: false, collection: 'inventory_logs' })
export class InventoryLog {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  /** Signed: +25 on restock, -2 when an order commits. */
  @Prop({ type: Number, required: true })
  delta: number;

  @Prop({ type: String, enum: InventoryReason, required: true })
  reason: InventoryReason;

  /** Order id, settlement id, or whatever caused the movement. */
  @Prop({ type: Types.ObjectId, default: null })
  refId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  byUserId?: Types.ObjectId | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  at: Date;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const InventoryLogSchema = SchemaFactory.createForClass(InventoryLog);

InventoryLogSchema.index({ vendorId: 1, at: -1 });
InventoryLogSchema.index({ productId: 1, at: -1 });
InventoryLogSchema.index({ isDemo: 1 });
