import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Types } from 'mongoose';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { AdminVendorsService, VendorRow } from './vendors.service';
import {
  ListVendorsQueryDto,
  UpdateVendorCommissionDto,
  UpdateVendorStatusDto,
} from './dto';
import { AdminOrdersService, OrderRow } from '../orders/orders.service';
import { ListOrdersQueryDto } from '../orders/dto';
import { AdminCatalogService, ProductRow } from '../catalog/catalog.service';
import { ListProductsQueryDto } from '../catalog/dto';

@ApiTags('admin/vendors')
@ApiBearerAuth()
@Controller('admin/vendors')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminVendorsController {
  constructor(
    private readonly vendors: AdminVendorsService,
    private readonly orders: AdminOrdersService,
    private readonly catalog: AdminCatalogService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Vendor list (paginated)',
    description:
      'Filter by `status` and `q` (store name, slug, city, pincode). Each ' +
      'row carries lifetime `gmv` (INTEGER PAISE) and `orderCount`, joined ' +
      'from orders excluding cancelled and rejected. Sortable on ' +
      'createdAt, storeName, commissionPct, rating, status, gmv, orderCount.',
  })
  list(@Query() query: ListVendorsQueryDto): Promise<Paginated<VendorRow>> {
    return this.vendors.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One vendor' })
  @ApiNotFoundResponse({ description: 'Missing or malformed id.' })
  findOne(@Param('id') id: string): Promise<VendorRow> {
    return this.vendors.findById(id);
  }

  @Get(':id/orders')
  @ApiOperation({ summary: "A vendor's orders (paginated)" })
  vendorOrders(
    @Param('id') id: string,
    @Query() query: ListOrdersQueryDto,
  ): Promise<Paginated<OrderRow>> {
    // The path id is authoritative here; a vendorId in the query string is
    // ignored rather than allowed to widen the result to another tenant.
    return this.orders.list({ ...query, vendorId: assertId(id) });
  }

  @Get(':id/products')
  @ApiOperation({ summary: "A vendor's products (paginated)" })
  vendorProducts(
    @Param('id') id: string,
    @Query() query: ListProductsQueryDto,
  ): Promise<Paginated<ProductRow>> {
    return this.catalog.listProducts({ ...query, vendorId: assertId(id) });
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Approve, suspend or re-pend a vendor',
    description:
      'A reason is REQUIRED when suspending. Anything other than ' +
      '`approved` also forces the store closed, so a suspended vendor ' +
      'stops taking orders immediately. Writes an audit entry.',
  })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateVendorStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<VendorRow> {
    return this.vendors.updateStatus(id, dto, actor);
  }

  // ────────────────────────────────────────────────────────────────────
  //  SUPER_ADMIN ONLY — commission is money policy.
  //  @Roles() on the handler overrides the controller value, and ADMIN
  //  does NOT satisfy a SUPER_ADMIN requirement (inheritance runs upward
  //  only). A compromised ADMIN session can approve and suspend stores,
  //  but cannot quietly re-price the platform's cut.
  // ────────────────────────────────────────────────────────────────────

  @Patch(':id/commission')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Set a vendor commission rate (SUPER_ADMIN only)',
    description:
      'Applies to FUTURE orders only. Existing orders carry their own ' +
      '`pricing.commissionPct` snapshot and are never re-priced.',
  })
  @ApiForbiddenResponse({ description: 'ADMIN is not sufficient here.' })
  updateCommission(
    @Param('id') id: string,
    @Body() dto: UpdateVendorCommissionDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<VendorRow> {
    return this.vendors.updateCommission(id, dto, actor);
  }
}

/** A malformed id is a 404, never a 400 — see ResourceOwnerGuard. */
function assertId(id: string): string {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundException('Vendor not found');
  }
  return id;
}
