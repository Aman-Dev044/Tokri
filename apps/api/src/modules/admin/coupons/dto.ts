import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import { CouponType } from '../../../database/schemas/coupon.schema';

export class ListCouponsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: CouponType })
  @IsOptional()
  @IsEnum(CouponType)
  type?: CouponType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  vendorId?: string;
}

export class CreateCouponDto {
  @ApiProperty({ example: 'MANDI100', description: 'Uppercased on write.' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{4,24}$/, {
    message: 'code must be 4-24 characters of A-Z, 0-9, _ or -',
  })
  code: string;

  @ApiProperty({ enum: CouponType })
  @IsEnum(CouponType)
  type: CouponType;

  @ApiProperty({
    description:
      'FLAT: discount in INTEGER PAISE. PERCENT: whole percent, 1-100.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  value: number;

  @ApiPropertyOptional({
    default: 0,
    description: 'Minimum order subtotal, INTEGER PAISE.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOrder?: number;

  @ApiPropertyOptional({
    description:
      'Cap on the discount, INTEGER PAISE. REQUIRED when type is percent.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxDiscount?: number;

  @ApiPropertyOptional({ default: 0, description: '0 means unlimited.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  usageLimit?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perUserLimit?: number;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsISO8601()
  validFrom: string;

  @ApiProperty({ example: '2026-10-01T00:00:00.000Z' })
  @IsISO8601()
  validTo: string;

  @ApiPropertyOptional({ description: 'Omit for a platform-wide coupon.' })
  @IsOptional()
  @IsMongoId()
  vendorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 240)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCouponDto {
  @ApiPropertyOptional({ enum: CouponType })
  @IsOptional()
  @IsEnum(CouponType)
  type?: CouponType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxDiscount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  usageLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  perUserLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  validTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 240)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCouponStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}
