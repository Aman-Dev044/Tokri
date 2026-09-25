import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import {
  AdminOrdersService,
  OrderDetail,
  OrderRow,
} from './orders.service';
import { CancelOrderDto, ListOrdersQueryDto } from './dto';

@ApiTags('admin/orders')
@ApiBearerAuth()
@Controller('admin/orders')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  @ApiOperation({
    summary: 'Cross-vendor order list (paginated)',
    description:
      'Filters: status, vendorId, customerId, paymentMethod, ' +
      'paymentStatus, from/to (on placedAt) and `q` against orderNo.',
  })
  list(@Query() query: ListOrdersQueryDto): Promise<Paginated<OrderRow>> {
    return this.orders.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One order in full',
    description:
      'Includes items, statusHistory and the vendor / customer / rider ' +
      'summaries. The delivery OTP hash is never serialised.',
  })
  @ApiNotFoundResponse({ description: 'Missing or malformed id.' })
  findOne(@Param('id') id: string): Promise<OrderDetail> {
    return this.orders.findById(id);
  }

  @Patch(':id/cancel')
  @ApiOperation({
    summary: 'Cancel an order',
    description:
      'Rejected with 409 if the state machine does not allow ' +
      'current → CANCELLED. Writes an audit entry, and a refund ' +
      'LedgerEntry when the order was prepaid.',
  })
  @ApiConflictResponse({ description: 'Not a legal transition.' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<OrderDetail> {
    return this.orders.cancel(id, dto, actor);
  }
}
