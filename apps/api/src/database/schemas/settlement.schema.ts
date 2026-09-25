import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SettlementDocument = HydratedDocument<Settlement>;

export enum SettlementStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PAID = 'paid',
  FAILED = 'failed',
}

/**
 * One weekly payout window per vendor (locked decision #7: every Monday,
 * covering orders DELIVERED up to the previous Sunday).
 *
 * Every amount is INTEGER PAISE, and every one of them is the sum of the
 * LedgerEntry rows carrying this settlement's id - the settlement is a
 * cached roll-up of the ledger, never an independent source of truth.
 */
@Schema({ timestamps: true, collection: 'settlements' })
export class Settlement {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  periodStart: Date;

  @Prop({ type: Date, required: true })
  periodEnd: Date;

  /** Sum of `itemsSubtotal` across the delivered orders in the window. */
  @Prop({ type: Number, required: true, default: 0 })
  grossSales: number;

  @Prop({ type: Number, required: true, default: 0 })
  totalCommission: number;

  @Prop({ type: Number, required: true, default: 0 })
  refunds: number;

  /** grossSales - totalCommission - refunds. */
  @Prop({ type: Number, required: true, default: 0 })
  netPayable: number;

  @Prop({ type: Number, required: true, default: 0 })
  orderCount: number;

  @Prop({
    type: String,
    enum: SettlementStatus,
    required: true,
    default: SettlementStatus.PENDING,
  })
  status: SettlementStatus;

  @Prop({ type: Date, default: null })
  paidAt?: Date | null;

  /** Bank/UTR reference for the transfer. */
  @Prop({ type: String, default: null })
  reference?: string | null;

  @Prop({ type: String, default: null })
  failureReason?: string | null;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const SettlementSchema = SchemaFactory.createForClass(Settlement);

/**
 * One settlement per vendor per window. The unique index is what makes
 * `POST /admin/settlements/generate` safe to run twice: the second run
 * collides instead of paying the same week out again.
 */
SettlementSchema.index(
  { vendorId: 1, periodStart: 1, periodEnd: 1 },
  { unique: true },
);
SettlementSchema.index({ status: 1, periodEnd: -1 });
SettlementSchema.index({ periodEnd: -1 });
SettlementSchema.index({ isDemo: 1 });
