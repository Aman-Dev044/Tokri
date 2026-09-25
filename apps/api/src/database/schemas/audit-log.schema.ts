import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { Role } from '../../common/constants/roles.enum';

export type AuditLogDocument = HydratedDocument<AuditLog>;

/**
 * Who did what, to which document, and what it looked like before.
 *
 * `before` / `after` are Mixed, because the shape differs per entity, and
 * both are passed through the SAME secret scrubber the exception filter
 * uses before they are written. An audit trail that quietly archives
 * password hashes and tokens is a second copy of the credential store.
 */
@Schema({ timestamps: false, collection: 'audit_logs' })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  actorId?: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  actorRole?: Role | null;

  /** Human-readable label, e.g. `vendor.status.update`. */
  @Prop({ required: true, trim: true })
  action: string;

  /** Collection/entity name, e.g. `Vendor`. */
  @Prop({ required: true, trim: true })
  entity: string;

  @Prop({ type: String, default: null })
  entityId?: string | null;

  @Prop({ type: SchemaTypes.Mixed, default: null })
  before?: unknown;

  @Prop({ type: SchemaTypes.Mixed, default: null })
  after?: unknown;

  @Prop({ type: String, default: null })
  ip?: string | null;

  @Prop({ type: String, default: null })
  method?: string | null;

  @Prop({ type: String, default: null })
  path?: string | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  at: Date;

  @Prop({ type: Boolean, default: false })
  isDemo: boolean;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ at: -1 });
AuditLogSchema.index({ actorId: 1, at: -1 });
AuditLogSchema.index({ entity: 1, entityId: 1, at: -1 });
AuditLogSchema.index({ action: 1, at: -1 });
AuditLogSchema.index({ isDemo: 1 });
