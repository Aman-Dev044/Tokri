import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { VendorScope } from '../common/vendor-scope.decorator';
import {
  OrderDetail,
  OrderRow,
  PartialFulfilmentResult,
  VendorOrdersService,
} from './orders.service';
import {
  AcceptOrderDto,
  AssignPartnerDto,
  ListOrdersQueryDto,
  RejectOrderDto,
  UpdateOrderItemsDto,
  UpdateOrderStatusDto,
} from './dto';

/**
 * The order board — the screen a vendor works from all day.
 *
 * Every write is validated against the §5.3 state machine through
 * `canTransition` AND `ALLOWED_ACTOR`. An off-graph transition is 409,
 * never a silent no-op, because the client that asked for one is either
 * out of date or hostile.
 */
@ApiTags('vendor/orders')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not a vendor token.' })
@ApiNotFoundResponse({ description: 'No such order in this store.' })
@Controller('vendor/orders')
@Roles(Role.VENDOR)
@UseInterceptors(AuditInterceptor)
export class VendorOrdersController {
  constructor(private readonly orders: VendorOrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'Order list (paginated)',
    description:
      'Filters: `status`, `from`/`to` over `placedAt`, and `q` over ' +
      'order number, delivery phone and item names.',
  })
  list(
    @VendorScope() scope: string,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Paginated<OrderRow>> {
    return this.orders.list(scope, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Full order detail',
    description:
      'Items, pricing, delivery address, status history, customer and ' +
      'rider. The delivery OTP hash is never serialised.',
  })
  findOne(
    @VendorScope() scope: string,
    @Param('id') id: string,
  ): Promise<OrderDetail> {
    return this.orders.findOne(scope, id);
  }

  @Patch(':id/accept')
  @ApiOperation({
    summary: 'Accept a PLACED order',
    description:
      '`etaMinutes` is the promised prep time; it is recorded on the ' +
      'status-history row for the `order.accepted` event.',
  })
  @ApiConflictResponse({ description: 'Not a legal transition from here.' })
  accept(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: AcceptOrderDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<OrderDetail> {
    return this.orders.accept(scope, id, dto, actor);
  }

  @Patch(':id/reject')
  @ApiOperation({
    summary: 'Decline an order',
    description:
      '`reason` is REQUIRED. A rejection with no reason gives support ' +
      'nothing to say and the customer nothing to act on.',
  })
  @ApiBadRequestResponse({ description: 'Missing or too-short reason.' })
  @ApiConflictResponse({ description: 'Not a legal transition from here.' })
  reject(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: RejectOrderDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<OrderDetail> {
    return this.orders.reject(scope, id, dto, actor);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Drive the order forward',
    description:
      'PACKING, READY_FOR_PICKUP and CANCELLED (reason required). ' +
      'REJECTED and ASSIGNED have their own endpoints because they ' +
      'carry payload the state machine cannot express.',
  })
  @ApiConflictResponse({
    description: 'Off the state machine, or not a vendor-driven edge.',
  })
  changeStatus(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<OrderDetail> {
    return this.orders.changeStatus(scope, id, dto, actor);
  }

  @Patch(':id/items')
  @ApiOperation({
    summary: 'Partial fulfilment — drop lines and auto-refund',
    description:
      'Locked decision #9. Send EVERY line’s desired state. Totals are ' +
      'recomputed server-side (discount and tax scale pro-rata, the ' +
      'delivery fee does not, and the commission percentage is the ' +
      'checkout snapshot) and the refund difference is written as a ' +
      'LedgerEntry in the same transaction. Allowed only while the ' +
      'order is ACCEPTED or PACKING.',
  })
  @ApiBadRequestResponse({
    description: 'Unknown line, or every line dropped (that is a rejection).',
  })
  @ApiConflictResponse({ description: 'Too late to re-pick this order.' })
  updateFulfilment(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderItemsDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PartialFulfilmentResult> {
    return this.orders.updateFulfilment(scope, id, dto, actor);
  }

  @Post(':id/assign')
  @ApiOperation({
    summary: 'Assign one of the store’s own riders',
    description:
      'Order status, `deliveryPartnerId`, the rider’s `activeOrderId` ' +
      'and their availability all move in ONE transaction. A busy or ' +
      'suspended rider is a 409; another store’s rider is a 404.',
  })
  @ApiConflictResponse({ description: 'Rider busy, or illegal transition.' })
  assign(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: AssignPartnerDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<OrderDetail> {
    return this.orders.assign(scope, id, dto, actor);
  }
}
