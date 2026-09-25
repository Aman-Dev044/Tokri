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
  UseInterceptors,
} from '@nestjs/common';
import {
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
import { PartnerRow, VendorPartnersService } from './partners.service';
import {
  CreatePartnerDto,
  ListPartnersQueryDto,
  UpdatePartnerDto,
  UpdatePartnerStatusDto,
} from './dto';

/**
 * The store's own delivery roster.
 *
 * `vendorId` is stamped from the verified JWT on creation and is part of
 * the filter on every subsequent read and write, so another store's rider
 * is a 404 — never a 403, which would confirm the id exists.
 */
@ApiTags('vendor/delivery-partners')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not a vendor token.' })
@ApiNotFoundResponse({ description: 'No such rider in this store.' })
@Controller('vendor/delivery-partners')
@Roles(Role.VENDOR)
@UseInterceptors(AuditInterceptor)
export class VendorPartnersController {
  constructor(private readonly partners: VendorPartnersService) {}

  @Get()
  @ApiOperation({
    summary: 'Rider list (paginated)',
    description:
      'Filters: `status`, `vehicleType`, `isOnline`, `isAvailable`, and ' +
      '`q` over name and phone.',
  })
  list(
    @VendorScope() scope: string,
    @Query() query: ListPartnersQueryDto,
  ): Promise<Paginated<PartnerRow>> {
    return this.partners.list(scope, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Onboard a rider',
    description:
      'Creates the DELIVERY `User` and the `DeliveryPartner` record in ' +
      'ONE transaction. The password is hashed with argon2id + the ' +
      'environment pepper and is never echoed back or written to the ' +
      'audit trail.',
  })
  @ApiConflictResponse({ description: 'Phone or email already in use.' })
  create(
    @VendorScope() scope: string,
    @Body() dto: CreatePartnerDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PartnerRow> {
    return this.partners.create(scope, dto, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One rider' })
  findOne(
    @VendorScope() scope: string,
    @Param('id') id: string,
  ): Promise<PartnerRow> {
    return this.partners.findOne(scope, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a rider’s name, email or vehicle' })
  update(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PartnerRow> {
    return this.partners.update(scope, id, dto, actor);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Activate, hold or suspend a rider',
    description:
      'The login account moves with the record, in one transaction, and ' +
      'a suspension revokes the refresh-token family. Refused with 409 ' +
      'while the rider is carrying an order.',
  })
  @ApiConflictResponse({ description: 'Rider is carrying an order.' })
  setStatus(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PartnerRow> {
    return this.partners.setStatus(scope, id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a rider who has no order history',
    description:
      'Deletes the partner record and its login account in one ' +
      'transaction. Refused with 409 once any order references them — ' +
      'deleting would orphan delivery history; suspend instead.',
  })
  @ApiConflictResponse({ description: 'Has order history, or is on a job.' })
  remove(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<void> {
    return this.partners.remove(scope, id, actor);
  }
}
