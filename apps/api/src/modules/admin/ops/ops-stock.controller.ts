import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Paginated } from '../../../common/dto/paginated';
import {
  AdminOpsStockService,
  StockAlertRow,
  StockAlertsSummary,
} from './ops-stock.service';
import { StockAlertsQueryDto, StockAlertsSummaryQueryDto } from './dto';

@ApiTags('admin/ops')
@ApiBearerAuth()
@Controller('admin/ops/stock-alerts')
@Roles(Role.ADMIN)
export class AdminOpsStockController {
  constructor(private readonly stock: AdminOpsStockService) {}

  // Declared BEFORE the list route only for readability — `summary` is a
  // literal segment on a controller that has no `:param` route, so there
  // is no ambiguity for Nest to resolve either way.
  @Get('summary')
  @ApiOperation({
    summary: 'Stock alert totals, by vendor and by aisle',
    description:
      '`out` is stock 0; `low` is above zero and at or under the ' +
      "product's threshold. Optional `vendorId` narrows every figure.",
  })
  summary(
    @Query() query: StockAlertsSummaryQueryDto,
  ): Promise<StockAlertsSummary> {
    return this.stock.summary(query);
  }

  @Get()
  @ApiOperation({
    summary: 'Products at or under their low-stock threshold (paginated)',
    description:
      'Worst first: out of stock, then deepest below threshold. Filters: ' +
      'vendorId, aisleKey, severity (low | out). Each row carries ' +
      '`lastRestockedAt` and `unitsSold30d`, which is what turns a ' +
      'threshold breach into a restocking decision.',
  })
  list(
    @Query() query: StockAlertsQueryDto,
  ): Promise<Paginated<StockAlertRow>> {
    return this.stock.list(query);
  }
}
