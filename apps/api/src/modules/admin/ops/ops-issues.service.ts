import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import {
  ISSUE_PRIORITY_RANK,
  Issue,
  IssueDocument,
  IssuePriority,
  IssueStatus,
  IssueType,
} from '../../../database/schemas/issue.schema';
import { Order, OrderDocument } from '../../../database/schemas/order.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  Vendor,
  VendorDocument,
} from '../../../database/schemas/vendor.schema';
import { OrderStatus } from '../../../common/constants/order-status.enum';
import { Role } from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { AuditService } from '../audit/audit.service';
import { escapeRegex } from '../common/dto';
import {
  AddIssueMessageDto,
  CreateIssueDto,
  ListIssuesQueryDto,
  UpdateIssueDto,
} from './dto';

// ── Response shapes ─────────────────────────────────────────────────────

export interface IssueMessageView {
  byUserId: string | null;
  byRole: Role | null;
  body: string;
  at: string;
}

export interface IssueRow {
  id: string;
  code: string;
  type: IssueType;
  priority: IssuePriority;
  status: IssueStatus;
  subject: string;
  orderId: string | null;
  customerId: string | null;
  vendorId: string | null;
  riderId: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  messageCount: number;
  resolvedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface IssueDetail extends IssueRow {
  description: string;
  resolution: string | null;
  resolvedBy: string | null;
  messages: IssueMessageView[];
  order: {
    id: string;
    orderNo: string;
    status: OrderStatus;
    grandTotal: number;
    placedAt: string;
  } | null;
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
  } | null;
  vendor: { id: string; storeName: string } | null;
}

type IssueRecord = Issue & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

const iso = (date?: Date | null): string | null =>
  date ? new Date(date).toISOString() : null;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE SUPPORT QUEUE
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every mutation here is audited, and one invariant is enforced in code
 * rather than left to process: an issue cannot reach `resolved` without a
 * `resolution`. A resolved ticket with an empty resolution is worse than
 * an open one — it looks handled, so nobody looks at it again.
 */
@Injectable()
export class AdminOpsIssuesService {
  /** Allowlist — an arbitrary sort key is attacker-controlled input. */
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'createdAt',
    'updatedAt',
    'priority',
    'status',
    'code',
  ]);

  constructor(
    @InjectModel(Issue.name) private readonly issues: Model<IssueDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Reads
  // ──────────────────────────────────────────────────────────────────

  async list(query: ListIssuesQueryDto): Promise<Paginated<IssueRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<IssueDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.type) filter.type = query.type;
    if (query.assignedToUserId) {
      filter.assignedToUserId = new Types.ObjectId(query.assignedToUserId);
    }
    if (query.from || query.to) {
      const createdAt: Record<string, Date> = {};
      if (query.from) createdAt.$gte = new Date(query.from);
      if (query.to) createdAt.$lte = new Date(query.to);
      filter.createdAt = createdAt;
    }
    if (query.q) {
      const needle = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [
        { code: needle },
        { subject: needle },
        { description: needle },
      ];
    }

    const [docs, total] = await Promise.all([
      this.issues
        .find(filter)
        .sort(this.resolveSort(query.sort))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<IssueRecord[]>()
        .exec(),
      this.issues.countDocuments(filter).exec(),
    ]);

    const assignees = await this.resolveAssignees(docs);

    return paginate(
      docs.map((doc) => toRow(doc, assignees)),
      total,
      page,
      limit,
    );
  }

  async findById(id: string): Promise<IssueDetail> {
    const issue = await this.mustFindLean(id);
    const assignees = await this.resolveAssignees([issue]);

    const [order, customer, vendor] = await Promise.all([
      issue.orderId
        ? this.orders
            .findById(issue.orderId)
            .select('orderNo status pricing.grandTotal placedAt')
            .lean<{
              _id: Types.ObjectId;
              orderNo: string;
              status: OrderStatus;
              pricing?: { grandTotal?: number };
              placedAt: Date;
            } | null>()
            .exec()
        : Promise.resolve(null),
      issue.customerId
        ? this.users
            .findById(issue.customerId)
            .select('name phone email')
            .lean<{
              _id: Types.ObjectId;
              name: string;
              phone: string;
              email?: string;
            } | null>()
            .exec()
        : Promise.resolve(null),
      issue.vendorId
        ? this.vendors
            .findById(issue.vendorId)
            .select('storeName')
            .lean<{ _id: Types.ObjectId; storeName: string } | null>()
            .exec()
        : Promise.resolve(null),
    ]);

    return {
      ...toRow(issue, assignees),
      description: issue.description,
      resolution: issue.resolution ?? null,
      resolvedBy: issue.resolvedBy ? issue.resolvedBy.toString() : null,
      messages: (issue.messages ?? []).map((message) => ({
        byUserId: message.byUserId ? message.byUserId.toString() : null,
        byRole: message.byRole ?? null,
        body: message.body,
        at: new Date(message.at).toISOString(),
      })),
      order: order
        ? {
            id: order._id.toString(),
            orderNo: order.orderNo,
            status: order.status,
            grandTotal: order.pricing?.grandTotal ?? 0,
            placedAt: new Date(order.placedAt).toISOString(),
          }
        : null,
      customer: customer
        ? {
            id: customer._id.toString(),
            name: customer.name,
            phone: customer.phone,
            email: customer.email ?? null,
          }
        : null,
      vendor: vendor
        ? { id: vendor._id.toString(), storeName: vendor.storeName }
        : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Writes
  // ──────────────────────────────────────────────────────────────────

  async create(dto: CreateIssueDto, actor: JwtUser): Promise<IssueDetail> {
    const priority = dto.priority ?? IssuePriority.NORMAL;
    const now = new Date();

    const created = await this.insertWithCode(
      {
        orderId: toObjectIdOrNull(dto.orderId),
        customerId: toObjectIdOrNull(dto.customerId),
        vendorId: toObjectIdOrNull(dto.vendorId),
        riderId: toObjectIdOrNull(dto.riderId),
        type: dto.type,
        priority,
        priorityRank: ISSUE_PRIORITY_RANK[priority],
        status: IssueStatus.OPEN,
        subject: dto.subject,
        description: dto.description,
        assignedToUserId: dto.assignedToUserId
          ? await this.resolveAssignee(dto.assignedToUserId)
          : null,
        resolution: null,
        resolvedAt: null,
        resolvedBy: null,
        messages: [],
        isDemo: false,
      },
      now,
    );

    await this.audit.record({
      action: 'ops.issue.create',
      entity: 'Issue',
      entityId: created._id.toString(),
      before: null,
      after: {
        code: created.code,
        type: created.type,
        priority: created.priority,
        status: created.status,
        subject: created.subject,
      },
      actor,
    });

    return this.findById(created._id.toString());
  }

  /**
   * Merge update. An omitted key keeps its current value.
   *
   * Two rules are enforced here rather than trusted to the client:
   *   · resolving requires a resolution (new or already recorded);
   *   · resolving stamps who did it and when, so the queue's own history
   *     does not depend on the audit collection being readable.
   */
  async update(
    id: string,
    dto: UpdateIssueDto,
    actor: JwtUser,
  ): Promise<IssueDetail> {
    const issue = await this.mustFind(id);

    const before = {
      status: issue.status,
      priority: issue.priority,
      assignedToUserId: issue.assignedToUserId
        ? issue.assignedToUserId.toString()
        : null,
      resolution: issue.resolution ?? null,
    };

    if (dto.resolution !== undefined) issue.resolution = dto.resolution;

    if (dto.priority !== undefined) {
      issue.priority = dto.priority;
      issue.priorityRank = ISSUE_PRIORITY_RANK[dto.priority];
    }

    if (dto.assignedToUserId !== undefined) {
      issue.assignedToUserId = await this.resolveAssignee(dto.assignedToUserId);
    }

    if (dto.status !== undefined && dto.status !== issue.status) {
      if (
        dto.status === IssueStatus.RESOLVED &&
        !issue.resolution?.trim()
      ) {
        throw new BadRequestException(
          'A resolution is required before an issue can be resolved',
        );
      }

      issue.status = dto.status;

      if (dto.status === IssueStatus.RESOLVED) {
        issue.resolvedAt = new Date();
        issue.resolvedBy = toObjectIdOrNull(actor.sub);
      } else if (dto.status === IssueStatus.OPEN) {
        // Reopened: the previous resolution no longer describes the
        // ticket's state, and leaving the stamp on makes a live issue
        // look closed in every list that reads `resolvedAt`.
        issue.resolvedAt = null;
        issue.resolvedBy = null;
      }
    }

    await issue.save();

    await this.audit.record({
      action: 'ops.issue.update',
      entity: 'Issue',
      entityId: id,
      before,
      after: {
        status: issue.status,
        priority: issue.priority,
        assignedToUserId: issue.assignedToUserId
          ? issue.assignedToUserId.toString()
          : null,
        resolution: issue.resolution ?? null,
      },
      actor,
    });

    return this.findById(id);
  }

  async addMessage(
    id: string,
    dto: AddIssueMessageDto,
    actor: JwtUser,
  ): Promise<IssueDetail> {
    const issue = await this.mustFind(id);
    const at = new Date();

    issue.messages.push({
      byUserId: toObjectIdOrNull(actor.sub),
      byRole: actor.role,
      body: dto.body,
      at,
    });

    // A reply on an untouched ticket is the moment somebody picked it up.
    if (issue.status === IssueStatus.OPEN) {
      issue.status = IssueStatus.IN_PROGRESS;
    }

    await issue.save();

    await this.audit.record({
      action: 'ops.issue.message',
      entity: 'Issue',
      entityId: id,
      before: { messageCount: issue.messages.length - 1 },
      after: { messageCount: issue.messages.length, status: issue.status },
      actor,
    });

    return this.findById(id);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────

  /**
   * Allocates the next `ISS-YYYYMMDD-NNNN` and inserts.
   *
   * The code is derived from the highest one already issued today rather
   * than from a count, so a deleted ticket can never cause a reuse. The
   * unique index is the real guarantee: two admins filing at the same
   * instant both compute the same next number and one of them loses the
   * insert, which is why this retries instead of trusting the read.
   */
  private async insertWithCode(
    payload: Omit<Issue, 'code'>,
    now: Date,
  ): Promise<IssueDocument> {
    const day = now.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `ISS-${day}-`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const latest = await this.issues
        .findOne({ code: { $regex: `^${prefix}` } })
        .sort({ code: -1 })
        .select('code')
        .lean<{ code: string } | null>()
        .exec();

      const previous = latest
        ? Number.parseInt(latest.code.slice(prefix.length), 10)
        : 0;
      const next = (Number.isFinite(previous) ? previous : 0) + 1 + attempt;

      try {
        return await this.issues.create({
          ...payload,
          code: `${prefix}${String(next).padStart(4, '0')}`,
        });
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
      }
    }

    throw new BadRequestException(
      'Could not allocate an issue code; please retry',
    );
  }

  /** An empty string returns the ticket to the shared queue. */
  private async resolveAssignee(
    value: string,
  ): Promise<Types.ObjectId | null> {
    if (!value.trim()) return null;
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException('assignedToUserId must be a valid id');
    }

    const user = await this.users
      .findById(value)
      .select('role')
      .lean<{ role: Role } | null>()
      .exec();

    // An issue assigned to a customer or a rider would sit in a queue
    // that account can never open.
    if (!user || (user.role !== Role.ADMIN && user.role !== Role.SUPER_ADMIN)) {
      throw new BadRequestException(
        'An issue can only be assigned to an admin account',
      );
    }

    return new Types.ObjectId(value);
  }

  private async resolveAssignees(
    docs: IssueRecord[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Map(
        docs
          .map((doc) => doc.assignedToUserId)
          .filter((id): id is Types.ObjectId => Boolean(id))
          .map((id) => [id.toString(), id]),
      ).values(),
    ];
    if (ids.length === 0) return new Map();

    const users = await this.users
      .find({ _id: { $in: ids } })
      .select('name')
      .lean<{ _id: Types.ObjectId; name: string }[]>()
      .exec();

    return new Map(users.map((user) => [user._id.toString(), user.name]));
  }

  private async mustFind(id: string): Promise<IssueDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Issue not found');
    }
    const issue = await this.issues.findById(id).exec();
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  private async mustFindLean(id: string): Promise<IssueRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Issue not found');
    }
    const issue = await this.issues
      .findById(id)
      .lean<IssueRecord | null>()
      .exec();
    if (!issue) throw new NotFoundException('Issue not found');
    return issue;
  }

  /** `priority` sorts by RANK, never by the label. See the schema note. */
  private resolveSort(requested?: string): Record<string, 1 | -1> {
    if (!requested) return { priorityRank: -1, createdAt: -1 };

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!AdminOpsIssuesService.SORTABLE.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[...AdminOpsIssuesService.SORTABLE].join(', ')}`,
      );
    }

    const key = field === 'priority' ? 'priorityRank' : field;
    return { [key]: desc ? -1 : 1 };
  }
}

function toRow(
  issue: IssueRecord,
  assignees: Map<string, string>,
): IssueRow {
  const assignedToUserId = issue.assignedToUserId
    ? issue.assignedToUserId.toString()
    : null;

  return {
    id: issue._id.toString(),
    code: issue.code,
    type: issue.type,
    priority: issue.priority,
    status: issue.status,
    subject: issue.subject,
    orderId: issue.orderId ? issue.orderId.toString() : null,
    customerId: issue.customerId ? issue.customerId.toString() : null,
    vendorId: issue.vendorId ? issue.vendorId.toString() : null,
    riderId: issue.riderId ? issue.riderId.toString() : null,
    assignedToUserId,
    assignedToName: assignedToUserId
      ? (assignees.get(assignedToUserId) ?? null)
      : null,
    messageCount: issue.messages?.length ?? 0,
    resolvedAt: iso(issue.resolvedAt),
    createdAt: iso(issue.createdAt),
    updatedAt: iso(issue.updatedAt),
  };
}

const toObjectIdOrNull = (value?: string): Types.ObjectId | null =>
  value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null;

/** Mongo duplicate-key error, without reaching for `any`. */
function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 11000
  );
}
