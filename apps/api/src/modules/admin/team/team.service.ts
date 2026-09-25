import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  PLATFORM_ROLES,
  Role,
  UserStatus,
} from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { UsersService } from '../../users/users.service';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { AuditService } from '../audit/audit.service';
import { escapeRegex } from '../common/dto';
import {
  CreateTeamMemberDto,
  ListTeamQueryDto,
  UpdateTeamStatusDto,
} from './dto';

export interface TeamMemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  role: Role;
  status: UserStatus;
  isSystemAccount: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

type TeamRecord = User & { _id: Types.ObjectId; createdAt?: Date };

/**
 * Platform staff administration.
 *
 * ── Division of labour ──────────────────────────────────────────────────
 * READS are local: the team view spans both ADMIN and SUPER_ADMIN, which
 * `UsersService.list` cannot express (it filters on a single role).
 *
 * WRITES are delegated to `UsersService` without exception. That is where
 * the invariants already live — no self-modification, no SUPER_ADMIN
 * through the API, seeded system accounts immutable, refresh-token family
 * cleared on suspension. A second copy of those rules here is a second
 * copy to keep correct, and the copy that drifts is the one that lets
 * somebody suspend the last remaining admin.
 */
@Injectable()
export class AdminTeamService {
  private static readonly SORTABLE: ReadonlySet<string> = new Set([
    'createdAt',
    'name',
    'status',
    'lastLoginAt',
  ]);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListTeamQueryDto): Promise<Paginated<TeamMemberRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<UserDocument> = {
      role: { $in: PLATFORM_ROLES },
    };
    if (query.status) filter.status = query.status;
    if (query.q) {
      const needle = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: needle }, { email: needle }, { phone: needle }];
    }

    const sort = this.resolveSort(query.sort);

    const [rows, total] = await Promise.all([
      this.users
        .find(filter)
        // passwordHash and the token fields are `select: false` on the
        // schema; this projection is the second, explicit barrier.
        .select('name email phone role status isSystemAccount lastLoginAt createdAt')
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<TeamRecord[]>()
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);

    return paginate(rows.map(toRow), total, page, limit);
  }

  /**
   * Provisions an ADMIN. The role is hard-coded here, not taken from the
   * body, and `UsersService.create` rejects SUPER_ADMIN a second time
   * regardless of what it is handed.
   */
  async create(
    dto: CreateTeamMemberDto,
    actor: JwtUser,
  ): Promise<UserResponseDto> {
    const created = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      password: dto.password,
      role: Role.ADMIN,
    });

    await this.audit.record({
      action: 'team.create',
      entity: 'User',
      entityId: created.id,
      before: null,
      // The password is not here, and would be redacted by the scrubber
      // even if a future edit put it in the payload by mistake.
      after: {
        name: created.name,
        email: created.email,
        phone: created.phone,
        role: created.role,
      },
      actor,
    });

    return created;
  }

  async updateStatus(
    id: string,
    dto: UpdateTeamStatusDto,
    actor: JwtUser,
  ): Promise<UserResponseDto> {
    const before = await this.usersService.findById(id);

    const updated = await this.usersService.updateStatus(
      id,
      { status: dto.status, reason: dto.reason },
      actor,
    );

    await this.audit.record({
      action: 'team.status.update',
      entity: 'User',
      entityId: id,
      before: { status: before.status },
      after: { status: updated.status, reason: dto.reason ?? null },
      actor,
    });

    return updated;
  }

  async remove(id: string, actor: JwtUser): Promise<void> {
    const before = await this.usersService.findById(id);

    await this.usersService.remove(id, actor);

    await this.audit.record({
      action: 'team.delete',
      entity: 'User',
      entityId: id,
      before: {
        name: before.name,
        email: before.email,
        role: before.role,
        status: before.status,
      },
      after: null,
      actor,
    });
  }

  private resolveSort(requested?: string): Record<string, 1 | -1> {
    if (!requested) return { createdAt: -1 };

    const desc = requested.startsWith('-');
    const field = desc ? requested.slice(1) : requested;

    if (!AdminTeamService.SORTABLE.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[...AdminTeamService.SORTABLE].join(', ')}`,
      );
    }
    return { [field]: desc ? -1 : 1 };
  }
}

function toRow(user: TeamRecord): TeamMemberRow {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email ?? null,
    phone: user.phone,
    role: user.role,
    status: user.status,
    isSystemAccount: user.isSystemAccount,
    lastLoginAt: user.lastLoginAt
      ? new Date(user.lastLoginAt).toISOString()
      : null,
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
  };
}
