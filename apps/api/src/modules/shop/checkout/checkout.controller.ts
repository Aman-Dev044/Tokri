import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Idempotent } from '../../../common/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../common/interceptors/idempotency.interceptor';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { CheckoutQuote, CheckoutService, PlacedOrder } from './checkout.service';
import { PlaceOrderDto, ValidateCheckoutDto } from './dto';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  CHECKOUT
 * ════════════════════════════════════════════════════════════════════════
 *
 * Neither endpoint accepts a price, a total or a line item. The basket is
 * read from the cart collection and re-priced from the product collection
 * on the server. A number in a request body is a number the customer
 * typed, and none of them reach the order.
 */
@ApiTags('shop/checkout')
@ApiBearerAuth()
@Controller('checkout')
@Roles(Role.CUSTOMER)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Re-price and re-check the basket without placing anything',
    description:
      'Returns the server-side total, the live per-line flags, whether ' +
      'the address is inside the store\'s delivery radius, whether COD ' +
      'is available at this amount, and an `issues[]` list. ' +
      '`checkoutReady` is true only when `issues` is empty.',
  })
  validate(
    @CurrentUser() user: JwtUser,
    @Body() dto: ValidateCheckoutDto,
  ): Promise<CheckoutQuote> {
    return this.checkout.validate(user.sub, dto);
  }

  /**
   * ── Why the key is REQUIRED here and almost nowhere else ──────────────
   * This is the one endpoint that reserves stock, burns a coupon and
   * creates a financial record. A customer double-tapping "Place order",
   * or a phone that retries after the response was lost, must not produce
   * two orders and two stock reservations. `IdempotencyInterceptor` takes
   * the unique index on the key as a lock BEFORE the handler runs, and
   * replays the stored response afterwards.
   */
  @Post()
  @Idempotent('checkout.place')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'REQUIRED. 8–128 chars of [A-Za-z0-9._:-] — a UUID is ideal. A ' +
      'retry with the same key replays the first response instead of ' +
      'placing a second order.',
  })
  @ApiOperation({
    summary: 'Place the order',
    description:
      'Reserves stock atomically (§8.2), re-prices server-side, and ' +
      'creates the order as PLACED with a commission snapshot and a ' +
      'hashed delivery OTP — all in one transaction. The plaintext OTP ' +
      'is in the response EXACTLY ONCE and is never readable again.',
  })
  @ApiCreatedResponse({ description: '{ order, deliveryOtp, payment }' })
  @ApiBadRequestResponse({
    description: 'Missing Idempotency-Key, or an invalid coupon code.',
  })
  @ApiConflictResponse({
    description:
      '`OUT_OF_STOCK` (with productId), `STORE_CLOSED`, ' +
      '`OUT_OF_SERVICE_AREA`, `COD_UNAVAILABLE`, `PRODUCT_UNAVAILABLE`.',
  })
  @ApiServiceUnavailableResponse({
    description:
      '`PAYMENT_PROVIDER_NOT_CONFIGURED` — online payment only. COD is ' +
      'unaffected.',
  })
  place(
    @CurrentUser() user: JwtUser,
    @Body() dto: PlaceOrderDto,
  ): Promise<PlacedOrder> {
    return this.checkout.place(user.sub, dto);
  }
}
