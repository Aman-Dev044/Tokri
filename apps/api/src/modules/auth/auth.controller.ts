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
import { authThrottle } from '../../config/throttle';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { isIP } from 'node:net';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto, RequestOtpDto, VerifyOtpDto } from './dto/register.dto';
import { ApplyVendorDto } from './dto/apply-vendor.dto';
import { ApplyRiderDto } from './dto/apply-rider.dto';
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
    private readonly registration: RegistrationService,
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
      // The same holds for a bare IP: some browsers reject a Domain
      // attribute naming an IP, and host-only is what an IP needs anyway.
      ...(domain === 'localhost' || isIP(domain) ? {} : { domain }),
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // The ONE throttle on this controller that is an operations knob rather
  // than a fixed security decision, so it is the one that reads the
  // environment (THROTTLE_AUTH_LIMIT). See `src/config/throttle.ts` for
  // why it has to be a function and not a number.
  @Throttle({ default: authThrottle() })
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

  // ═══════════════════════════════════════════════════════════════
  //  SIGNUP
  //
  //  Three independent flows — see RegistrationService for the full
  //  design rationale (no user enumeration, single-use registration
  //  token, why vendor/rider applications start PENDING).
  //
  //  There is deliberately NO admin/super-admin self-signup route.
  //  Nothing here ever reads a `role` off a request body — every DTO
  //  hardcodes the role it creates, and `ValidationPipe`'s
  //  `forbidNonWhitelisted: true` turns any attempt to smuggle one in
  //  (`{ role: 'admin' }`) into a 400.
  // ═══════════════════════════════════════════════════════════════

  @Public()
  @Post('register/request-otp')
  @HttpCode(HttpStatus.OK)
  // The hardest-throttled route in the API: this is the one an attacker
  // would use to spam SMS costs or brute-force-probe phone numbers.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a 6-digit OTP to verify a phone number for signup' })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.registration.requestOtp(dto);
  }

  @Public()
  @Post('register/verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify the OTP and receive a short-lived registrationToken' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.registration.verifyOtp(dto);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Complete customer signup with a verified registrationToken' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refreshToken, ...rest } = await this.registration.register(dto);
    this.setRefreshCookie(res, refreshToken);
    return rest;
  }

  @Public()
  @Post('apply/vendor')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Apply to become a vendor (pending admin approval)' })
  applyVendor(@Body() dto: ApplyVendorDto) {
    return this.registration.applyVendor(dto);
  }

  @Public()
  @Post('apply/rider')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Apply to become a platform-pool delivery rider (pending admin approval)' })
  applyRider(@Body() dto: ApplyRiderDto) {
    return this.registration.applyRider(dto);
  }
}
