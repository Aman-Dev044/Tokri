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
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import {
  RequirePermission,
} from '../../../common/decorators/require-permission.decorator';
import { Permission } from '../../../common/constants/permissions';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { VendorScope } from '../common/vendor-scope.decorator';
import {
  BulkAdjustResult,
  InventoryLogRow,
  InventoryRow,
  VendorInventoryService,
} from './inventory.service';
import {
  AdjustStockDto,
  BulkAdjustStockDto,
  ListInventoryLogsQueryDto,
  ListInventoryQueryDto,
} from './dto';

@ApiTags('vendor/inventory')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not a vendor token.' })
@ApiNotFoundResponse({ description: 'No such inventory row in this store.' })
@Controller('vendor/inventory')
@Roles(Role.VENDOR, Role.STAFF)
@UseInterceptors(AuditInterceptor)
export class VendorInventoryController {
  constructor(private readonly inventory: VendorInventoryService) {}

  @RequirePermission(Permission.PRODUCTS_VIEW)
  @Get()
  @ApiOperation({
    summary: 'Stock board (paginated)',
    description:
      'Ordered worst-first: out of stock, then deepest under threshold. ' +
      'Filters: `lowStock`, `outOfStock`, `categoryId`, `q` over ' +
      'name/sku/brand.',
  })
  list(
    @VendorScope() scope: string,
    @Query() query: ListInventoryQueryDto,
  ): Promise<Paginated<InventoryRow>> {
    return this.inventory.list(scope, query);
  }

  @RequirePermission(Permission.INVENTORY_ADJUST)
  @Post('bulk')
  @ApiOperation({
    summary: 'Adjust many products in ONE transaction',
    description:
      'A stock-take. All lines land or none do — a partially applied ' +
      'batch leaves the vendor unable to tell which lines took effect.',
  })
  @ApiConflictResponse({ description: 'A line would drive stock negative.' })
  bulkAdjust(
    @VendorScope() scope: string,
    @Body() dto: BulkAdjustStockDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<BulkAdjustResult> {
    return this.inventory.bulkAdjust(scope, dto, actor);
  }

  @RequirePermission(Permission.PRODUCTS_VIEW)
  @Get(':productId')
  @ApiOperation({ summary: 'One product’s stock row' })
  findOne(
    @VendorScope() scope: string,
    @Param('productId') productId: string,
  ): Promise<InventoryRow> {
    return this.inventory.findOne(scope, productId);
  }

  @RequirePermission(Permission.PRODUCTS_VIEW)
  @Get(':productId/logs')
  @ApiOperation({
    summary: 'The per-product movement trail (paginated)',
    description:
      'Every adjustment already writes an `InventoryLog` row in the same ' +
      'transaction as the stock change; this reads it back, newest ' +
      'first.',
  })
  logs(
    @VendorScope() scope: string,
    @Param('productId') productId: string,
    @Query() query: ListInventoryLogsQueryDto,
  ): Promise<Paginated<InventoryLogRow>> {
    return this.inventory.logs(scope, productId, query);
  }

  @RequirePermission(Permission.INVENTORY_ADJUST)
  @Patch(':productId')
  @ApiOperation({
    summary: 'Adjust stock by a signed delta',
    description:
      'Stock is ADJUSTED, never SET — an `InventoryLog` row is written ' +
      'in the SAME transaction, so the log always reconstructs the ' +
      'current quantity. A decrement past zero is a 409: the `$gte` ' +
      'guard lives in the query filter, so check and write are atomic.',
  })
  @ApiConflictResponse({ description: 'Not enough stock for this delta.' })
  adjust(
    @VendorScope() scope: string,
    @Param('productId') productId: string,
    @Body() dto: AdjustStockDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<InventoryRow> {
    return this.inventory.adjust(scope, productId, dto, actor);
  }
}
