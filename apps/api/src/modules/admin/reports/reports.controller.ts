import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Paginated } from '../../../common/dto/paginated';
import { AdminReportsService } from './reports.service';
import { ReportQueryDto } from './dto';
import { ReportRow } from './report.util';

/**
 * The report builder. SUPER_ADMIN only: it is the platform's whole
 * commercial picture — every store's GMV, the commission taken from it,
 * and the tax collected — in one exportable table.
 */
@ApiTags('admin/reports')
@ApiBearerAuth()
@Controller('admin/reports')
@Roles(Role.SUPER_ADMIN)
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  @Get()
  @ApiOperation({
    summary: 'Run one report over a window (SUPER_ADMIN only)',
    description:
      '`report` picks the read model; `grouping` must be one it supports. ' +
      'Rows are sparse (no row for an empty bucket) and answer in the ' +
      'usual `{ data, meta }` envelope, unpaged. Money is INTEGER PAISE, ' +
      'percentages are 0–100, and `null` means "not measurable for this ' +
      'row" — never zero. Buckets are UTC days.\n\n' +
      'Row keys — sales: date, orders, gmvPaise, aovPaise, discountPaise, ' +
      'commissionPaise · vendor_performance: vendorId, vendor, city, ' +
      'orders, gmvPaise, commissionPaise, cancelPct · product_performance: ' +
      'aisleKey, products, units, gmvPaise, sharePct · ' +
      'delivery_performance: date, deliveries, avgMinutes, onTimePct, ' +
      'failed · tax_summary: slab, orders, taxablePaise, taxPaise.',
  })
  @ApiForbiddenResponse({ description: 'ADMIN is not sufficient here.' })
  run(@Query() query: ReportQueryDto): Promise<Paginated<ReportRow>> {
    return this.reports.run(query);
  }
}
