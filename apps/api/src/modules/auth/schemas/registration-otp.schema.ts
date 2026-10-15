import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type RegistrationOtpDocument = HydratedDocument<RegistrationOtp>;

/**
 * A single OTP challenge issued for phone verification during customer
 * signup (`POST /auth/register/request-otp`).
 *
 * ── Why a whole collection for a 6-digit code ───────────────────────────
 * `requestId` (this document's `_id`) is the thing the client carries
 * across all three signup calls, and the record itself is what makes the
 * later `registrationToken` single-use: `verifiedAt` proves the code was
 * checked, `consumedAt` proves it has not already been spent on an
 * account. Both are set inside the same transaction that creates the
 * `User`, so a replayed token cannot create two accounts even under
 * concurrent requests.
 *
 * ── Hashing ──────────────────────────────────────────────────────────────
 * SHA-256, not argon2id: this is a random 6-digit code with a 5-minute
 * lifetime and a 3-attempt lockout, so the thing doing the protecting is
 * the TTL and the attempt counter, not hash cost. Argon2 exists to slow
 * down an offline attack against a human-chosen, long-lived secret; an
 * OTP is neither.
 *
 * ── Cleanup ──────────────────────────────────────────────────────────────
 * The TTL index below purges every document 15 minutes after creation,
 * regardless of its state, so abandoned OTP challenges never accumulate.
 * 15 minutes comfortably covers the 5-minute OTP window plus the
 * 10-minute `registrationToken` window that can follow it.
 */
@Schema({ timestamps: true, collection: 'registration_otps' })
export class RegistrationOtp {
  @Prop({ required: true, trim: true, index: true })
  phone: string;

  /**
   * SHA-256 of the 6-digit code. `select: false` keeps it out of every
   * query result unless a caller explicitly asks for it — the same
   * discipline as `User.passwordHash`.
   */
  @Prop({ required: true, select: false })
  otpHash: string;

  /** Wrong guesses so far. Locked out once this reaches MAX_OTP_ATTEMPTS. */
  @Prop({ type: Number, default: 0 })
  attempts: number;

  /** The OTP CODE's own validity window — 5 minutes from creation. */
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  /** Set once `verify-otp` succeeds. A `registrationToken` is only ever issued for a verified record. */
  @Prop({ type: Date, default: null })
  verifiedAt?: Date | null;

  /**
   * Set once `POST /auth/register` succeeds using this record's
   * `requestId`. Makes the `registrationToken` single-use: a second
   * `/auth/register` call presenting the same (still unexpired) token
   * finds `consumedAt` already set and is rejected with 401.
   */
  @Prop({ type: Date, default: null })
  consumedAt?: Date | null;
}

export const RegistrationOtpSchema = SchemaFactory.createForClass(RegistrationOtp);

RegistrationOtpSchema.index({ phone: 1, createdAt: -1 });

// TTL cleanup — see the class comment above for the 15-minute choice.
RegistrationOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 900 });
