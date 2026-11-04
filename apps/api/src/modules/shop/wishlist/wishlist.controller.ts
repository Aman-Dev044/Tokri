import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
  MAX_WISHLIST_ITEMS,
  WishlistRow,
  WishlistService,
  WishlistToggleResult,
} from './wishlist.service';

/**
 * The customer's saved products.
 *
 * `@Roles(Role.CUSTOMER)` on the controller, and no wishlist id anywhere
 * in a path — every route is scoped to the token's `sub`, exactly like
 * `/cart`. There is no way to name another customer's list, so there is
 * nothing for `@Owns` to check and nothing to enumerate.
 */
@ApiTags('shop/wishlist')
@ApiBearerAuth()
@Controller('wishlist')
@Roles(Role.CUSTOMER)
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  @ApiOperation({
    summary: 'Every saved product, newest first, with live data',
    description:
      `A BARE ARRAY (at most ${MAX_WISHLIST_ITEMS} rows) — the client ` +
      'needs every saved id to draw the hearts. Each row carries the live ' +
      'product (price, stock, `isActive`) and its store. A withdrawn or ' +
      'deleted product, or one whose store is no longer approved, is KEPT ' +
      'with `available: false` and an `unavailableReason`, never dropped.',
  })
  @ApiOkResponse({ description: 'WishlistRow[]' })
  list(@CurrentUser() user: JwtUser): Promise<WishlistRow[]> {
    return this.wishlist.list(user.sub);
  }

  @Post(':productId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Save a product (idempotent)',
    description:
      'Saving an already-saved product is a 200 with the same body. A new ' +
      'save must name an active product from an approved store.',
  })
  @ApiNotFoundResponse({ description: 'Unknown, inactive, or unlisted product.' })
  @ApiConflictResponse({ description: '`WISHLIST_FULL`.' })
  add(
    @CurrentUser() user: JwtUser,
    @Param('productId') productId: string,
  ): Promise<WishlistToggleResult> {
    return this.wishlist.add(user.sub, productId);
  }

  @Delete(':productId')
  @ApiOperation({
    summary: 'Unsave a product (idempotent)',
    description: 'Removing a product that was never saved is still a 200.',
  })
  remove(
    @CurrentUser() user: JwtUser,
    @Param('productId') productId: string,
  ): Promise<WishlistToggleResult> {
    return this.wishlist.remove(user.sub, productId);
  }
}
