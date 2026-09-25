import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import {
  AuditLog,
  AuditLogDocument,
} from '../../../database/schemas/audit-log.schema';
import { scrub } from '../../../common/filters/all-exceptions.filter';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditContext } from './audit-context';
import { ListAuditLogsQueryDto } from './dto';

export interface AuditRecordInput {
  /** Dotted label, e.g. `vendor.status.update`. */
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Falls back to the actor on the current request. */
  actor?: JwtUser | null;
}

export interface AuditLogResponse {
  id: string;
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  method: string | null;
  path: string | null;
  at: string;
}

type AuditRecord = AuditLog & { _id: Types.ObjectId };

/** Plain-object check that excludes arrays, Dates and ObjectIds. */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;

/**
 * Reduces a before/after pair to only the keys that actually changed.
 *
 * An audit row holding a full copy of both documents is unreadable at
 * review time and, on a collection like `users`, is a second archive of
 * every field the document has ever held.
 */
export function diffObjects(
  before: unknown,
  after: unknown,
): { before: unknown; after: unknown } {
  if (!isPlainObject(before) || !isPlainObject(after)) {
    return { before: before ?? null, after: after ?? null };
  }

  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    beforeDiff[key] = a ?? null;
    afterDiff[key] = b ?? null;
  }

  return { before: beforeDiff, after: afterDiff };
}

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly logs: Model<AuditLogDocument>,
    private readonly context: AuditContext,
  ) {}

  /**
   * Writes one entry. Both sides go through the SAME scrubber the
   * exception filter uses, so a payload containing `password`, `token` or
   * `secret` is redacted before it is persisted.
   *
   * A failure here is logged and swallowed: an audit write must never be
   * the reason a legitimate admin action returns 500 to the operator who
   * just performed it. The log line is the alarm.
   */
  async record(input: AuditRecordInput): Promise<void> {
    const store = this.context.get();
    const actor = input.actor ?? store?.actor ?? null;
    const { before, after } = diffObjects(input.before, input.after);

    try {
      await this.logs.create({
        actorId:
          actor?.sub && Types.ObjectId.isValid(actor.sub)
            ? new Types.ObjectId(actor.sub)
            : null,
        actorRole: actor?.role ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        before: scrub(before),
        after: scrub(after),
        ip: store?.ip ?? null,
        method: store?.method ?? null,
        path: store?.path ?? null,
        at: new Date(),
      });
      this.context.markRecorded();
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry for ${input.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  Reads
  // ──────────────────────────────────────────────────────────────────

  async list(
    query: ListAuditLogsQueryDto,
  ): Promise<Paginated<AuditLogResponse>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<AuditLogDocument> = {};

    if (query.actorId && Types.ObjectId.isValid(query.actorId)) {
      filter.actorId = new Types.ObjectId(query.actorId);
    } else if (query.actorId) {
      // A malformed id matches nothing rather than throwing: this is a
      // filter, not a lookup, and 400ing here only helps a prober.
      filter.actorId = new Types.ObjectId('000000000000000000000000');
    }

    if (query.action) {
      filter.action = { $regex: escapeRegex(query.action), $options: 'i' };
    }
    if (query.entity) filter.entity = query.entity;
    if (query.entityId) filter.entityId = query.entityId;

    if (query.from || query.to) {
      const at: Record<string, Date> = {};
      if (query.from) at.$gte = new Date(query.from);
      if (query.to) at.$lte = new Date(query.to);
      filter.at = at;
    }

    const [data, total] = await Promise.all([
      this.logs
        .find(filter)
        .sort({ at: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AuditRecord[]>()
        .exec(),
      this.logs.countDocuments(filter).exec(),
    ]);

    return paginate(data.map(toResponse), total, page, limit);
  }
}

function toResponse(log: AuditRecord): AuditLogResponse {
  return {
    id: log._id.toString(),
    actorId: log.actorId ? log.actorId.toString() : null,
    actorRole: log.actorRole ?? null,
    action: log.action,
    entity: log.entity,
    entityId: log.entityId ?? null,
    before: log.before ?? null,
    after: log.after ?? null,
    ip: log.ip ?? null,
    method: log.method ?? null,
    path: log.path ?? null,
    at: new Date(log.at).toISOString(),
  };
}
