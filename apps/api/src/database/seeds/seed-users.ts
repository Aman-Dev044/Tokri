import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Role, UserStatus } from '../../common/constants/roles.enum';
import { PasswordService } from '../../common/utils/password.service';
import { User, UserDocument } from '../schemas/user.schema';

/** What the seeder was asked to plant. Never contains a password. */
export interface SeedAccountSpec {
  label: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
}

export type SeedOutcome = 'created' | 'skipped' | 'password-reset';

export interface SeedResult {
  label: string;
  email: string;
  role: Role;
  outcome: SeedOutcome;
}

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY = 11000;

@Injectable()
export class SeedUsersService {
  private readonly logger = new Logger('Seed');

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
  ) {}

  /**
   * Creates the two bootstrap platform accounts.
   *
   * Idempotent: running it a second time reports "skipped" and changes
   * nothing. With `force`, the two accounts' passwords are reset to the
   * current `.env` values (and their refresh-token families revoked),
   * which is the supported recovery path when someone forgets one.
   */
  async run(force: boolean): Promise<SeedResult[]> {
    const specs: SeedAccountSpec[] = [
      {
        label: 'SUPER_ADMIN',
        name: this.config.getOrThrow<string>('seed.superAdmin.name'),
        email: this.config.getOrThrow<string>('seed.superAdmin.email'),
        phone: this.config.getOrThrow<string>('seed.superAdmin.phone'),
        role: Role.SUPER_ADMIN,
      },
      {
        label: 'ADMIN',
        name: this.config.getOrThrow<string>('seed.admin.name'),
        email: this.config.getOrThrow<string>('seed.admin.email'),
        phone: this.config.getOrThrow<string>('seed.admin.phone'),
        role: Role.ADMIN,
      },
    ];

    this.assertDistinct(specs);

    const results: SeedResult[] = [];
    for (const spec of specs) {
      results.push(await this.seedOne(spec, force));
    }
    return results;
  }

  /**
   * Two accounts sharing an email or a phone would collide on the unique
   * indexes and leave the seed half-applied. Catch it before writing.
   */
  private assertDistinct(specs: SeedAccountSpec[]): void {
    const [a, b] = specs;
    if (a.email.toLowerCase() === b.email.toLowerCase()) {
      throw new Error(
        'SEED_SUPERADMIN_EMAIL and SEED_ADMIN_EMAIL are the same address. ' +
          'The two bootstrap accounts must be distinct.',
      );
    }
    if (a.phone === b.phone) {
      throw new Error(
        'SEED_SUPERADMIN_PHONE and SEED_ADMIN_PHONE are the same number. ' +
          'The two bootstrap accounts must be distinct.',
      );
    }
  }

  private async seedOne(
    spec: SeedAccountSpec,
    force: boolean,
  ): Promise<SeedResult> {
    const email = spec.email.toLowerCase().trim();
    const phone = spec.phone.trim();

    // Match on email OR phone: both carry a unique index, so an account
    // that already owns either one will reject the insert. Looking only
    // at the email would turn a phone clash into a crash.
    const existing = await this.userModel
      .findOne({ $or: [{ email }, { phone }] })
      .select('_id email role')
      .lean()
      .exec();

    if (existing) {
      if (!force) {
        return {
          label: spec.label,
          email,
          role: spec.role,
          outcome: 'skipped',
        };
      }

      await this.userModel
        .updateOne(
          { _id: existing._id },
          {
            $set: {
              name: spec.name,
              email,
              phone,
              // Hashed with the app's own PasswordService — same argon2id
              // parameters, same pepper — so the reset password works at
              // /auth/login immediately.
              passwordHash: await this.hashFor(spec),
              role: spec.role,
              status: UserStatus.ACTIVE,
              isSystemAccount: true,
              vendorId: null,
              // A password change must invalidate outstanding sessions,
              // or the old credential keeps living in a refresh token.
              refreshTokenFamily: null,
              refreshTokenHash: null,
            },
          },
        )
        .exec();

      return {
        label: spec.label,
        email,
        role: spec.role,
        outcome: 'password-reset',
      };
    }

    try {
      await this.userModel.create({
        name: spec.name,
        email,
        phone,
        passwordHash: await this.hashFor(spec),
        role: spec.role,
        status: UserStatus.ACTIVE,
        vendorId: null,
        refreshTokenFamily: null,
        refreshTokenHash: null,
        lastLoginAt: null,
        isSystemAccount: true,
      });

      return { label: spec.label, email, role: spec.role, outcome: 'created' };
    } catch (err: unknown) {
      // Lost a race with a concurrent seed run. The account exists, which
      // is exactly the state we wanted — not a failure.
      if (this.isDuplicateKey(err)) {
        this.logger.warn(
          `${spec.label}: another process created this account concurrently.`,
        );
        return {
          label: spec.label,
          email,
          role: spec.role,
          outcome: 'skipped',
        };
      }
      throw err;
    }
  }

  /**
   * Reads the plaintext password from validated config and returns only
   * its hash. The plaintext is never returned, logged or stored on `this`.
   */
  private hashFor(spec: SeedAccountSpec): Promise<string> {
    const key =
      spec.role === Role.SUPER_ADMIN
        ? 'seed.superAdmin.password'
        : 'seed.admin.password';
    return this.passwords.hash(this.config.getOrThrow<string>(key));
  }

  private isDuplicateKey(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: unknown }).code === DUPLICATE_KEY
    );
  }
}
