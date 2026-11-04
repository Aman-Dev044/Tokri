import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WishlistItemDocument = HydratedDocument<WishlistItem>;

/**
 * One saved product for one customer.
 *
 * ── Why a row per item and not an array on the user ─────────────────────
 * The unique `{ customerId, productId }` index below is the whole
 * idempotency story: `POST /wishlist/:productId` is an upsert against it,
 * so a double-tapped heart — or two tabs saving the same product at once —
 * lands on one row, never two. An array on `User` would need `$addToSet`
 * discipline in every writer, and `User` is the document `JwtStrategy`
 * reads on every request; it should not grow with someone's shopping list.
 *
 * ── Why the name and image are snapshotted ──────────────────────────────
 * A product can be withdrawn or deleted after it was saved. The wishlist
 * still has to say WHAT was saved — "Alphonso mangoes, no longer sold" is
 * an honest row; a blank card is not. The live product is always preferred
 * when it exists; the snapshot is only what remains when it does not.
 */
@Schema({ timestamps: true, collection: 'wishlist_items' })
export class WishlistItem {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  /** Snapshot at save time — see the class comment. */
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, default: null })
  image?: string | null;

  /** Maintained by `timestamps`. */
  createdAt: Date;
}

export const WishlistItemSchema = SchemaFactory.createForClass(WishlistItem);

/** One row per (customer, product): the idempotency guarantee. */
WishlistItemSchema.index({ customerId: 1, productId: 1 }, { unique: true });
/** The list read: one customer's rows, newest first. */
WishlistItemSchema.index({ customerId: 1, createdAt: -1 });
