import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Socket } from 'socket.io';

import { User, UserDocument } from '../../database/schemas/user.schema';
import { Role, UserStatus } from '../../common/constants/roles.enum';

/**
 * The verified identity attached to a socket.
 *
 * Deliberately the same shape as `JwtUser`, and deliberately built the
 * same way: signature first, then a fresh read of the account. A socket
 * lives for hours, so trusting the token's own `role` claim would let a
 * user suspended at 10:00 keep receiving their vendor's orders until
 * they happen to reconnect.
 */
export interface SocketUser {
  sub: string;
  role: Role;
  vendorId?: string;
  tokenId: string;
}

interface AccessTokenPayload {
  sub?: unknown;
  jti?: unknown;
}

@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  /**
   * Resolves the socket's user, or `null` if it has no business being
   * connected at all.
   *
   * `null` is the ONLY failure mode by design — the caller disconnects on
   * it. There is no "connected but unauthenticated" state to get wrong
   * later, which is the whole point of §6.3's first line.
   */
  async authenticate(socket: Socket): Promise<SocketUser | null> {
    const token = extractToken(socket);
    if (!token) return null;

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        // The ACCESS secret. A refresh token must not open a socket:
        // refresh tokens are long-lived and rotate, and accepting one
        // here would hand a stolen cookie a live event feed.
        secret: this.config.getOrThrow<string>('jwt.accessSecret'),
      });
    } catch {
      // Expired, forged, wrong secret, malformed — all the same answer.
      // Telling the client which one is a free oracle.
      return null;
    }

    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) return null;

    const user = await this.users
      .findById(sub)
      .select('role status vendorId')
      .lean()
      .exec();

    if (!user) return null;
    if (user.status !== UserStatus.ACTIVE) {
      this.logger.warn(`Socket refused: account ${sub} is ${user.status}`);
      return null;
    }

    return {
      sub,
      role: user.role,
      vendorId: user.vendorId?.toString(),
      tokenId: typeof payload.jti === 'string' ? payload.jti : '',
    };
  }
}

/**
 * `io(url, { auth: { token } })` first, then a bearer header.
 *
 * The query string is NOT read: it lands in access logs, proxy logs and
 * browser history, and an access token in a log file is a credential in a
 * log file.
 */
function extractToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token.length > 0) {
    return auth.token.replace(/^Bearer\s+/i, '');
  }

  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && /^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '');
  }

  return null;
}
