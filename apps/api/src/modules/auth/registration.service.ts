import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { createHash, randomInt } from 'node:crypto';

import { User, UserDocument } from '../../database/schemas/user.schema';
import { Role, UserStatus } from '../../common/constants/roles.enum';
import { PasswordService } from '../../common/utils/password.service';
import {
  RegistrationOtp,
  RegistrationOtpDocument,
} from './schemas/registration-otp.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../database/schemas/vendor.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
} from '../../database/schemas/delivery-partner.schema';
import { Setting, SettingDocument } from '../../database/schemas/setting.schema';
import { point } from '../../database/schemas/geo-point';
import { AuthService } from './auth.service';
import { RegisterDto, RequestOtpDto, VerifyOtpDto } from './dto/register.dto';
import { ApplyVendorDto } from './dto/apply-vendor.dto';
import { ApplyRiderDto } from './dto/apply-rider.dto';

// ── OTP policy ────────────────────────────────────────────────────────────
const OTP_TTL_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 3;
const RESEND_COOLDOWN_SECONDS = 60;

// ── registrationToken policy ────────────────────────────────────────────
const REGISTRATION_TOKEN_TTL = '10m';
const REGISTRATION_TOKEN_TTL_SECONDS = 600;
/** Distinguishes this token from an access/refresh token signed with the same secret — see the class comment below. */
const REGISTRATION_TOKEN_PURPOSE = 'registration';

/**
 * Business default for a vendor application's commission, mirroring
 * `AdminSettingsService`'s own `DEFAULTS.defaultCommissionPct`. Not
 * imported from there directly — `AdminSettingsService` lives in
 * `AdminModule`, outside this module's scope, and the settings
 * COLLECTION (read directly below) is the actual source of truth either
 * way. If the admin-side default ever changes, this constant should move
 * with it.
 */
const DEFAULT_COMMISSION_PCT = 12;
const COMMISSION_SETTING_KEY = 'defaultCommissionPct';

/** Mongo duplicate-key error, without importing the `mongodb` package. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/** Lowercase, hyphenated, ASCII-safe, capped so a suffix always fits. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface RegistrationTokenPayload {
  requestId: string;
  phone: string;
  purpose: string;
}

export interface RequestOtpResult {
  requestId: string;
  expiresInSec: number;
  /**
   * The OTP itself, ONLY when `NODE_ENV !== 'production'`.
   *
   * SMS delivery is not wired up yet — there is nowhere else for a
   * developer or a tester to read the code from. The field is genuinely
   * ABSENT (not `null`) in production: `RegistrationController` never even
   * sets the key, so `JSON.stringify` never emits it, and no test or log
   * scrubber has to remember to strip it. This must never survive to a
   * production deployment.
   */
  devOtp?: string;
}

export interface VerifyOtpResult {
  registrationToken: string;
  expiresInSec: number;
}

export interface RegisteredAccount {
  user: {
    id: string;
    name: string;
    email?: string;
    phone: string;
    role: Role;
    vendorId: string | null;
  };
  accessToken: string;
  refreshToken: string;
}

export interface ApplicationResult {
  applicationId: string;
  status: 'pending';
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  SIGNUP — the one thing the API could not do until now
 * ════════════════════════════════════════════════════════════════════════
 *
 * Three separate flows, one service:
 *
 *  • CUSTOMER  — phone verified by OTP BEFORE a password ever exists.
 *                request-otp → verify-otp → register. The middle step
 *                trades a verified phone for a short-lived
 *                `registrationToken`; the final step cannot accept a bare
 *                phone number, only that token, so it is IMPOSSIBLE to
 *                create an account for a phone you do not control.
 *
 *  • VENDOR    — applies in one call, but the account CANNOT log in until
 *                an admin approves it (`User.status` and `Vendor.status`
 *                both start PENDING; `AuthService.login` already rejects
 *                anything but ACTIVE).
 *
 *  • RIDER     — same shape as VENDOR, but joins the shared platform pool
 *                (`DeliveryPartner.vendorId: null`) rather than a store.
 *
 * ── No user enumeration ──────────────────────────────────────────────────
 * `requestOtp` behaves identically whether or not the phone already has an
 * account — same response shape, same timing profile, same cooldown rule.
 * The only place a phone collision is ever revealed is the FINAL step of
 * each flow, as a generic 409, by which point the caller has proven they
 * control the phone (customer: via OTP) or has already handed over a
 * password anyway (vendor/rider). Revealing it there is not an oracle —
 * it is simply "you already have an account."
 */
@Injectable()
export class RegistrationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(RegistrationOtp.name)
    private readonly otps: Model<RegistrationOtpDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(Setting.name) private readonly settings: Model<SettingDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
  ) {}

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** A cryptographically random 6-digit code, zero-padded. */
  private generateOtp(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  private accessSecret(): string {
    return this.config.getOrThrow<string>('jwt.accessSecret');
  }

  // ────────────────────────────────────────────────────────────────────
  //  Customer — step 1: request-otp
  // ────────────────────────────────────────────────────────────────────

  /**
   * Issues (or refuses to re-issue, within the cooldown) an OTP for a
   * phone number.
   *
   * Deliberately does NOT check whether a `User` already exists for this
   * phone — that check happens only at the final `register` step. Doing
   * it here would turn "how fast did request-otp respond / did it
   * succeed" into a way to test whether a given number is registered.
   */
  async requestOtp(dto: RequestOtpDto): Promise<RequestOtpResult> {
    const phone = dto.phone;

    const latest = await this.otps
      .findOne({ phone })
      .sort({ createdAt: -1 })
      .select('createdAt')
      .lean<{ createdAt: Date } | null>()
      .exec();

    if (latest?.createdAt) {
      const elapsedMs = Date.now() - latest.createdAt.getTime();
      if (elapsedMs < RESEND_COOLDOWN_SECONDS * 1000) {
        throw new HttpException(
          'Please wait before requesting another OTP',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const otp = this.generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

    const record = await this.otps.create({
      phone,
      otpHash: this.sha256(otp),
      attempts: 0,
      expiresAt,
    });

    const isProd = this.config.getOrThrow<string>('env') === 'production';

    return {
      requestId: record._id.toString(),
      expiresInSec: OTP_TTL_MINUTES * 60,
      // Spread, not a `null`/`undefined` assignment: the key must be
      // genuinely ABSENT from the object in production, not present with
      // an empty value — see the field's doc comment on `RequestOtpResult`.
      ...(isProd ? {} : { devOtp: otp }),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Customer — step 2: verify-otp
  // ────────────────────────────────────────────────────────────────────

  async verifyOtp(dto: VerifyOtpDto): Promise<VerifyOtpResult> {
    const invalid = new BadRequestException('Invalid or expired OTP request');
    const locked = new BadRequestException(
      'Too many incorrect attempts. Request a new OTP.',
    );

    if (!Types.ObjectId.isValid(dto.requestId)) throw invalid;

    const record = await this.otps
      .findById(dto.requestId)
      .select('+otpHash')
      .exec();

    if (!record || record.phone !== dto.phone) throw invalid;
    if (record.consumedAt) throw invalid; // already spent on an account
    if (record.expiresAt.getTime() < Date.now()) throw invalid;
    if (record.attempts >= MAX_OTP_ATTEMPTS) throw locked;

    const presented = this.sha256(dto.otp);
    if (presented !== record.otpHash) {
      record.attempts += 1;
      await record.save();
      throw record.attempts >= MAX_OTP_ATTEMPTS ? locked : invalid;
    }

    record.verifiedAt = new Date();
    await record.save();

    const payload: RegistrationTokenPayload = {
      requestId: record._id.toString(),
      phone: record.phone,
      purpose: REGISTRATION_TOKEN_PURPOSE,
    };

    const registrationToken = await this.jwt.signAsync(payload, {
      secret: this.accessSecret(),
      expiresIn: REGISTRATION_TOKEN_TTL,
    });

    return { registrationToken, expiresInSec: REGISTRATION_TOKEN_TTL_SECONDS };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Customer — step 3: register
  // ────────────────────────────────────────────────────────────────────

  /**
   * `registrationToken` is signed with the SAME secret as an access
   * token (`jwt.accessSecret`) — no new required environment variable —
   * but it is never confusable with one: its payload carries
   * `{ requestId, phone, purpose: 'registration' }`, not `{ sub, role,
   * jti }`. Even an attacker who presented it as a Bearer token would
   * fail in `JwtStrategy.validate`, which calls
   * `this.users.findById(payload.sub)` — `sub` is `undefined` here, so
   * the lookup fails closed.
   */
  async register(dto: RegisterDto): Promise<RegisteredAccount> {
    const invalidToken = new UnauthorizedException(
      'Invalid or expired registration token',
    );

    let payload: RegistrationTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RegistrationTokenPayload>(
        dto.registrationToken,
        { secret: this.accessSecret() },
      );
    } catch {
      throw invalidToken;
    }

    if (
      payload.purpose !== REGISTRATION_TOKEN_PURPOSE ||
      !Types.ObjectId.isValid(payload.requestId)
    ) {
      throw invalidToken;
    }

    const session = await this.connection.startSession();
    let created: UserDocument | null = null;

    try {
      await session.withTransaction(async () => {
        // Re-read and re-check INSIDE the transaction: this is what makes
        // the token single-use under concurrent replay, not just under a
        // single sequential replay. Two simultaneous `/auth/register`
        // calls with the same token can only have one of them observe
        // `consumedAt: null` and win the race.
        const record = await this.otps
          .findById(payload.requestId)
          .session(session)
          .exec();

        if (
          !record ||
          record.phone !== payload.phone ||
          !record.verifiedAt ||
          record.consumedAt
        ) {
          throw invalidToken;
        }

        const [user] = await this.users.create(
          [
            {
              name: dto.name,
              email: dto.email,
              phone: record.phone,
              passwordHash: await this.passwords.hash(dto.password),
              role: Role.CUSTOMER,
              status: UserStatus.ACTIVE,
            },
          ],
          { session },
        );

        record.consumedAt = new Date();
        await record.save({ session });

        created = user;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('An account with this phone number already exists');
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (!created) throw new ConflictException('Registration did not complete');
    const user = created as UserDocument;

    const tokens = await this.auth.issueTokens(user);

    return {
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        vendorId: null,
      },
      ...tokens,
    };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Vendor application
  // ────────────────────────────────────────────────────────────────────

  private async defaultCommissionPct(): Promise<number> {
    const row = await this.settings
      .findOne({ key: COMMISSION_SETTING_KEY })
      .lean<{ value: unknown } | null>()
      .exec();
    return typeof row?.value === 'number' ? row.value : DEFAULT_COMMISSION_PCT;
  }

  /**
   * Creates `User(role=VENDOR, status=PENDING)` and `Vendor(status=
   * 'pending')` together, in one transaction — a crash between the two
   * would otherwise leave either an unusable login or an orphaned store
   * record, and either way the phone/email is now stuck as "taken."
   *
   * `commissionPct` is read from platform settings, never from the
   * applicant — a vendor choosing their own commission is a
   * privilege-escalation bug, not a feature.
   */
  async applyVendor(dto: ApplyVendorDto): Promise<ApplicationResult> {
    const passwordHash = await this.passwords.hash(dto.password);
    const commissionPct = await this.defaultCommissionPct();

    // Generated up front so `User.vendorId` and `Vendor._id` can point at
    // each other without a second write, and so the slug can be made
    // unique without a retry loop.
    const vendorId = new Types.ObjectId();
    const slug = `${slugify(dto.storeName)}-${vendorId.toString().slice(-6)}`;

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const [user] = await this.users.create(
          [
            {
              name: dto.name,
              email: dto.email,
              phone: dto.phone,
              passwordHash,
              role: Role.VENDOR,
              status: UserStatus.PENDING,
              vendorId,
            },
          ],
          { session },
        );

        await this.vendors.create(
          [
            {
              _id: vendorId,
              ownerId: user._id,
              storeName: dto.storeName,
              slug,
              address: dto.address,
              location: point(dto.lng, dto.lat),
              commissionPct,
              status: VendorStatus.PENDING,
            },
          ],
          { session },
        );
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'That phone number or email already belongs to an account',
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    return { applicationId: vendorId.toString(), status: 'pending' };
  }

  // ────────────────────────────────────────────────────────────────────
  //  Rider application
  // ────────────────────────────────────────────────────────────────────

  /**
   * Creates `User(role=DELIVERY, status=PENDING)` and
   * `DeliveryPartner(vendorId: null, status='pending')` together. `null`
   * is what makes this the shared PLATFORM pool rather than a store's own
   * roster — a vendor's own riders are created by
   * `VendorPartnersService.create` instead, with `vendorId` stamped from
   * the creating store's JWT, and that flow is not touched or duplicated
   * here.
   */
  async applyRider(dto: ApplyRiderDto): Promise<ApplicationResult> {
    const passwordHash = await this.passwords.hash(dto.password);

    const session = await this.connection.startSession();
    let partnerId: Types.ObjectId | null = null;

    try {
      await session.withTransaction(async () => {
        const [user] = await this.users.create(
          [
            {
              name: dto.name,
              email: dto.email,
              phone: dto.phone,
              passwordHash,
              role: Role.DELIVERY,
              status: UserStatus.PENDING,
              vendorId: null,
            },
          ],
          { session },
        );

        const [partner] = await this.partners.create(
          [
            {
              userId: user._id,
              vendorId: null,
              vehicleType: dto.vehicleType,
              isAvailable: false,
              isOnline: false,
              status: PartnerStatus.PENDING,
            },
          ],
          { session },
        );

        partnerId = partner._id;
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'That phone number or email already belongs to an account',
        );
      }
      throw error;
    } finally {
      await session.endSession();
    }

    if (!partnerId) throw new ConflictException('Application did not complete');
    return { applicationId: String(partnerId), status: 'pending' };
  }
}
