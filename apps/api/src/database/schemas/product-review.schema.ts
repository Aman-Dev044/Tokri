import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProductReviewDocument = HydratedDocument<ProductReview>;

/** The longest comment a review may carry. */
export const REVIEW_COMMENT_MAX = 500;

/**
 * One customer's review of one product — VERIFIED PURCHASE ONLY.
 *
 * A review can only be written by a customer holding a DELIVERED order with
 * a fulfilled line for this product (`ReviewsService.requireDeliveredOrder`);
 * `orderId` records which order proved it. One review per customer per
 * product, enforced by the unique index below, and editable in place.
 *
 * ── Moderation ──────────────────────────────────────────────────────────
 * An admin can HIDE a review with a reason (audited). A hidden review is
 * excluded from the public list AND from `Product.ratingAvg` /
 * `ratingCount`, and is never deleted — unhiding restores it exactly. The
 * author still sees their own review, marked hidden, so a moderation
 * decision is never a silent disappearance from their point of view.
 */
@Schema({ timestamps: true, collection: 'product_reviews' })
export class ProductReview {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId: Types.ObjectId;

  /** The delivered order that qualified this customer to review. */
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ type: String, default: null, maxlength: REVIEW_COMMENT_MAX })
  comment?: string | null;

  /**
   * "Asha K." — first name and last initial, taken at write time. Shown
   * publicly, so it is never the full name, phone or email.
   */
  @Prop({ required: true, trim: true })
  authorName: string;

  @Prop({ type: Boolean, default: false })
  isHidden: boolean;

  @Prop({ type: String, default: null })
  hiddenReason?: string | null;

  @Prop({ type: Date, default: null })
  hiddenAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  hiddenBy?: Types.ObjectId | null;

  /** Set on every edit after the first write; null until then. */
  @Prop({ type: Date, default: null })
  editedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const ProductReviewSchema = SchemaFactory.createForClass(ProductReview);

/** One review per customer per product. */
ProductReviewSchema.index({ customerId: 1, productId: 1 }, { unique: true });
/** The public list and the aggregate: visible reviews of one product, newest first. */
ProductReviewSchema.index({ productId: 1, isHidden: 1, createdAt: -1 });
/** The moderation queue. */
ProductReviewSchema.index({ isHidden: 1, createdAt: -1 });
