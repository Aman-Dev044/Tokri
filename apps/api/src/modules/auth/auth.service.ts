import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { User, UserDocument } from '../../database/schemas/user.schema';
import { Role, UserStatus } from '../../common/constants/roles.enum';
import { Vendor, VendorDocument, VendorStatus } from '../../database/schemas/vendor.schema';
import { PasswordService } from '../../common/utils/password.service';
import { LoginDto } from './dto/login.dto';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
  ) {}

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  async login(dto: LoginDto) {
    const isEmail = dto.identifier.includes('@');
    const user = await this.users
      .findOne(
        isEmail ? { email: dto.identifier } : { phone: dto.identifier },
      )
      .select('+passwordHash');

    // One generic message for "no such user" AND "wrong password".
    // Distinguishing them turns the login form into a user enumeration
    // oracle: an attacker learns which emails are registered.
    const invalid = new UnauthorizedException('Invalid credentials');

    if (!user) {
      // Spend comparable time even when the user does not exist, so
      // response timing does not reveal account existence either.
      await this.passwords.hash(dto.password);
      throw invalid;
    }

    const ok = await this.passwords.verify(user.passwordHash, dto.password);
    if (!ok) throw invalid;

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is ${user.status}`);
    }

    // The same rule JwtStrategy applies per request, refused up front so a
    // store's staff are not handed a session that fails on its first call.
    if (user.role === Role.STAFF) {
      const store = user.vendorId
        ? await this.vendors.findById(user.vendorId).select('status').lean()
        : null;
      if (!store || store.status !== VendorStatus.APPROVED) {
        throw new UnauthorizedException('This store is not active');
      }
    }

    const tokens = await this.issueTokens(user);

    user.lastLoginAt = new Date();
    await user.save();

    return {
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        // Included so the login response matches GET /auth/me. Omitting it
        // left a vendor client without its tenant id until a second call.
        vendorId: user.vendorId?.toString() ?? null,
      },
      ...tokens,
    };
  }

  /**
   * Issues an access/refresh pair and starts (or continues) a token family.
   * The refresh token is stored only as a SHA-256 hash, so a database leak
   * does not hand an attacker usable session tokens.
   *
   * Public (not `private`) so `RegistrationService` can log a brand-new
   * account straight in after signup, without duplicating the token
   * machinery or the refresh-token-family bookkeeping.
   */
  async issueTokens(
    user: UserDocument,
    // Explicitly `string`: an inferred default from randomUUID() narrows the
    // parameter to a UUID template-literal type, which a family id read back
    // off a decoded token cannot satisfy.
    family: string = randomUUID(),
  ): Promise<TokenPair> {
    const jti = randomUUID();

    const accessToken = await this.jwt.signAsync(
      {
        sub: user._id.toString(),
        role: user.role,
        vendorId: user.vendorId?.toString(),
        jti,
      },
      {
        secret: this.config.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: this.config.getOrThrow<string>('jwt.accessTtl'),
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user._id.toString(), family, jti },
      {
        secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: this.config.getOrThrow<string>('jwt.refreshTtl'),
      },
    );

    await this.users.updateOne(
      { _id: user._id },
      {
        refreshTokenFamily: family,
        refreshTokenHash: this.sha256(refreshToken),
      },
    );

    return { accessToken, refreshToken };
  }

  /**
   * Refresh rotation WITH REUSE DETECTION.
   *
   * Each refresh mints a new token and invalidates the previous one. If a
   * token that has already been used is presented, the whole family is
   * revoked and everyone — legitimate user and thief alike — is logged
   * out. That is what makes a stolen refresh token useless: the thief's
   * first use locks the account, and the real user notices immediately.
   */
  async refresh(token: string) {
    let payload: { sub: string; family: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.users
      .findById(payload.sub)
      .select('+refreshTokenHash +refreshTokenFamily');

    if (!user) throw new UnauthorizedException('Invalid refresh token');

    const presented = this.sha256(token);

    if (user.refreshTokenHash !== presented) {
      // Replay detected — revoke the entire family.
      this.logger.warn(
        `Refresh token reuse detected for user ${user._id.toString()}. Family revoked.`,
      );
      await this.users.updateOne(
        { _id: user._id },
        { refreshTokenHash: null, refreshTokenFamily: null },
      );
      throw new UnauthorizedException('Session revoked — please sign in again');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is ${user.status}`);
    }

    return this.issueTokens(user, payload.family);
  }

  async logout(userId: string) {
    await this.users.updateOne(
      { _id: userId },
      { refreshTokenHash: null, refreshTokenFamily: null },
    );
  }

  async me(userId: string) {
    const user = await this.users.findById(userId).lean();
    if (!user) throw new UnauthorizedException();
    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      vendorId: user.vendorId?.toString() ?? null,
    };
  }
}
