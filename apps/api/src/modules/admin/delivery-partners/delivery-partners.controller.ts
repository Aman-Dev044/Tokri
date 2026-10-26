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
  AdminDeliveryPartnersService,
  PartnerDetail,
  PartnerRow,
} from './delivery-partners.service';
import { ListPartnersQueryDto, UpdatePartnerStatusDto } from './dto';

@ApiTags('admin/delivery-partners')
@ApiBearerAuth()
@Controller('admin/delivery-partners')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminDeliveryPartnersController {
  constructor(private readonly partners: AdminDeliveryPartnersService) {}

  @Get()
  @ApiOperation({
    summary: 'Delivery partner list (paginated)',
    description:
      'Filters: isOnline, isAvailable, status, vehicleType, vendorId and ' +
      '`q` over rider name / phone. Each row carries completedCount and ' +
      'rating. Sortable on createdAt, completedCount, rating, status.',
  })
  list(@Query() query: ListPartnersQueryDto): Promise<Paginated<PartnerRow>> {
    return this.partners.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One delivery partner, with performance, run and KYC detail',
    description:
      'The list row plus: delivered / failed counts, average run time ' +
      'and offer acceptance (from `delivery_assignments`), the order ' +
      'currently held, the last 20 finished runs, the KYC record with ' +
      'every identifier MASKED, and the wallet balance. Nothing here is ' +
      'estimated: a metric with no data is null, never zero.',
  })
  @ApiNotFoundResponse({ description: 'Missing or malformed id.' })
  findOne(@Param('id') id: string): Promise<PartnerDetail> {
    return this.partners.findById(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Suspend, reactivate or re-pend a rider',
    description:
      'Also moves their User account to the matching status, which clears ' +
      'the refresh-token family. Suspending without that leaves a working ' +
      'token on the delivery endpoints. A reason is required to suspend.',
  })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PartnerDetail> {
    return this.partners.updateStatus(id, dto, actor);
  }
}
