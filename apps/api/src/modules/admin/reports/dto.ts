import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import { DateRangeQueryDto } from '../common/dto';
import { ALL_GROUPINGS, REPORT_KEYS, ReportKey } from './report.util';

/**
 * `GET /admin/reports` — exactly what `ReportsView` sends:
 * `cleanParams({ report, grouping, from, to })`.
 *
 * Nothing else is declared, and nothing else may be: under
 * `forbidNonWhitelisted` an extra key the page started sending would 400,
 * and the page would render its fixture behind the amber banner. `from`
 * and `to` are the date pickers' bare `YYYY-MM-DD`, which `IsISO8601`
 * accepts; both are omitted until the page has read the clock.
 */
export class ReportQueryDto extends DateRangeQueryDto {
  @ApiProperty({ enum: REPORT_KEYS })
  @IsIn(REPORT_KEYS)
  report: ReportKey;

  @ApiPropertyOptional({
    enum: ALL_GROUPINGS,
    description:
      'Must be one the chosen report supports; defaults to its first. ' +
      'sales: day|week|month · vendor_performance: vendor · ' +
      'product_performance: aisle · delivery_performance: day · ' +
      'tax_summary: slab.',
  })
  @IsOptional()
  @IsIn(ALL_GROUPINGS)
  grouping?: string;
}
