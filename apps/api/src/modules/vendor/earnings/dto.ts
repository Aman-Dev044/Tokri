import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { LedgerEntryType } from '../../../database/schemas/ledger-entry.schema';
import { SettlementStatus } from '../../../database/schemas/settlement.schema';
import { VendorDateRangeQueryDto, VendorListQueryDto } from '../common/dto';

export class EarningsQueryDto extends VendorDateRangeQueryDto {}

export class ListLedgerQueryDto extends VendorListQueryDto {
  @ApiPropertyOptional({ enum: LedgerEntryType })
  @IsOptional()
  @IsEnum(LedgerEntryType)
  type?: LedgerEntryType;
}

export class ListSettlementsQueryDto extends VendorListQueryDto {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;
}

export enum SalesGroupBy {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class SalesReportQueryDto extends VendorDateRangeQueryDto {
  @ApiPropertyOptional({ enum: SalesGroupBy, default: SalesGroupBy.DAY })
  @IsOptional()
  @IsEnum(SalesGroupBy)
  groupBy?: SalesGroupBy;
}

export class TopProductsQueryDto extends VendorDateRangeQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
