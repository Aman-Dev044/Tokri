import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../../common/decorators/current-user.decorator';

/**
 * The refresh-cookie name comes from REFRESH_COOKIE_NAME, not a literal,
 * so renaming the product is an env change. It is also namespaced per
 * brand on purpose: two deployments sharing a parent domain would
 * otherwise overwrite each other's session cookie.
 */
const cookieName = (config: ConfigService) =>
  config.getOrThrow<string>('brand.refreshCookieName');

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The refresh token lives in an httpOnly cookie, never in localStorage.
   * JavaScript cannot read it, so an XSS payload cannot exfiltrate it.
   * The access token is returned in the body and held in memory only.
   */
  private setRefreshCookie(res: Response, token: string) {
    const domain = this.config.getOrThrow<string>('cookie.domain');

    res.cookie(cookieName(this.config), token, {
      httpOnly: true,
      secure: this.config.getOrThrow<boolean>('cookie.secure'),
      sameSite: 'strict',
      // Omit Domain for localhost. `Domain=localhost` is accepted by curl
      // but is a hostname with no dot, which browsers treat inconsistently;
      // a rejected cookie looks exactly like a failed login. Omitting the
      // attribute yields a host-only cookie, which is both stricter and
      // what every browser handles the same way.
      ...(domain === 'localhost' ? {} : { domain }),
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in with email or phone' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.auth.login(dto);
    this.setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate the refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[cookieName(this.config)];
    if (!token) throw new UnauthorizedException('No refresh token');

    const { accessToken, refreshToken } = await this.auth.refresh(token);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the session' })
  async logout(
    @CurrentUser('sub') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(userId);
    res.clearCookie(cookieName(this.config), { path: '/' });
  }

  @Get('me')
  @ApiOperation({ summary: 'Current authenticated user' })
  me(@CurrentUser() user: JwtUser) {
    return this.auth.me(user.sub);
  }

  // ───────────────────────────────────────────────────────────────
  // POST /auth/register — INTENTIONALLY NOT IMPLEMENTED YET.
  // The signup flow is being specified by the product owner
  // (role selection, OTP step, vendor KYC gate). It will be added
  // once that flow is defined, rather than guessed at here.
  // ───────────────────────────────────────────────────────────────
}
