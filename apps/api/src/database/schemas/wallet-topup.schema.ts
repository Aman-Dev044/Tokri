import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletTopupDocument = HydratedDocument<WalletTopup>;

export enum WalletTopupStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  WALLET TOP-UP — one attempt to put money into a rider's wallet
 * ════════════════════════════════════════════════════════════════════════
 *
 * `POST /delivery/wallet/topup` creates one of these and hands the rider
 * a gateway order; `POST /delivery/wallet/topup/:topupId/verify` resolves
 * it. `:topupId` is THIS document's id — never the gateway's — so the
 * rider app addresses a resource this platform owns, exactly as
 * `POST /payments/:orderId/verify` addresses an Order rather than a
 * Razorpay order.
 *
 * ── Why this exists at all, separate from the ledger ────────────────────
 * `WalletTransaction` is applied money: every row in it has already moved
 * the balance. An attempt that is still open at the gateway has not, and
 * writing a "pending" ledger row would mean the balance no longer equals
 * `sum(amountPaise)` — the one property that makes the ledger auditable.
 * The attempt lives here; the ledger gains its TOPUP row only when the
 * signature verifies.
 *
 * `amountPaise` is captured at creation and is what gets credited on
 * verification — NEVER a figure echoed back by the client. A client that
 * can name the amount at verification time can top up ₹10 and credit
 * ₹10,000.
 */
@Schema({ timestamps: true, collection: 'wallet_topups' })
export class WalletTopup {
  @Prop({ type: Types.ObjectId, ref: 'DeliveryPartner', required: true, index: true })
  partnerId: Types.ObjectId;

  /** The rider's User id, so the credit can be announced without a lookup. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** INTEGER PAISE, fixed at creation. The client never restates it. */
  @Prop({ type: Number, required: true, min: 1 })
  amountPaise: number;

  @Prop({
    type: String,
    enum: WalletTopupStatus,
    required: true,
    default: WalletTopupStatus.PENDING,
  })
  status: WalletTopupStatus;

  @Prop({ type: String, default: null })
  providerOrderId?: string | null;

  @Prop({ type: String, default: null })
  providerPaymentId?: string | null;

  @Prop({ type: Date, default: null })
  paidAt?: Date | null;

  /** The ledger row this attempt produced, once it succeeded. */
  @Prop({ type: Types.ObjectId, ref: 'WalletTransaction', default: null })
  transactionId?: Types.ObjectId | null;
}

export const WalletTopupSchema = SchemaFactory.createForClass(WalletTopup);

// The rider's own top-up history, newest first.
WalletTopupSchema.index({ partnerId: 1, createdAt: -1 });
// SPARSE unique: the gateway's order id identifies exactly one attempt,
// but a row that never reached the gateway has none, and a plain unique
// index would let only ONE such row exist across the whole collection.
WalletTopupSchema.index(
  { providerOrderId: 1 },
  { unique: true, sparse: true },
);
