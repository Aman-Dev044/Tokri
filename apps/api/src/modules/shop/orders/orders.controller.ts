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
  ApiNotFoundResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Owns } from '../../../common/decorators/owns.decorator';
import { Order } from '../../../database/schemas/order.schema';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ShopOrdersService, TrackView } from './orders.service';
import { OrderDetail, OrderSummary } from './order-view';

export class CancelOrderDto {
  @ApiProperty({ example: 'Ordered by mistake' })
  @IsString()
  @Length(3, 300)
  reason: string;
}

/**
 * The customer's own orders.
 *
 * `@Owns({ model: 'Order', field: 'customerId' })` on every
 * single-resource route: `ResourceOwnerGuard` loads the order and
 * compares `customerId` with the token's `sub` before the handler runs.
 * Another customer's order id returns **404, not 403** — a 403 would
 * confirm the id is real, and order ids are sequential enough in spirit
 * that confirming them leaks order volume.
 */
@ApiTags('shop/orders')
@ApiBearerAuth()
@Controller('orders')
@Roles(Role.CUSTOMER)
export class ShopOrdersController {
  constructor(private readonly orders: ShopOrdersService) {}

  @Get()
  @ApiOperation({ summary: 'The caller\'s orders, newest first' })
  list(
    @CurrentUser() user: JwtUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<OrderSummary>> {
    return this.orders.list(user.sub, query);
  }

  @Get(':id')
  @Owns({ model: Order.name, param: 'id', field: 'customerId' })
  @ApiOperation({ summary: 'One order in full' })
  @ApiNotFoundResponse({
    description:
      'Unknown id, malformed id, or another customer\'s order — all 404.',
  })
  findOne(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<OrderDetail> {
    return this.orders.findOne(user.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Owns({ model: Order.name, param: 'id', field: 'customerId' })
  @ApiOperation({
    summary: 'Cancel an order',
    description:
      'Free while the order is still PLACED — the reserved stock goes ' +
      'straight back on the shelf and any coupon use is released. Once ' +
      'the store has accepted it, 409 `CANCELLATION_NEEDS_APPROVAL` ' +
      '(locked decision #8).',
  })
  @ApiConflictResponse({
    description: '`CANCELLATION_NEEDS_APPROVAL` or `ORDER_CLOSED`.',
  })
  cancel(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderDetail> {
    return this.orders.cancel(user.sub, id, dto.reason);
  }

  @Get(':id/track')
  @Owns({ model: Order.name, param: 'id', field: 'customerId' })
  @ApiOperation({
    summary: 'Where the order is',
    description:
      'The rider position is reported exactly as last received, with ' +
      '`lastSeenAt` and `ageSeconds`. It is never interpolated or ' +
      'refreshed server-side. `eta.basis` says where the time came from.',
  })
  track(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
  ): Promise<TrackView> {
    return this.orders.track(user.sub, id);
  }
}
