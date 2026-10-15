import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletTransactionDocument = HydratedDocument<WalletTransaction>;

/**
 * Why money moved.
 *
 *   TOPUP      the rider added money (gateway, or an admin credit that
 *              represents a real transfer)
 *   PICK_FEE   the platform charged for accepting an order
 *   EARNING    a delivery payout credited to the wallet
 *   ADJUSTMENT a human moved it, with `createdBy` set — the audited case
 *   REFUND     a PICK_FEE given back because the order was taken away
 */
export enum WalletTxnType {
  TOPUP = 'topup',
  PICK_FEE = 'pick_fee',
  EARNING = 'earning',
  ADJUSTMENT = 'adjustment',
  REFUND = 'refund',
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  WALLET TRANSACTION — the ledger
 * ════════════════════════════════════════════════════════════════════════
 *
 * Append-only by discipline: nothing in this module updates or deletes a
 * row. A correction is a NEW `ADJUSTMENT` row, because the question an
 * auditor asks is "what happened", not "what does it look like now".
 *
 * ── `amountPaise` is SIGNED ─────────────────────────────────────────────
 * Positive credits, negative debits — one field, not an amount plus a
 * direction flag. A separate flag is a second source of truth about the
 * same fact, and the first time the two disagree the ledger is worthless.
 * It also means the balance is literally `sum(amountPaise)`, which is how
 * a reconciliation is written.
 *
 * ── `balanceAfterPaise` is STORED, not derived ──────────────────────────
 * The running balance at the instant this row was written, captured in
 * the same transaction as the `$inc`. A ledger you cannot reconcile
 * against a stored running balance is a ledger you cannot audit: without
 * it, a missing row and a wrong row look exactly the same.
 */
@Schema({ timestamps: true, collection: 'wallet_transactions' })
export class WalletTransaction {
  /** The DeliveryPartner `_id`, never the rider's User id. */
  @Prop({ type: Types.ObjectId, ref: 'DeliveryPartner', required: true, index: true })
  partnerId: Types.ObjectId;

  @Prop({ type: String, enum: WalletTxnType, required: true })
  type: WalletTxnType;

  /** SIGNED integer paise: positive credits, negative debits. */
  @Prop({ type: Number, required: true })
  amountPaise: number;

  /** The balance immediately after this row was applied. Integer paise. */
  @Prop({ type: Number, required: true })
  balanceAfterPaise: number;

  /** The order this charge or refund belongs to, when there is one. */
  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  orderId?: Types.ObjectId | null;

  /** Gateway payment id for a TOPUP; a free-form reference otherwise. */
  @Prop({ type: String, default: null })
  reference?: string | null;

  @Prop({ type: String, default: null })
  note?: string | null;

  /** The admin who made an ADJUSTMENT. Null for anything automatic. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  /**
   * Declared explicitly even though `timestamps: true` manages it: without
   * a class field the hydrated document has no `createdAt` in its
   * TypeScript shape, and the ledger response reads it directly.
   */
  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;
}

export const WalletTransactionSchema =
  SchemaFactory.createForClass(WalletTransaction);

// The ledger query, and the only one that matters: "this rider's
// transactions, newest first". Paginated, so without this index every
// page is a collection scan plus an in-memory sort.
WalletTransactionSchema.index({ partnerId: 1, createdAt: -1 });

// The refund path asks "was this order already charged / refunded?" —
// an equality lookup on two fields, which the index above cannot serve.
WalletTransactionSchema.index({ orderId: 1, type: 1 });
