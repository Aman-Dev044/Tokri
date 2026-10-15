import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationOutboxDocument = HydratedDocument<NotificationOutbox>;

export enum NotificationChannel {
  EMAIL = 'email',
  SMS = 'sms',
  PUSH = 'push',
}

export enum OutboxStatus {
  /** Waiting for the sweeper, or waiting out a backoff after a failure. */
  PENDING = 'pending',
  /** Claimed by one sweeper tick; see the staleness note below. */
  PROCESSING = 'processing',
  SENT = 'sent',
  /** The provider is not configured. Logged once, never retried. */
  SKIPPED = 'skipped',
  /** Exhausted its retry budget. A human, not a timer, resolves it. */
  FAILED = 'failed',
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE OUTBOUND QUEUE — email / SMS / push, without BullMQ
 * ════════════════════════════════════════════════════════════════════════
 *
 * `bullmq` is not a dependency of `apps/api`, and there is no queue
 * infrastructure to add one to — see `assignment-sweeper.service.ts` for
 * the reasoning this module deliberately reuses rather than re-derives.
 * One row per (notification, channel): a notification fanned out to
 * email + push is two rows, so one channel's outage never blocks another.
 *
 * `NotificationOutboxSweeperService` claims a row with an atomic
 * `findOneAndUpdate({ status: PENDING, nextAttemptAt: { $lte: now } })`,
 * which is what makes draining safe across replicas without a lock — two
 * sweepers ticking at once cannot both claim the same row.
 *
 * `payload` is a deliberately-narrow copy of the notification (title,
 * body, data) rather than a reference the sweeper re-fetches: an outbox
 * row must still be sendable after its `Notification` has aged out of
 * the 90-day TTL, and a foreign-key read on every send would be a second
 * failure mode for no benefit.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'notification_outbox' })
export class NotificationOutbox {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Notification', required: true })
  notificationId: Types.ObjectId;

  @Prop({ type: String, enum: NotificationChannel, required: true })
  channel: NotificationChannel;

  @Prop({
    type: String,
    enum: OutboxStatus,
    required: true,
    default: OutboxStatus.PENDING,
  })
  status: OutboxStatus;

  @Prop({ type: Number, required: true, default: 0 })
  attempts: number;

  /** Due for another claim at or after this instant. */
  @Prop({ type: Date, required: true, default: () => new Date() })
  nextAttemptAt: Date;

  // Nullable fields below all need an explicit `type:` (CannotDetermineTypeError
  // otherwise) — the recurring rule in this codebase's schemas.
  @Prop({ type: Date, default: null })
  claimedAt?: Date | null;

  @Prop({ type: Date, default: null })
  sentAt?: Date | null;

  /** Never an OTP, password or token — `payload` is built only from `templates.ts`. */
  @Prop({ type: String, default: null })
  lastError?: string | null;

  @Prop({ type: Object, required: true })
  payload: { title: string; body: string; data: Record<string, unknown> | null };
}

export const NotificationOutboxSchema = SchemaFactory.createForClass(
  NotificationOutbox,
);

// ── Indexes ──────────────────────────────────────────────────────────────
// The sweeper's claim query: "pending work whose backoff has elapsed".
NotificationOutboxSchema.index({ status: 1, nextAttemptAt: 1 });
// Recovers rows orphaned by a process that died mid-send, so a crash
// between "claimed" and "written back" cannot strand a row in
// PROCESSING forever — the same stale-claim problem BullMQ's visibility
// timeout solves, handled here with the same index-and-timestamp idiom
// as the rest of this query.
NotificationOutboxSchema.index({ status: 1, claimedAt: 1 });

/**
 * A queue row is transient plumbing, not a record anyone reads back —
 * the durable trail is the `Notification` it was created for. 14 days
 * is generous for triaging a `FAILED` row and still bounds the
 * collection the same way `LocationPing`'s TTL does (#9 in the risk
 * table: every high-volume collection expires something).
 */
NotificationOutboxSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 14 * 24 * 60 * 60 },
);
