import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { Role } from '../../common/constants/roles.enum';

export type IssueDocument = HydratedDocument<Issue>;

/** What went wrong. Drives routing and the support queue's filters. */
export enum IssueType {
  DELIVERY_FAILED = 'delivery_failed',
  MISSING_ITEM = 'missing_item',
  DAMAGED = 'damaged',
  LATE = 'late',
  PAYMENT = 'payment',
  REFUND_REQUEST = 'refund_request',
  OTHER = 'other',
}

export enum IssuePriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum IssueStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

/** An issue nobody has finished with yet — the ops queue's numerator. */
export const OPEN_ISSUE_STATUSES: readonly IssueStatus[] = [
  IssueStatus.OPEN,
  IssueStatus.IN_PROGRESS,
];

/**
 * Sort weight for `priority`.
 *
 * Stored alongside the label so a query can order by urgency using an
 * index. Sorting on the string would put `high` after `low` and `normal`
 * above `urgent`, which is precisely backwards for a queue whose whole
 * job is to surface the worst thing first.
 */
export const ISSUE_PRIORITY_RANK: Readonly<Record<IssuePriority, number>> = {
  [IssuePriority.LOW]: 0,
  [IssuePriority.NORMAL]: 1,
  [IssuePriority.HIGH]: 2,
  [IssuePriority.URGENT]: 3,
};

/** One entry in the conversation thread on an issue. */
@Schema({ _id: false })
export class IssueMessage {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  byUserId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  byRole?: Role | null;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({ type: Date, required: true })
  at: Date;
}
export const IssueMessageSchema = SchemaFactory.createForClass(IssueMessage);

/**
 * A customer-support / operations ticket.
 *
 * Deliberately NOT a field on the order: an issue can outlive the order
 * it refers to, can belong to no order at all (a payment query, a vendor
 * complaint), and carries a conversation thread that has nothing to do
 * with the order's own state machine. Embedding it would make every
 * order document grow without bound and put support notes inside the
 * document the settlement pipeline reads.
 */
@Schema({ timestamps: true, collection: 'issues' })
export class Issue {
  /** Human-readable: ISS-20260924-0001. Unique. */
  @Prop({ required: true, trim: true })
  code: string;

  @Prop({ type: Types.ObjectId, ref: 'Order', default: null })
  orderId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  customerId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Vendor', default: null })
  vendorId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'DeliveryPartner', default: null })
  riderId?: Types.ObjectId | null;

  @Prop({ type: String, enum: IssueType, required: true })
  type: IssueType;

  @Prop({
    type: String,
    enum: IssuePriority,
    required: true,
    default: IssuePriority.NORMAL,
  })
  priority: IssuePriority;

  @Prop({
    type: String,
    enum: IssueStatus,
    required: true,
    default: IssueStatus.OPEN,
  })
  status: IssueStatus;

  /** Denormalised `ISSUE_PRIORITY_RANK[priority]`, kept in step by the service. */
  @Prop({ type: Number, required: true, default: 1 })
  priorityRank: number;

  @Prop({ required: true, trim: true })
  subject: string;

  @Prop({ required: true, trim: true })
  description: string;

  /** The admin who owns it. `null` means it is still in the shared queue. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignedToUserId?: Types.ObjectId | null;

  /**
   * What was actually done. Mandatory before `status` may become
   * `resolved` — a resolved ticket with no resolution is indistinguishable
   * from one somebody closed to clear their queue.
   */
  @Prop({ type: String, default: null })
  resolution?: string | null;

  @Prop({ type: Date, default: null })
  resolvedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolvedBy?: Types.ObjectId | null;

  @Prop({ type: [IssueMessageSchema], default: [] })
  messages: IssueMessage[];

  /** Planted by `seed:demo`; the only records `--fresh` will delete. */
  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const IssueSchema = SchemaFactory.createForClass(Issue);

// ── Indexes ───────────────────────────────────────────────────────────
// The queue is always read worst-first, so the compound index carries the
// sort as well as the filter. Without it every refresh of the support
// screen sorts the whole collection in memory.
IssueSchema.index({ status: 1, priorityRank: -1, createdAt: -1 });
IssueSchema.index({ orderId: 1 });
IssueSchema.index({ assignedToUserId: 1, status: 1 });
IssueSchema.index({ code: 1 }, { unique: true });
IssueSchema.index({ isDemo: 1 });
