import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { UserStatus } from '../../../common/constants/roles.enum';
import { JwtUser } from '../../../common/decorators/current-user.decorator';

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
      .select('role status vendorId')
      .lean();

    if (!user) throw new UnauthorizedException('Account no longer exists');
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is ${user.status}`);
    }

    return {
      sub: payload.sub,
      // Role is read from the DATABASE, not the token, so a privilege
      // change takes effect at once.
      role: user.role,
      vendorId: user.vendorId?.toString(),
      tokenId: payload.jti,
    };
  }
}
