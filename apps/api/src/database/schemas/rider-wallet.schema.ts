import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RiderWalletDocument = HydratedDocument<RiderWallet>;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RIDER WALLET — the prepaid balance a pick fee is drawn from
 * ════════════════════════════════════════════════════════════════════════
 *
 * A SEPARATE COLLECTION, deliberately not a field on `DeliveryPartner`.
 *
 * `DeliveryPartner` is rewritten every few seconds by the location-ping
 * stream (`currentLocation`, `locationAt`). The balance is mutated under
 * a transaction on almost every order accept. Sharing one document means
 * every ping competes with a money write for the same document lock, and
 * a rider's cash balance sits in the hottest, least-careful write path in
 * the platform. One document, one reason to change.
 *
 * ── Every field is INTEGER PAISE ────────────────────────────────────────
 * Never rupees, never a float. `₹0.1 + ₹0.2 !== ₹0.3` in binary, and a
 * balance is the last place a rounding error should be allowed to live.
 *
 * ── The three lifetime counters are denormalised on purpose ─────────────
 * They could be summed from `WalletTransaction` on every read. They are
 * not: the rider's wallet screen is opened constantly, the ledger grows
 * without bound, and a running aggregate over it would get slower every
 * week. They are written in the same transaction as the balance, so they
 * can be reconciled against the ledger at any time — which is the point
 * of storing both.
 */
@Schema({ timestamps: true, collection: 'rider_wallets' })
export class RiderWallet {
  /** One wallet per rider. The UNIQUE index below is what enforces it. */
  @Prop({ type: Types.ObjectId, ref: 'DeliveryPartner', required: true })
  partnerId: Types.ObjectId;

  /**
   * Spendable balance, integer paise.
   *
   * `min: 0` is a second line of defence, not the first: the debit is a
   * guarded `$inc` (`{ balancePaise: { $gte: fee } }`), so an overdraw
   * cannot match a document in the first place. This catches a future
   * caller that forgets the guard.
   */
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  balancePaise: number;

  @Prop({ type: Number, required: true, default: 0 })
  lifetimeToppedUpPaise: number;

  @Prop({ type: Number, required: true, default: 0 })
  lifetimeSpentPaise: number;

  @Prop({ type: Number, required: true, default: 0 })
  lifetimeEarnedPaise: number;
}

export const RiderWalletSchema = SchemaFactory.createForClass(RiderWallet);

// UNIQUE: two wallet rows for one rider is two balances, and whichever
// one the next query happens to pick is the one the rider gets to spend.
RiderWalletSchema.index({ partnerId: 1 }, { unique: true });
