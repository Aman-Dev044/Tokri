import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import { VendorStatus } from '../../../database/schemas/vendor.schema';

export class ListVendorsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: VendorStatus })
  @IsOptional()
  @IsEnum(VendorStatus)
  status?: VendorStatus;
}

export class UpdateVendorStatusDto {
  @ApiProperty({ enum: VendorStatus })
  @IsEnum(VendorStatus)
  status: VendorStatus;

  @ApiPropertyOptional({
    description:
      'Why. Recorded on the vendor and in the audit trail. Required when ' +
      'suspending — "who suspended this store and why" is the first ' +
      'question asked when the owner calls support.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

export class UpdateVendorCommissionDto {
  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description:
      'Flat platform commission, percent. Applies to FUTURE orders only: ' +
      'existing orders carry their own snapshot and are never re-priced.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionPct: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}
