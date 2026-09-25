import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import {
  AddItemResult,
  CartService,
  CartView,
  ParkedCartSummary,
} from './cart.service';
import {
  AddCartItemDto,
  GetCartQueryDto,
  ParkCartDto,
  UpdateCartItemDto,
} from './dto';

/**
 * The basket.
 *
 * Every route is scoped to the caller's own id, taken from the verified
 * token — there is no cart id in any path, so there is nothing to
 * enumerate and `@Owns` has nothing to check. Customer A cannot address
 * customer B's cart because the API offers no way to name it.
 */
@ApiTags('shop/cart')
@ApiBearerAuth()
@Controller('cart')
@Roles(Role.CUSTOMER)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  @ApiOperation({
    summary: 'The current basket, re-validated against live data',
    description:
      'Every line is compared to the live product and inventory. Per-line ' +
      '`flags` report `price_changed`, `out_of_stock`, `reduced_qty` and ' +
      '`unavailable`. Nothing is silently corrected: a stale cart is the ' +
      'single biggest cause of a failed checkout, and the customer has to ' +
      'be the one who decides what to do about it.',
  })
  @ApiOkResponse({ description: 'CartView (id is null when there is no cart).' })
  get(
    @CurrentUser() user: JwtUser,
    @Query() query: GetCartQueryDto,
  ): Promise<CartView> {
    return this.cart.view(user.sub, query.vendorId);
  }

  @Post('items')
  @ApiOperation({
    summary: 'Add to the basket (increments an existing line)',
    description:
      'If the active basket belongs to a DIFFERENT store it is PARKED, ' +
      'never destroyed (locked decision #1), and returned as `parked`. ' +
      'If this store had a parked basket, it is restored and added to.',
  })
  @ApiConflictResponse({
    description: '`INSUFFICIENT_STOCK` — advisory only; the binding check is at checkout.',
  })
  add(
    @CurrentUser() user: JwtUser,
    @Body() dto: AddCartItemDto,
  ): Promise<AddItemResult> {
    return this.cart.addItem(user.sub, dto);
  }

  @Patch('items/:productId')
  @ApiOperation({ summary: 'Set a line to an absolute quantity' })
  @ApiNotFoundResponse({ description: 'No active cart, or no such line.' })
  update(
    @CurrentUser() user: JwtUser,
    @Param('productId') productId: string,
    @Body() dto: UpdateCartItemDto,
  ): Promise<CartView> {
    return this.cart.updateItem(user.sub, productId, dto.qty);
  }

  @Delete('items/:productId')
  @ApiOperation({ summary: 'Remove one line' })
  remove(
    @CurrentUser() user: JwtUser,
    @Param('productId') productId: string,
  ): Promise<CartView> {
    return this.cart.removeItem(user.sub, productId);
  }

  @Delete()
  @ApiOperation({ summary: 'Empty the active basket' })
  clear(@CurrentUser() user: JwtUser): Promise<CartView> {
    return this.cart.clear(user.sub);
  }

  @Post('park')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set the active basket aside',
    description:
      'Parked baskets are restorable for seven days (TTL) and are listed ' +
      'on every cart response as `parkedCarts`. Adding an item from that ' +
      'store restores it.',
  })
  @ApiConflictResponse({
    description: '`CART_CHANGED` — the active cart is not the one the client named.',
  })
  park(
    @CurrentUser() user: JwtUser,
    @Body() dto: ParkCartDto,
  ): Promise<{ parked: ParkedCartSummary | null; cart: CartView }> {
    return this.cart.park(user.sub, dto.vendorId);
  }
}
