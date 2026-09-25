import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { User, UserDocument } from '../../database/schemas/user.schema';
import {
  PLATFORM_ROLES,
  Role,
  UserStatus,
} from '../../common/constants/roles.enum';
import { JwtUser } from '../../common/decorators/current-user.decorator';
import { PasswordService } from '../../common/utils/password.service';
import { Paginated, paginate } from '../../common/dto/paginated';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserResponseDto } from './dto/user-response.dto';

/**
 * `timestamps: true` on the schema adds these, but the decorated class does
 * not declare them, so the generated document type does not know about them.
 */
type UserRecord = User & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

/** Mongo duplicate-key error, without importing the `mongodb` package. */
const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;

/**
 * Escapes regex metacharacters so a search term is matched literally.
 * Without this, `q=.*` returns the whole collection and
 * `q=(a+)+$` is a ReDoS against the database process.
 */
const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  /**
   * Sorting is an allowlist, never pass-through. An arbitrary sort key is
   * attacker-controlled input that can order results by a field the caller
   * is not allowed to read (e.g. `passwordHash`), which leaks it one bit
   * at a time.
   */
  private static readonly SORTABLE_FIELDS: ReadonlySet<string> = new Set([
    'createdAt',
    'name',
    'role',
    'status',
    'lastLoginAt',
  ]);

  private static readonly DEFAULT_SORT = '-createdAt';

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly passwords: PasswordService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Serialisation
  // ──────────────────────────────────────────────────────────────────

  /**
   * Explicit projection — see `UserResponseDto`. `passwordHash`,
   * `refreshTokenHash` and `refreshTokenFamily` are `select: false` on the
   * schema AND absent from this mapping: two independent barriers.
   */
  private toResponse(user: UserRecord): UserResponseDto {
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email ?? null,
      phone: user.phone,
      role: user.role,
      status: user.status,
      vendorId: user.vendorId ? user.vendorId.toString() : null,
      lastLoginAt: user.lastLoginAt
        ? new Date(user.lastLoginAt).toISOString()
        : null,
      isSystemAccount: user.isSystemAccount,
      createdAt: user.createdAt
        ? new Date(user.createdAt).toISOString()
        : new Date(0).toISOString(),
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Reads
  // ──────────────────────────────────────────────────────────────────

  /**
   * Throws 404 for a malformed id as well as a missing one. A distinct
   * "invalid id format" 400 tells a prober which id shapes exist.
   */
  async findById(id: string): Promise<UserResponseDto> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('User not found');

    const user = await this.users.findById(id).lean<UserRecord | null>().exec();
    if (!user) throw new NotFoundException('User not found');

    return this.toResponse(user);
  }

  /**
   * Identity lookup used by the auth flow.
   *
   * Returns the raw document (not a response DTO) because the caller needs
   * `passwordHash`, which is `select: false` and must be asked for
   * explicitly via `withPassword`.
   */
  async findByEmailOrPhone(
    identifier: string,
    options: { withPassword?: boolean } = {},
  ): Promise<UserDocument | null> {
    const needle = identifier.trim().toLowerCase();
    const filter: FilterQuery<UserDocument> = needle.includes('@')
      ? { email: needle }
      : { phone: needle };

    const query = this.users.findOne(filter);
    if (options.withPassword) query.select('+passwordHash');

    return query.exec();
  }

  /**
   * `GET /users` — paginated, filtered, and always bounded by `limit`.
   */
  async list(query: ListUsersQueryDto): Promise<Paginated<UserResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<UserDocument> = {};
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    if (query.q) {
      const needle = new RegExp(escapeRegex(query.q), 'i');
      filter.$or = [{ name: needle }, { email: needle }, { phone: needle }];
    }

    const sort = this.resolveSort(query.sort);

    // countDocuments + find run concurrently; the total is needed for
    // `meta.pages` and there is no dependency between them.
    const [data, total] = await Promise.all([
      this.users
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<UserRecord[]>()
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);

    return paginate(
      data.map((user) => this.toResponse(user)),
      total,
      page,
      limit,
    );
  }

  private resolveSort(requested?: string): string {
    if (!requested) return UsersService.DEFAULT_SORT;

    const field = requested.startsWith('-') ? requested.slice(1) : requested;
    if (!UsersService.SORTABLE_FIELDS.has(field)) {
      throw new BadRequestException(
        `sort must be one of: ${[...UsersService.SORTABLE_FIELDS].join(', ')}`,
      );
    }
    return requested;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Writes
  // ──────────────────────────────────────────────────────────────────

  /**
   * Provisions an account. Reachable only by SUPER_ADMIN (§ users.controller).
   *
   * The password is hashed with argon2id + the environment pepper before it
   * touches the database; the plaintext never leaves this method.
   */
  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    if (dto.role === Role.SUPER_ADMIN) {
      // The super-admin is a bootstrap identity provisioned by the seed
      // script from `.env`. Letting the API mint another one would create
      // an unauditable path to the highest privilege in the platform.
      throw new ForbiddenException(
        'SUPER_ADMIN accounts cannot be created through the API',
      );
    }

    const needsVendor = dto.role === Role.VENDOR || dto.role === Role.DELIVERY;
    if (needsVendor && !dto.vendorId) {
      throw new BadRequestException(
        `vendorId is required for ${dto.role} accounts — it is the tenant scope`,
      );
    }
    if (!needsVendor && dto.vendorId) {
      throw new BadRequestException(
        `vendorId must not be set for ${dto.role} accounts`,
      );
    }

    await this.assertIdentityAvailable(dto.email, dto.phone);

    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const created = await this.users.create({
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: dto.role,
        // Status is DERIVED, never accepted from the request body. A vendor
        // must be approved before it can trade.
        status: dto.role === Role.VENDOR ? UserStatus.PENDING : UserStatus.ACTIVE,
        vendorId: dto.vendorId ? new Types.ObjectId(dto.vendorId) : null,
        isSystemAccount: false,
      });

      this.logger.log(`Created ${dto.role} account ${created._id.toString()}`);
      return this.toResponse(created.toObject<UserRecord>());
    } catch (error) {
      // The pre-check above loses to a concurrent insert; the unique index
      // is the actual guarantee, so translate its error rather than 500.
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('Email or phone already registered');
      }
      throw error;
    }
  }

  private async assertIdentityAvailable(
    email: string | undefined,
    phone: string,
  ): Promise<void> {
    const clauses: FilterQuery<UserDocument>[] = [{ phone }];
    if (email) clauses.push({ email });

    const existing = await this.users
      .findOne({ $or: clauses })
      .select('_id')
      .lean()
      .exec();

    if (existing) {
      throw new ConflictException('Email or phone already registered');
    }
  }

  /**
   * `PATCH /users/:id/status` — activate / suspend / mark pending.
   *
   * Three invariants, all enforced here rather than in the controller so
   * they hold for every future caller of this service:
   *
   *  1. Nobody changes their OWN status. Self-suspension is a support
   *     ticket; self-reactivation would undo a suspension imposed on you.
   *  2. Only SUPER_ADMIN may change the status of a platform account
   *     (ADMIN / SUPER_ADMIN). Otherwise one compromised ADMIN session can
   *     suspend every other admin and take sole control of the platform.
   *  3. Seeded system accounts are immutable through the API — they are
   *     the break-glass identities.
   */
  async updateStatus(
    id: string,
    dto: UpdateUserStatusDto,
    actor: JwtUser,
  ): Promise<UserResponseDto> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('User not found');

    if (id === actor.sub) {
      throw new ForbiddenException('You cannot change your own account status');
    }

    const target = await this.users.findById(id).exec();
    if (!target) throw new NotFoundException('User not found');

    if (
      PLATFORM_ROLES.includes(target.role) &&
      actor.role !== Role.SUPER_ADMIN
    ) {
      throw new ForbiddenException(
        'Only a SUPER_ADMIN may change the status of a platform account',
      );
    }

    if (target.isSystemAccount) {
      throw new ForbiddenException(
        'System accounts cannot be modified through the API',
      );
    }

    if (target.status === dto.status) {
      return this.toResponse(target.toObject<UserRecord>());
    }

    target.status = dto.status;

    // Suspension must take effect immediately, not in fifteen minutes.
    // Clearing the refresh family kills the session on the next rotation,
    // and `JwtStrategy.validate` re-reads `status` on every single request,
    // so the live access token stops working on its next use.
    if (dto.status !== UserStatus.ACTIVE) {
      target.refreshTokenHash = null;
      target.refreshTokenFamily = null;
    }

    await target.save();

    this.logger.warn(
      `User ${id} status → ${dto.status} by ${actor.role} ${actor.sub}` +
        (dto.reason ? ` (reason: ${dto.reason})` : ''),
    );

    return this.toResponse(target.toObject<UserRecord>());
  }

  /**
   * Hard delete — SUPER_ADMIN only (§ users.controller).
   *
   * Suspension is the normal operational action; deletion exists for
   * mistakenly-provisioned accounts and data-erasure requests.
   */
  async remove(id: string, actor: JwtUser): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('User not found');

    if (id === actor.sub) {
      throw new ForbiddenException('You cannot delete your own account');
    }

    const target = await this.users.findById(id).select('role isSystemAccount').exec();
    if (!target) throw new NotFoundException('User not found');

    if (target.isSystemAccount) {
      throw new ForbiddenException(
        'System accounts cannot be deleted through the API',
      );
    }

    await this.users.deleteOne({ _id: target._id }).exec();
    this.logger.warn(`User ${id} deleted by ${actor.role} ${actor.sub}`);
  }
}
