import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Owns } from '../../../common/decorators/owns.decorator';
import { Order } from '../../../database/schemas/order.schema';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { OrderRatingView, RATING_WINDOW_DAYS } from '../orders/order-view';
import { RateOrderDto } from './dto';
import { OrderRatingService } from './order-rating.service';

/**
 * `POST /orders/:id/rating` — beside, not inside, `ShopOrdersController`:
 * same prefix, same role, same `@Owns` rule (another customer's order is a
 * 404), but its own service, because it writes to vendors and riders and
 * the order controller writes to neither.
 */
@ApiTags('shop/orders')
@ApiBearerAuth()
@Controller('orders')
@Roles(Role.CUSTOMER)
export class OrderRatingController {
  constructor(private readonly ratings: OrderRatingService) {}

  @Post(':id/rating')
  @HttpCode(HttpStatus.CREATED)
  @Owns({ model: Order.name, param: 'id', field: 'customerId' })
  @ApiOperation({
    summary: 'Rate a delivered order — the store and the rider',
    description:
      `Once per order, only once DELIVERED, within ${RATING_WINDOW_DAYS} ` +
      'days of delivery. Updates `Vendor.rating` and the rider\'s `rating` ' +
      'as exact running means (sum / count), in the same transaction.',
  })
  @ApiNotFoundResponse({ description: 'Unknown id, or another customer\'s order.' })
  @ApiBadRequestResponse({ description: '`NO_RIDER_TO_RATE`, or a rating outside 1-5.' })
  @ApiConflictResponse({
    description: '`ORDER_NOT_DELIVERED`, `ORDER_ALREADY_RATED` or `RATING_WINDOW_CLOSED`.',
  })
  rate(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: RateOrderDto,
  ): Promise<OrderRatingView> {
    return this.ratings.rate(user.sub, id, dto);
  }
}
