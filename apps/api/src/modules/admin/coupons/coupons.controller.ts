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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
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
import { AdminCouponsService, CouponRow } from './coupons.service';
import {
  CreateCouponDto,
  ListCouponsQueryDto,
  UpdateCouponDto,
  UpdateCouponStatusDto,
} from './dto';

@ApiTags('admin/coupons')
@ApiBearerAuth()
@Controller('admin/coupons')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminCouponsController {
  constructor(private readonly coupons: AdminCouponsService) {}

  @Get()
  @ApiOperation({
    summary: 'Coupon list (paginated)',
    description:
      'Filters: type, isActive, vendorId, `q` over code/description, and ' +
      'from/to which select coupons whose validity window overlaps.',
  })
  list(@Query() query: ListCouponsQueryDto): Promise<Paginated<CouponRow>> {
    return this.coupons.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One coupon' })
  findOne(@Param('id') id: string): Promise<CouponRow> {
    return this.coupons.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a coupon',
    description:
      'Validated: percent value ≤ 100, validFrom < validTo, and ' +
      'maxDiscount REQUIRED for a percent coupon. `usedCount` is never ' +
      'accepted from the caller.',
  })
  @ApiBadRequestResponse({ description: 'Fails one of those three rules.' })
  @ApiConflictResponse({ description: 'Code already exists.' })
  create(
    @Body() dto: CreateCouponDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<CouponRow> {
    return this.coupons.create(dto, actor);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a coupon',
    description:
      'The three rules are re-checked against the MERGED document, so a ' +
      'patch that switches type to percent without a cap is rejected.',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<CouponRow> {
    return this.coupons.update(id, dto, actor);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate or deactivate a coupon' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCouponStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<CouponRow> {
    return this.coupons.updateStatus(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a coupon',
    description:
      'Refused with 409 once the coupon has been redeemed — it is part of ' +
      'the pricing history of real orders. Deactivate instead.',
  })
  @ApiConflictResponse({ description: 'Already redeemed.' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<void> {
    return this.coupons.remove(id, actor);
  }
}
