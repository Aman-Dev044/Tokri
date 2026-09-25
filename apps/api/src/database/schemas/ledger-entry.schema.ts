import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LedgerEntryDocument = HydratedDocument<LedgerEntry>;

export enum LedgerEntryType {
  SALE = 'sale',
  COMMISSION = 'commission',
  REFUND = 'refund',
  PAYOUT = 'payout',
  ADJUSTMENT = 'adjustment',
}

/**
 * The money trail. Append-only: a mistake is corrected with a new
 * `adjustment` row, never by editing history.
 *
 * `amount` is SIGNED INTEGER PAISE, from the vendor's point of view:
 *   sale        +itemsSubtotal
 *   commission  -commissionAmount
 *   refund      -refundedAmount
 *   payout      -netPayable   (money has left the platform to the vendor)
 *
 * The vendor's balance is therefore the plain sum of their rows, which is
 * the only arithmetic a settlement report should ever need.
 */
@Schema({ timestamps: true, collection: 'ledger_entries' })
export class LedgerEntry {
  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  orderId?: Types.ObjectId | null;

  @Prop({ type: String, enum: LedgerEntryType, required: true })
  type: LedgerEntryType;

  /** SIGNED, INTEGER PAISE. */
  @Prop({ type: Number, required: true })
  amount: number;

  @Prop({ type: String, default: null })
  note?: string | null;

  /** Set once the row has been swept into a settlement. */
  @Prop({ type: Types.ObjectId, ref: 'Settlement', default: null })
  settlementId?: Types.ObjectId | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  at: Date;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);

LedgerEntrySchema.index({ vendorId: 1, at: -1 });
LedgerEntrySchema.index({ settlementId: 1 });
LedgerEntrySchema.index({ type: 1, at: -1 });
LedgerEntrySchema.index({ orderId: 1 });
LedgerEntrySchema.index({ isDemo: 1 });
