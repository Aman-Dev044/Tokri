import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type IdempotencyKeyDocument = HydratedDocument<IdempotencyKey>;

/**
 * A record of one `Idempotency-Key` and the response it produced.
 *
 * Why this exists: a customer taps "Pay" twice, or their phone drops the
 * connection mid-checkout and the app retries. Without this record the
 * second request creates a second order and takes a second payment. With
 * it, the retry replays the first response byte-for-byte.
 *
 * The record is written BEFORE the handler runs (the unique index on `key`
 * is the lock) and completed afterwards, so two concurrent requests with
 * the same key cannot both execute.
 */
@Schema({
  collection: 'idempotency_keys',
  timestamps: { createdAt: true, updatedAt: true },
})
export class IdempotencyKey {
  /**
   * The client-supplied `Idempotency-Key` header. Unique across the whole
   * collection, not per-scope: a key is a one-time token, and reusing one
   * on a different endpoint is a client bug worth surfacing as a 409 rather
   * than silently replaying an unrelated response.
   */
  @Prop({ required: true, unique: true, index: true })
  key: string;

  /** Logical operation the key was spent on, e.g. `checkout.create`. */
  @Prop({ required: true, index: true })
  scope: string;

  /**
   * The authenticated caller. Checked on replay so one user can never be
   * handed another user's cached response by guessing their key.
   */
  @Prop({ type: String, default: null })
  userId: string | null;

  /** False while the handler is in flight; true once the response is stored. */
  @Prop({ default: false })
  completed: boolean;

  @Prop({ type: Number, default: null })
  statusCode: number | null;

  /**
   * The serialised response body. `Mixed`, because the shape differs per
   * endpoint — it is only ever read back and returned verbatim, never
   * queried into.
   */
  @Prop({ type: SchemaTypes.Mixed, default: null })
  response: unknown;

  /** TTL anchor — see the index below. */
  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date;
}

export const IdempotencyKeySchema =
  SchemaFactory.createForClass(IdempotencyKey);

/**
 * 24-hour TTL. Long enough to cover every realistic client retry window
 * (including a phone that reconnects the next morning), short enough that
 * the collection never becomes an unbounded log of every mutation the
 * platform has ever served.
 *
 * MongoDB's TTL monitor deletes expired documents roughly every 60s, so
 * the effective lifetime is 24h plus up to a minute.
 */
IdempotencyKeySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86_400 });
IdempotencyKeySchema.index({ scope: 1, userId: 1 });
