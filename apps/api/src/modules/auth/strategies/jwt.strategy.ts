import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { Vendor, VendorDocument, VendorStatus } from '../../../database/schemas/vendor.schema';
import { Role, UserStatus } from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { permissionsFor } from '../../../common/constants/permissions';

interface AccessTokenPayload {
  sub: string;
  role: JwtUser['role'];
  vendorId?: string;
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  /**
   * Re-checks the account on every request. A signature alone is not
   * enough: a user suspended thirty seconds ago must stop working
   * immediately, not when their 15-minute token happens to expire.
   */
  async validate(payload: AccessTokenPayload): Promise<JwtUser> {
    const user = await this.users
      .findById(payload.sub)
      .select('name role status vendorId staffProfile')
      .lean();

    if (!user) throw new UnauthorizedException('Account no longer exists');
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is ${user.status}`);
    }

    // Staff work FOR a store, so they stop when it does. Suspending a store
    // locks its owner's login; without this its employees carried on
    // billing and packing under a store the platform had shut.
    if (user.role === Role.STAFF) {
      const store = user.vendorId
        ? await this.vendors.findById(user.vendorId).select('status').lean()
        : null;
      if (!store || store.status !== VendorStatus.APPROVED) {
        throw new UnauthorizedException('This store is not active');
      }
    }

    return {
      sub: payload.sub,
      // Role is read from the DATABASE, not the token, so a privilege
      // change takes effect at once.
      role: user.role,
      vendorId: user.vendorId?.toString(),
      tokenId: payload.jti,
      // Same query, same reasoning as `role`: a permission revoked a
      // second ago is gone on this request. The token never carries them.
      permissions: permissionsFor(user.role, user.staffProfile),
      staffRole: user.staffProfile?.staffRole ?? null,
      name: user.name,
    };
  }
}
