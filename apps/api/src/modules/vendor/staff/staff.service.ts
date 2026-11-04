import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { User, UserDocument } from '../../../database/schemas/user.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../../database/schemas/vendor.schema';
import { Role, UserStatus } from '../../../common/constants/roles.enum';
import {
  ALL_PERMISSIONS,
  Permission,
  STAFF_PRESETS,
  StaffRole,
  normalisePermissions,
  permissionsForProfile,
} from '../../../common/constants/permissions';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { Paginated, paginate } from '../../../common/dto/paginated';
import { PasswordService } from '../../../common/utils/password.service';
import { AuditService } from '../../admin/audit/audit.service';
import { escapeRegex, iso, isDuplicateKeyError } from '../common/dto';
import { scopeId } from '../common/vendor-scope.decorator';
import {
  CreateStaffDto,
  ListStaffQueryDto,
  UpdateStaffDto,
  UpdateStaffStatusDto,
} from './dto';

export interface StaffRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  staffRole: StaffRole;
  /** The EFFECTIVE set — what the guard will actually allow. */
  permissions: Permission[];
  shiftLabel: string | null;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** `GET /vendor/me` — who is signed in, and what the panel may draw. */
export interface StoreMe {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  isOwner: boolean;
  staffRole: StaffRole | null;
  shiftLabel: string | null;
  permissions: Permission[];
  store: {
    id: string;
    name: string;
    slug: string;
    isOpen: boolean;
    status: VendorStatus;
  };
}

/** `GET /vendor/staff/roles` — the catalogue the edit screen renders. */
export interface StaffCatalogue {
  permissions: Permission[];
  presets: Record<Exclude<StaffRole, StaffRole.CUSTOM>, Permission[]>;
  /** What the CALLER may grant — the ceiling of any checklist they see. */
  grantable: Permission[];
}

interface StaffRecord {
  _id: Types.ObjectId;
  name: string;
  phone: string;
  email?: string | null;
  role: Role;
  status: UserStatus;
  vendorId?: Types.ObjectId | null;
  staffProfile?: {
    staffRole: StaffRole;
    permissions?: string[];
    shiftLabel?: string | null;
  } | null;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Only these fields ever leave the users collection through this service. */
const STAFF_FIELDS =
  'name phone email role status vendorId staffProfile lastLoginAt createdAt updatedAt';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE STORE'S OWN STAFF
 * ════════════════════════════════════════════════════════════════════════
 *
 * A staff member is ONE `User` document: `role: STAFF`, the store's
 * `vendorId`, and a `staffProfile`. See `StaffProfile` in user.schema.ts
 * for why that is one document rather than a second collection.
 *
 * ── The rules a manager cannot get round ────────────────────────────────
 *  1. You cannot grant what you do not hold. The resulting effective set
 *     must be a subset of the caller's own — the owner holds everything,
 *     so only the owner can hand out `earnings.view`.
 *  2. You cannot act on someone who holds more than you, so a manager
 *     cannot demote, suspend or delete a CUSTOM colleague the owner gave
 *     extra access.
 *  3. You cannot edit yourself, and nobody edits the owner here.
 *
 * Every lookup carries `{ vendorId: scope, role: STAFF }`, so another
 * store's staff member is a 404, never a 403.
 */
@Injectable()
export class VendorStaffService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  // ──────────────────────────────────────────────────────────────────
  //  Who am I
  // ──────────────────────────────────────────────────────────────────

  async me(vendorScope: string, actor: JwtUser): Promise<StoreMe> {
    const [user, vendor] = await Promise.all([
      this.users
        .findOne({ _id: actor.sub, vendorId: scopeId(vendorScope) })
        .select(STAFF_FIELDS)
        .lean<StaffRecord | null>()
        .exec(),
      this.vendors
        .findById(scopeId(vendorScope))
        .select('storeName slug isOpen status')
        .lean<{
          _id: Types.ObjectId;
          storeName: string;
          slug: string;
          isOpen: boolean;
          status: VendorStatus;
        } | null>()
        .exec(),
    ]);

    if (!user || !vendor) throw new NotFoundException('Store not found');

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email ?? null,
      phone: user.phone ?? null,
      role: user.role,
      isOwner: user.role === Role.VENDOR,
      staffRole: user.staffProfile?.staffRole ?? null,
      shiftLabel: user.staffProfile?.shiftLabel ?? null,
      // The SAME resolution the guard used for this request.
      permissions: [...(actor.permissions ?? [])],
      store: {
        id: vendor._id.toString(),
        name: vendor.storeName,
        slug: vendor.slug,
        isOpen: vendor.isOpen,
        status: vendor.status,
      },
    };
  }

  catalogue(actor: JwtUser): StaffCatalogue {
    const presets = Object.fromEntries(
      Object.entries(STAFF_PRESETS).map(([key, list]) => [key, [...list]]),
    ) as StaffCatalogue['presets'];

    return {
      permissions: [...ALL_PERMISSIONS],
      presets,
      grantable: [...(actor.permissions ?? [])],
    };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Read
  // ──────────────────────────────────────────────────────────────────

  async list(
    vendorScope: string,
    query: ListStaffQueryDto,
  ): Promise<Paginated<StaffRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const filter: FilterQuery<UserDocument> = {
      vendorId: scopeId(vendorScope),
      role: Role.STAFF,
    };
    if (query.status) filter.status = query.status;
    if (query.q) {
      const needle = escapeRegex(query.q);
      filter.$or = [
        { name: { $regex: needle, $options: 'i' } },
        { phone: { $regex: needle, $options: 'i' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.users
        .find(filter)
        .select(STAFF_FIELDS)
        .sort({ createdAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<StaffRecord[]>()
        .exec(),
      this.users.countDocuments(filter).exec(),
    ]);

    return paginate(rows.map(toStaffRow), total, page, limit);
  }

  async findOne(vendorScope: string, id: string): Promise<StaffRow> {
    return toStaffRow(await this.mustFindLean(vendorScope, id));
  }

  // ──────────────────────────────────────────────────────────────────
  //  Write
  // ──────────────────────────────────────────────────────────────────

  async create(
    vendorScope: string,
    dto: CreateStaffDto,
    actor: JwtUser,
  ): Promise<StaffRow> {
    const permissions = this.resolveGrant(dto.staffRole, dto.permissions, actor);

    // Outside any database work: argon2id is tens of milliseconds of CPU.
    const passwordHash = await this.passwords.hash(dto.password);

    let createdId: Types.ObjectId;
    try {
      const created = await this.users.create({
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: Role.STAFF,
        status: UserStatus.ACTIVE,
        // Tenancy from the verified JWT — never from the request body.
        vendorId: scopeId(vendorScope),
        staffProfile: {
          staffRole: dto.staffRole,
          permissions,
          shiftLabel: dto.shiftLabel ?? null,
          createdBy: new Types.ObjectId(actor.sub),
        },
      });
      createdId = created._id;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'That phone number or email already belongs to an account',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'vendor.staff.create',
      entity: 'User',
      entityId: createdId.toString(),
      before: null,
      // No password, not even its length. The audit trail is read by
      // people investigating incidents; it is not a credential archive.
      after: {
        name: dto.name,
        phone: dto.phone,
        staffRole: dto.staffRole,
        permissions,
        shiftLabel: dto.shiftLabel ?? null,
      },
      actor,
    });

    return this.findOne(vendorScope, createdId.toString());
  }

  async update(
    vendorScope: string,
    id: string,
    dto: UpdateStaffDto,
    actor: JwtUser,
  ): Promise<StaffRow> {
    const target = await this.mustFindEditable(vendorScope, id, actor);
    const profile = target.staffProfile;
    if (!profile) throw new NotFoundException('Staff member not found');

    const before = {
      name: target.name,
      email: target.email ?? null,
      staffRole: profile.staffRole,
      permissions: permissionsForProfile(profile),
      shiftLabel: profile.shiftLabel ?? null,
    };

    const roleChanging =
      dto.staffRole !== undefined || dto.permissions !== undefined;

    if (roleChanging) {
      const nextRole = dto.staffRole ?? profile.staffRole;
      // Switching TO a preset with no list is the normal case; keeping
      // CUSTOM and sending only a list is the other. Both resolve here.
      const nextList =
        dto.permissions ??
        (nextRole === StaffRole.CUSTOM && profile.staffRole === StaffRole.CUSTOM
          ? normalisePermissions(profile.permissions ?? [])
          : undefined);
      profile.permissions = this.resolveGrant(nextRole, nextList, actor);
      profile.staffRole = nextRole;
    }

    if (dto.shiftLabel !== undefined) profile.shiftLabel = dto.shiftLabel;
    if (dto.name !== undefined) target.name = dto.name;
    if (dto.email !== undefined) target.email = dto.email;
    target.markModified('staffProfile');

    try {
      await target.save();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('That email already belongs to an account');
      }
      throw error;
    }

    await this.audit.record({
      action: 'vendor.staff.update',
      entity: 'User',
      entityId: id,
      before,
      after: {
        name: target.name,
        email: target.email ?? null,
        staffRole: profile.staffRole,
        permissions: permissionsForProfile(profile),
        shiftLabel: profile.shiftLabel ?? null,
      },
      actor,
    });

    return this.findOne(vendorScope, id);
  }

  /**
   * Suspend or reinstate.
   *
   * Suspension clears the refresh-token family, exactly as
   * `UsersService.updateStatus` does, and `JwtStrategy` re-reads `status`
   * on every request — so the live access token stops on its next use
   * and no refresh can mint another.
   */
  async setStatus(
    vendorScope: string,
    id: string,
    dto: UpdateStaffStatusDto,
    actor: JwtUser,
  ): Promise<StaffRow> {
    const target = await this.mustFindEditable(vendorScope, id, actor);
    const before = { status: target.status };

    await this.users
      .updateOne(
        { _id: target._id, vendorId: scopeId(vendorScope), role: Role.STAFF },
        {
          $set: { status: dto.status },
          ...(dto.status === UserStatus.ACTIVE
            ? {}
            : { $unset: { refreshTokenFamily: '', refreshTokenHash: '' } }),
        },
      )
      .exec();

    await this.audit.record({
      action: 'vendor.staff.status',
      entity: 'User',
      entityId: id,
      before,
      after: { status: dto.status, reason: dto.reason ?? null },
      actor,
    });

    return this.findOne(vendorScope, id);
  }

  /**
   * Hard delete. Nothing references a staff member by id in a way that
   * would orphan: a POS sale snapshots the cashier's NAME, and audit
   * entries keep `actorId` as a historical fact.
   */
  async remove(
    vendorScope: string,
    id: string,
    actor: JwtUser,
  ): Promise<void> {
    const target = await this.mustFindEditable(vendorScope, id, actor);

    await this.users
      .deleteOne({
        _id: target._id,
        vendorId: scopeId(vendorScope),
        role: Role.STAFF,
      })
      .exec();

    await this.audit.record({
      action: 'vendor.staff.delete',
      entity: 'User',
      entityId: id,
      before: {
        name: target.name,
        phone: target.phone,
        staffRole: target.staffProfile?.staffRole ?? null,
      },
      after: null,
      actor,
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  Rules
  // ──────────────────────────────────────────────────────────────────

  /**
   * The effective set a write would confer, after the escalation check.
   *
   * A preset with a list attached is refused rather than silently
   * ignored: the caller believed the list meant something.
   */
  private resolveGrant(
    staffRole: StaffRole,
    requested: readonly Permission[] | undefined,
    actor: JwtUser,
  ): Permission[] {
    let next: Permission[];

    if (staffRole === StaffRole.CUSTOM) {
      next = normalisePermissions(requested ?? []);
      if (next.length === 0) {
        throw new BadRequestException(
          'A CUSTOM role needs at least one permission',
        );
      }
    } else {
      if (requested !== undefined) {
        throw new BadRequestException(
          `${staffRole} is a preset — permissions are only sent for CUSTOM`,
        );
      }
      next = normalisePermissions(STAFF_PRESETS[staffRole]);
    }

    this.assertCanGrant(next, actor);
    return next;
  }

  private assertCanGrant(wanted: readonly Permission[], actor: JwtUser): void {
    if (actor.role === Role.VENDOR) return;

    const held = new Set(actor.permissions ?? []);
    const beyond = wanted.filter((permission) => !held.has(permission));
    if (beyond.length > 0) {
      throw new ForbiddenException(
        `You cannot grant a permission you do not hold: ${beyond.join(', ')}`,
      );
    }
  }

  /**
   * A STAFF document of THIS store that the caller is allowed to change.
   *
   * The owner is named explicitly (403) rather than falling through to a
   * 404, because "you cannot edit the owner" is the true answer and the
   * caller already knows the owner exists — they work for them.
   */
  private async mustFindEditable(
    vendorScope: string,
    id: string,
    actor: JwtUser,
  ): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Staff member not found');
    }

    if (id === actor.sub) {
      throw new ForbiddenException('You cannot change your own staff account');
    }

    const target = await this.users
      .findOne({
        _id: new Types.ObjectId(id),
        vendorId: scopeId(vendorScope),
        role: { $in: [Role.STAFF, Role.VENDOR] },
      })
      .exec();

    if (!target) throw new NotFoundException('Staff member not found');

    if (target.role === Role.VENDOR) {
      throw new ForbiddenException('The store owner cannot be changed here');
    }

    if (actor.role !== Role.VENDOR) {
      const held = new Set(actor.permissions ?? []);
      const theirs = permissionsForProfile(target.staffProfile);
      if (theirs.some((permission) => !held.has(permission))) {
        throw new ForbiddenException(
          'This staff member has access you do not hold — ask the owner',
        );
      }
    }

    return target;
  }

  private async mustFindLean(
    vendorScope: string,
    id: string,
  ): Promise<StaffRecord> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Staff member not found');
    }

    const row = await this.users
      .findOne({
        _id: new Types.ObjectId(id),
        vendorId: scopeId(vendorScope),
        role: Role.STAFF,
      })
      .select(STAFF_FIELDS)
      .lean<StaffRecord | null>()
      .exec();

    if (!row) throw new NotFoundException('Staff member not found');
    return row;
  }
}

export function toStaffRow(row: StaffRecord): StaffRow {
  return {
    id: row._id.toString(),
    name: row.name,
    phone: row.phone,
    email: row.email ?? null,
    staffRole: row.staffProfile?.staffRole ?? StaffRole.CUSTOM,
    permissions: permissionsForProfile(row.staffProfile),
    shiftLabel: row.staffProfile?.shiftLabel ?? null,
    status: row.status,
    lastLoginAt: iso(row.lastLoginAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}
