import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DeliveryAssignmentDocument = HydratedDocument<DeliveryAssignment>;

/**
 * The lifecycle of ONE offer to ONE rider (§5.1).
 *
 * `offered` is the only live state; everything else is terminal for that
 * attempt. A new attempt is a NEW document with `attemptNo + 1`, never an
 * update of the old one — the offer history is what tells an operator
 * "four riders were asked and nobody took it" twenty minutes later.
 */
export enum AssignmentStatus {
  OFFERED = 'offered',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

@Schema({ timestamps: true, collection: 'delivery_assignments' })
export class DeliveryAssignment {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId: Types.ObjectId;

  /** The DeliveryPartner `_id` — NOT the rider's User id. */
  @Prop({ type: Types.ObjectId, ref: 'DeliveryPartner', required: true })
  partnerId: Types.ObjectId;

  @Prop({
    type: String,
    enum: AssignmentStatus,
    required: true,
    default: AssignmentStatus.OFFERED,
  })
  status: AssignmentStatus;

  @Prop({ type: Date, required: true })
  offeredAt: Date;

  @Prop({ type: Date, default: null })
  respondedAt?: Date | null;

  /**
   * offeredAt + 45s. The sweeper claims rows past this instant and moves
   * the order to the next rider.
   *
   * NOT a TTL index: an expired offer is evidence, not rubbish. Deleting
   * it would erase the attempt trail that the escalation counts.
   */
  @Prop({ type: Date, required: true })
  expiresAt: Date;

  /** 1-based. Escalation fires once this passes MAX_ASSIGNMENT_ATTEMPTS. */
  @Prop({ type: Number, required: true, default: 1 })
  attemptNo: number;

  /** Set when the rider rejected, so dispatch can see the pattern. */
  @Prop({ type: String, default: null })
  rejectionReason?: string | null;

  /**
   * Proof-of-delivery OTP attempts made by this rider on this order.
   *
   * It lives here rather than on the order because it belongs to the
   * ATTEMPT, not to the order: a redelivery by a second rider starts from
   * zero, and the order schema is shared with five other modules.
   */
  @Prop({ type: Number, required: true, default: 0 })
  otpAttempts: number;

  /**
   * Set once `otpAttempts` reaches the cap. A locked attempt cannot be
   * completed by the rider at all — it needs a human at the console.
   */
  @Prop({ type: Date, default: null })
  otpLockedAt?: Date | null;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const DeliveryAssignmentSchema =
  SchemaFactory.createForClass(DeliveryAssignment);

// ── Indexes ───────────────────────────────────────────────────────────
// { orderId, attemptNo } — "what is the latest attempt on this order?",
//   asked on every offer, rejection and expiry.
// { expiresAt }          — the sweeper's claim query, run every few
//   seconds forever. Without it that is a collection scan per tick.
// { partnerId, status }  — the rider's own pending-offer list.
DeliveryAssignmentSchema.index({ orderId: 1, attemptNo: 1 });
DeliveryAssignmentSchema.index({ expiresAt: 1 });
DeliveryAssignmentSchema.index({ partnerId: 1, status: 1 });
DeliveryAssignmentSchema.index({ isDemo: 1 });
