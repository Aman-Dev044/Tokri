import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

/**
 * The seven lifecycle events the notifications module ships templates
 * for (see `templates.ts`), plus `GENERIC` for anything a future caller
 * sends through `NotificationsService.notify()` without a named template.
 */
export enum NotificationType {
  ORDER_PLACED = 'order_placed',
  ORDER_ACCEPTED = 'order_accepted',
  ORDER_READY = 'order_ready',
  ORDER_OUT_FOR_DELIVERY = 'order_out_for_delivery',
  ORDER_DELIVERED = 'order_delivered',
  ORDER_CANCELLED = 'order_cancelled',
  ORDER_REFUNDED = 'order_refunded',

  // ── Rider wallet & KYC ────────────────────────────────────────────
  // None of these ever interpolates a government identifier: see the
  // templates in `modules/notifications/templates.ts`, which take a
  // status and an amount and nothing else.
  WALLET_LOW_BALANCE = 'wallet_low_balance',
  WALLET_CREDITED = 'wallet_credited',
  KYC_SUBMITTED = 'kyc_submitted',
  KYC_VERIFIED = 'kyc_verified',
  KYC_REJECTED = 'kyc_rejected',

  GENERIC = 'generic',
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  NOTIFICATION (§5.1) — `{ userId, type, title, body, data, readAt,
 *  createdAt }`
 * ════════════════════════════════════════════════════════════════════════
 *
 * The IN-APP record. It is written unconditionally by
 * `NotificationsService.notify()` — this is the one channel that never
 * depends on a third-party key, so it is also the one channel this
 * schema itself is responsible for.
 *
 * `data` never carries an OTP, a password or a token: `notify()` is fed
 * only by the fixed templates in `templates.ts`, none of which accept
 * secret material as an interpolated value.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: NotificationType, required: true })
  type: NotificationType;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  /** Arbitrary small payload (e.g. `{ orderId, orderNo }`) for deep-linking. */
  // Nullable `Mixed` needs an explicit `type:` — see product/vendor schemas.
  @Prop({ type: Object, default: null })
  data?: Record<string, unknown> | null;

  // Nullable Date needs an explicit `type:` — a bare `Date | null` union
  // throws `CannotDetermineTypeError` at runtime.
  @Prop({ type: Date, default: null })
  readAt?: Date | null;

  /**
   * Declared explicitly (matching `IdempotencyKey.createdAt`), even
   * though `timestamps: { createdAt: true }` above already manages it at
   * runtime: without a class field, `HydratedDocument<Notification>` has
   * no `createdAt` in its TypeScript shape, and `NotificationsService`
   * reads it off the hydrated document, not only off a `.lean()` row.
   */
  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// ── Indexes ──────────────────────────────────────────────────────────────
// The list query: "this user's notifications, newest first".
NotificationSchema.index({ userId: 1, createdAt: -1 });
// The unread-count query and the read-all bulk update both filter on
// `{ userId, readAt: null }` — a distinct index because the shape (an
// equality filter, no range) is different from the listing query above,
// and a compound index that led with `createdAt` could not serve it.
NotificationSchema.index({ userId: 1, readAt: 1 });

/**
 * THE TTL (§5.1 / #9 in the risk table): 90 days.
 *
 * Without it this is the second-highest-volume collection in the
 * platform (after `location_pings`) and grows forever — nothing ever
 * reads a 4-month-old "your order is out for delivery" banner.
 * `expireAfterSeconds` on `createdAt`, the document's own timestamp,
 * exactly like `LocationPing`'s TTL on `at`.
 */
NotificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);
