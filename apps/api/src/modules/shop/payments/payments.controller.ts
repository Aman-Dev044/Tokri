import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Owns } from '../../../common/decorators/owns.decorator';
import { Order } from '../../../database/schemas/order.schema';
import { PaymentStatus } from '../../../common/constants/order-status.enum';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { PaymentsService } from './payments.service';
import { VerifyPaymentDto } from './dto';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  PAYMENTS
 * ════════════════════════════════════════════════════════════════════════
 *
 * Two routes, two very different trust models:
 *
 *   POST /webhooks/razorpay      Public, unauthenticated — Razorpay has no
 *                                session to present. Trust comes entirely
 *                                from the HMAC over the raw body (§8.3).
 *   POST /payments/:orderId/verify   Authenticated customer, ownership
 *                                checked by `ResourceOwnerGuard` via
 *                                `@Owns`. An optimisation on top of the
 *                                webhook, never a substitute for it.
 */
@ApiTags('shop/payments')
@Controller()
@UseInterceptors(AuditInterceptor)
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly payments: PaymentsService) {}

  /**
   * ── Why this is the ONLY other public route in the shop module ────────
   * Razorpay cannot present a bearer token — it is a server-to-server
   * callback from a third party, not a browser session. Every other
   * safeguard normally provided by authentication is provided here
   * instead by the HMAC: `PaymentsService.handleWebhook` verifies it
   * against the RAW request body (never the parsed one — see `main.ts`'s
   * `rawBody: true`) before it trusts a single byte of the payload, and
   * rejects an unverifiable or wrong signature with 401. Nothing here
   * ever reads `req.user`.
   */
  @Public()
  @Post('webhooks/razorpay')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Razorpay payment webhook — the source of truth (§8.3)',
    description:
      'HMAC-verified over the raw body. Always answers 200 for a ' +
      'validly-signed event (even one this platform ignores), because a ' +
      'non-2xx makes Razorpay retry forever; answers 401 only when the ' +
      'signature itself is missing or wrong.',
  })
  @ApiOkResponse({ description: '{ ok: true } — always, once the signature is valid.' })
  @ApiUnauthorizedResponse({ description: 'Missing, unverifiable or invalid signature.' })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
  ): Promise<{ ok: true }> {
    if (!req.rawBody) {
      // `main.ts` sets `rawBody: true` globally; this only fires if that
      // wiring regresses. There is nothing to verify against, so refuse
      // rather than trust an unverifiable payload.
      throw new UnauthorizedException('Raw body unavailable');
    }

    try {
      await this.payments.handleWebhook(req.rawBody, signature);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;

      // A validly-signed event we failed to apply (malformed JSON, an
      // unmapped order, a transient DB error). Logged loudly; answered
      // 200 anyway so Razorpay does not retry the same event forever —
      // the reconciliation sweep (§8.3) is the backstop.
      this.logger.error(
        `Failed to apply a verified Razorpay webhook: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { ok: true };
  }

  @Roles(Role.CUSTOMER)
  @ApiBearerAuth()
  @Owns({ model: Order.name, param: 'orderId', field: 'customerId' })
  @Post('payments/:orderId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Client-side payment confirmation (optimisation only)',
    description:
      'Verifies the Razorpay checkout-sheet signature and applies the ' +
      'same transition the webhook would. A no-op if the webhook already ' +
      'landed. Never the authority — see §8.3.',
  })
  @ApiOkResponse({ description: '{ status: PaymentStatus }' })
  @ApiConflictResponse({ description: '`NOT_ONLINE_PAYMENT` or `ORDER_MISMATCH`.' })
  @ApiUnauthorizedResponse({ description: 'Invalid payment signature.' })
  verify(
    @Param('orderId') orderId: string,
    @Body() dto: VerifyPaymentDto,
  ): Promise<{ status: PaymentStatus }> {
    return this.payments.verifyClientCallback(orderId, dto);
  }
}
