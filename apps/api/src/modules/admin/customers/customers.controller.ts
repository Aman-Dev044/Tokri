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
  AdminCustomersService,
  CustomerDetail,
  CustomerRow,
} from './customers.service';
import { ListCustomersQueryDto, UpdateCustomerStatusDto } from './dto';

@ApiTags('admin/customers')
@ApiBearerAuth()
@Controller('admin/customers')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get()
  @ApiOperation({
    summary: 'Customer list (paginated)',
    description:
      'Each row carries `orderCount`, `totalSpend` (INTEGER PAISE) and ' +
      '`lastOrderAt`, all excluding cancelled and rejected orders. ' +
      'Sortable on createdAt, name, orderCount, totalSpend, lastOrderAt, ' +
      'lastLoginAt.',
  })
  list(
    @Query() query: ListCustomersQueryDto,
  ): Promise<Paginated<CustomerRow>> {
    return this.customers.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One customer, with saved addresses' })
  @ApiNotFoundResponse({ description: 'Missing, malformed, or not a customer.' })
  findOne(@Param('id') id: string): Promise<CustomerDetail> {
    return this.customers.findById(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Suspend or reactivate a customer',
    description:
      'Suspension clears the refresh-token family and JwtStrategy ' +
      're-reads status on every request, so a live access token stops ' +
      'working on its next use.',
  })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<CustomerDetail> {
    return this.customers.updateStatus(id, dto, actor);
  }
}
