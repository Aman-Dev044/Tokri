import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrderCounterDocument = HydratedDocument<OrderCounter>;

/**
 * The per-day allocator behind `orderNo` (MND-20260925-0001).
 *
 * ── Why a counter and not `countDocuments() + 1` ────────────────────────
 * A count is read-then-write: fifty concurrent checkouts all read the same
 * number and all write the same `orderNo`, and the unique index on it
 * turns that into forty-nine failed orders. `findOneAndUpdate($inc)` is a
 * single atomic operation, so every caller gets a distinct value.
 *
 * ── Why it is allocated OUTSIDE the checkout transaction ────────────────
 * Every transaction would otherwise write the same counter document, and
 * fifty concurrent transactions touching one document is a write-conflict
 * storm — each one aborts and retries the whole checkout, including the
 * stock reservation. Allocating first means a rolled-back checkout leaves
 * a gap in the sequence, which is the correct trade: order numbers must be
 * unique and human-readable, not gapless.
 */
@Schema({ collection: 'order_counters', timestamps: true })
export class OrderCounter {
  /** The day bucket, `YYYYMMDD`. */
  @Prop({ required: true })
  key: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}

export const OrderCounterSchema = SchemaFactory.createForClass(OrderCounter);

OrderCounterSchema.index({ key: 1 }, { unique: true });
