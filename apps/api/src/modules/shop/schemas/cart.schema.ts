import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CartDocument = HydratedDocument<Cart>;

export enum CartStatus {
  /** The one cart the customer is shopping in right now. */
  ACTIVE = 'active',
  /** Set aside when the customer started shopping at another store. */
  PARKED = 'parked',
  /** Spent on an order. Kept briefly as the trail back from the order. */
  CONVERTED = 'converted',
}

/**
 * A line in the cart.
 *
 * `name`, `image` and `price` are a SNAPSHOT of the catalogue at the
 * moment the line was added — deliberately, not as a cache. `GET /cart`
 * compares the snapshot against the live product and flags every line
 * that has drifted (`price_changed`, `out_of_stock`, `reduced_qty`)
 * instead of silently rewriting it. A cart that quietly re-prices itself
 * is how a customer ends up paying more than the screen ever showed them.
 *
 * `price` is INTEGER PAISE. Never a float.
 */
@Schema({ _id: false })
export class CartItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ type: String, default: null })
  image?: string | null;

  /** INTEGER PAISE, snapshotted when the line was added. */
  @Prop({ type: Number, required: true, min: 0 })
  price: number;

  @Prop({ type: Number, required: true, min: 1 })
  qty: number;
}
export const CartItemSchema = SchemaFactory.createForClass(CartItem);

/**
 * One cart per (customer, vendor) — §5.1.
 *
 * ── Why one vendor per cart ─────────────────────────────────────────────
 * Locked decision #1: one vendor per cart, one vendor per order. One order
 * is one pickup and one rider, which is what makes fast grocery delivery
 * work at all. Adding a product from a different store therefore does NOT
 * empty the basket — it PARKS it. The parked cart stays restorable for
 * seven days (the TTL below), because a customer who wandered into another
 * store and came back to find their basket destroyed does not come back
 * a second time.
 */
@Schema({ timestamps: true, collection: 'carts' })
export class Cart {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  customerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', required: true })
  vendorId: Types.ObjectId;

  @Prop({ type: [CartItemSchema], default: [] })
  items: CartItem[];

  @Prop({
    type: String,
    enum: CartStatus,
    required: true,
    default: CartStatus.ACTIVE,
  })
  status: CartStatus;

  /** Set when the cart was spent, so the order can be traced back. */
  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  convertedOrderId?: Types.ObjectId | null;

  /** Maintained by `timestamps`; anchors the TTL index below. */
  updatedAt: Date;
  createdAt: Date;
}

export const CartSchema = SchemaFactory.createForClass(Cart);

/**
 * At most ONE live cart per (customer, vendor).
 *
 * The filter matters: a `converted` cart is history, and without the
 * partial filter the customer's second order from the same store would
 * collide with the first one's spent cart on a unique index.
 */
CartSchema.index(
  { customerId: 1, vendorId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [CartStatus.ACTIVE, CartStatus.PARKED] },
    },
  },
);

/** The customer's single active cart, and the parked-cart list. */
CartSchema.index({ customerId: 1, status: 1, updatedAt: -1 });

/**
 * Seven-day TTL on everything that is no longer being shopped.
 *
 * MongoDB permits only one index per key pattern, so `parked` and
 * `converted` share it: a parked cart is restorable for a week, and a
 * converted one is kept exactly as long purely as an audit trail back
 * from the order it became. An ACTIVE cart is excluded by the partial
 * filter and never expires while the customer is still using it.
 */
CartSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 7 * 24 * 60 * 60,
    partialFilterExpression: {
      status: { $in: [CartStatus.PARKED, CartStatus.CONVERTED] },
    },
  },
);
