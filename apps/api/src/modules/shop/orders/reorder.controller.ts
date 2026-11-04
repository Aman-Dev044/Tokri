import { Controller, Get, Param } from '@nestjs/common';
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
import { Owns } from '../../../common/decorators/owns.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Order } from '../../../database/schemas/order.schema';
import { ReorderPreview, ReorderService } from './reorder.service';

/**
 * "Order again". A sibling of `ShopOrdersController` rather than a method
 * on it, so the reorder read can change without touching the order
 * lifecycle routes — but under the same `orders` path, the same
 * `@Roles(Role.CUSTOMER)` and the same `@Owns` 404 for anyone else's id.
 */
@ApiTags('shop/orders')
@ApiBearerAuth()
@Controller('orders')
@Roles(Role.CUSTOMER)
export class ReorderController {
  constructor(private readonly reorder: ReorderService) {}

  @Get(':id/reorder-preview')
  @Owns({ model: Order.name, param: 'id', field: 'customerId' })
  @ApiOperation({
    summary: 'What of a delivered order can go back in the basket',
    description:
      'Re-reads every line against the live catalogue: inactive or ' +
      'deleted products, and every line of a closed or suspended store, ' +
      'are `unavailable`; the rest are capped at live stock and the ' +
      'per-line ceiling. `product` carries TODAY\'s price — the order\'s ' +
      'own price is `orderedPrice`, for display only. Writes nothing: ' +
      'the client adds lines through `POST /cart/items`.',
  })
  @ApiOkResponse({
    description: '{ orderId, orderNo, store, lines[], addableCount }',
  })
  @ApiNotFoundResponse({
    description: 'Unknown id, malformed id, or another customer\'s order.',
  })
  @ApiConflictResponse({ description: '`ORDER_NOT_DELIVERED`.' })
  preview(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<ReorderPreview> {
    return this.reorder.preview(user.sub, id);
  }
}
