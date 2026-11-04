import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { Permission } from '../../../common/constants/permissions';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Idempotent } from '../../../common/decorators/idempotent.decorator';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { IdempotencyInterceptor } from '../../../common/interceptors/idempotency.interceptor';
import { VendorScope } from '../common/vendor-scope.decorator';
import {
  PosProductSearch,
  PosSaleDetail,
  PosSalesPage,
  VendorPosService,
} from './pos.service';
import {
  CreatePosSaleDto,
  ListPosSalesQueryDto,
  PosProductQueryDto,
  VoidPosSaleDto,
} from './dto';

/**
 * The store's counter till.
 *
 * Interceptors are declared per route, not on the class, so that on the
 * sale the IdempotencyInterceptor sits OUTSIDE the audit one: a replayed
 * request is answered from the stored response before the audit layer
 * sees it, and a double-tapped Charge button leaves one audit entry, not
 * two.
 */
@ApiTags('vendor/pos')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Missing the billing permission.' })
@Controller('vendor/pos')
@Roles(Role.VENDOR, Role.STAFF)
export class VendorPosController {
  constructor(private readonly pos: VendorPosService) {}

  @RequirePermission(Permission.BILLING_VIEW)
  @Get('products')
  @ApiOperation({
    summary: 'Find a product at the counter',
    description:
      'Name, brand, SKU prefix or the EXACT barcode, active products of ' +
      'this store only. `barcodeMatch` is set when `q` is a barcode, so a ' +
      'scanner hit can go straight into the cart.',
  })
  products(
    @VendorScope() scope: string,
    @Query() query: PosProductQueryDto,
  ): Promise<PosProductSearch> {
    return this.pos.searchProducts(scope, query.q);
  }

  @RequirePermission(Permission.BILLING_CREATE)
  @Post('sales')
  @HttpCode(HttpStatus.CREATED)
  @Idempotent('vendor.pos.sale')
  @UseInterceptors(IdempotencyInterceptor, AuditInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({
    summary: 'Ring up a walk-in sale',
    description:
      'The body names products and quantities only. Prices, GST (the ' +
      'online checkout’s rate and arithmetic), the discount cap, the ' +
      'total and the change are all computed here. Stock is decremented ' +
      'in one transaction with a sequential invoice number. No commission ' +
      'and no ledger entry: this is the store’s own revenue.',
  })
  @ApiBadRequestResponse({ description: 'Unknown product, or cash short.' })
  @ApiConflictResponse({ description: 'INSUFFICIENT_STOCK, with every short line.' })
  createSale(
    @VendorScope() scope: string,
    @Body() dto: CreatePosSaleDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PosSaleDetail> {
    return this.pos.createSale(scope, dto, actor);
  }

  @RequirePermission(Permission.BILLING_VIEW)
  @Get('sales')
  @ApiOperation({
    summary: 'Counter sales (paginated), with today’s totals by payment mode',
  })
  list(
    @VendorScope() scope: string,
    @Query() query: ListPosSalesQueryDto,
  ): Promise<PosSalesPage> {
    return this.pos.list(scope, query);
  }

  @RequirePermission(Permission.BILLING_VIEW)
  @Get('sales/:id')
  @ApiOperation({ summary: 'One invoice' })
  @ApiNotFoundResponse({ description: 'No such sale in this store.' })
  findOne(
    @VendorScope() scope: string,
    @Param('id') id: string,
  ): Promise<PosSaleDetail> {
    return this.pos.findOne(scope, id);
  }

  @RequirePermission(Permission.BILLING_VOID)
  @Post('sales/:id/void')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(AuditInterceptor)
  @ApiOperation({
    summary: 'Void a completed sale and restock its lines',
    description: 'A reason is required. Only a completed sale can be voided — once.',
  })
  @ApiNotFoundResponse({ description: 'No such sale in this store.' })
  @ApiConflictResponse({ description: 'Already voided.' })
  voidSale(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: VoidPosSaleDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PosSaleDetail> {
    return this.pos.voidSale(scope, id, dto, actor);
  }
}
