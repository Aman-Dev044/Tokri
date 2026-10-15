import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Role } from '../../common/constants/roles.enum';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../../common/decorators/current-user.decorator';
import { Paginated } from '../../common/dto/paginated';
import { WalletTopupStatus } from '../../database/schemas/wallet-topup.schema';
import { DeliveryService } from './delivery.service';
import {
  VerifyWalletTopupDto,
  WalletLedgerQueryDto,
  WalletTopupDto,
} from './dto';
import { RiderWalletService } from './rider-wallet.service';
import { WalletTopupService } from './wallet-topup.service';
import { WalletLedgerRow, WalletSummary, WalletTopupResponse } from './types';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE RIDER WALLET API
 * ════════════════════════════════════════════════════════════════════════
 *
 * `@Roles(Role.DELIVERY)` on the CONTROLLER, so it covers every route in
 * it — including the next one somebody adds. Not one route is `@Public()`.
 *
 * Like the rest of the rider surface, NO route takes a rider id. The
 * partner is resolved from the verified token every time, so there is no
 * identifier on this whole surface for a caller to tamper with and no way
 * to read or spend another rider's balance. The one route that does take
 * an id — a top-up attempt — filters on the caller's partner id in the
 * same query that loads it, and answers 404 when it is not theirs.
 */
@ApiTags('delivery/wallet')
@ApiBearerAuth()
@Controller('delivery/wallet')
@Roles(Role.DELIVERY)
@ApiForbiddenResponse({
  description: 'The caller is authenticated but is not a delivery partner.',
})
export class RiderWalletController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly wallet: RiderWalletService,
    private readonly topups: WalletTopupService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Balance, lifetime totals and the low-balance threshold',
    description:
      'Every money field is INTEGER PAISE. `lowBalance` is computed on the ' +
      'server against `RIDER_LOW_BALANCE_WARN_PAISE` — the client is never ' +
      'asked to hold a second copy of a server-side threshold. ' +
      '`pickFeeMinPaise`/`pickFeeMaxPaise` are the bounds the per-order ' +
      'fee is drawn from, so the app can state the cost honestly before ' +
      'the rider commits. The wallet is created at zero on first read.',
  })
  @ApiOkResponse({ description: 'The wallet summary.' })
  async summary(@CurrentUser() user: JwtUser): Promise<WalletSummary> {
    const partner = await this.delivery.requirePartner(user);
    return this.wallet.summary(partner);
  }

  @Get('transactions')
  @ApiOperation({
    summary: 'The ledger, newest first',
    description:
      'Paginated `{ data, meta }`. `amountPaise` is SIGNED — positive ' +
      'credits, negative debits — and `balanceAfterPaise` is the stored ' +
      'running balance at the instant the row was written, so the ledger ' +
      'can be reconciled rather than merely read.',
  })
  async transactions(
    @CurrentUser() user: JwtUser,
    @Query() query: WalletLedgerQueryDto,
  ): Promise<Paginated<WalletLedgerRow>> {
    const partner = await this.delivery.requirePartner(user);
    return this.wallet.transactions(partner._id, query);
  }

  @Post('topup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Open a gateway order to add money',
    description:
      'Returns `{ topupId, amountPaise, gatewayOrder }`. Returns 503 ' +
      '`PAYMENT_PROVIDER_NOT_CONFIGURED` while Razorpay has no keys — ' +
      'which is the case on this deployment — and writes NOTHING in that ' +
      'case, so there is no orphan attempt and no fabricated success. An ' +
      'administrator can credit the wallet in the meantime.',
  })
  @ApiServiceUnavailableResponse({
    description: 'PAYMENT_PROVIDER_NOT_CONFIGURED.',
  })
  async topup(
    @CurrentUser() user: JwtUser,
    @Body() dto: WalletTopupDto,
  ): Promise<WalletTopupResponse> {
    const partner = await this.delivery.requirePartner(user);
    return this.topups.createTopup(user, partner, dto);
  }

  /**
   * `:orderId` is the TOP-UP attempt's id — the `topupId` returned by the
   * call above — not an Order id and not the gateway's order id. The
   * param keeps the spelling the contract fixed so the two verify
   * endpoints in the platform read alike.
   */
  @Post('topup/:orderId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a top-up from the gateway callback',
    description:
      'The same three fields and the same HMAC path as ' +
      '`POST /payments/:orderId/verify`. The amount credited comes from ' +
      'the STORED attempt, never from the request body. Idempotent: a ' +
      'second call on a paid attempt moves no money and reports the same ' +
      'balance.',
  })
  @ApiNotFoundResponse({ description: 'No such top-up, or not this rider\'s.' })
  @ApiConflictResponse({ description: 'TOPUP_NOT_PENDING or ORDER_MISMATCH.' })
  @ApiUnauthorizedResponse({ description: 'Invalid payment signature.' })
  async verifyTopup(
    @CurrentUser() user: JwtUser,
    @Param('orderId') orderId: string,
    @Body() dto: VerifyWalletTopupDto,
  ): Promise<{ status: WalletTopupStatus; balancePaise: number }> {
    const partner = await this.delivery.requirePartner(user);
    return this.topups.verifyTopup(user, partner, orderId, dto);
  }
}
