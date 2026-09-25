import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Body of `PUT /admin/settings`.
 *
 * MERGE semantics: an omitted key keeps its current value. Every field is
 * typed and range-checked, because these values price real orders — a
 * `deliveryFeePaise` of `"40"` or `40.5` reaching the checkout maths is a
 * rounding bug in every invoice from that moment on.
 *
 * Nothing secret lives here. Credentials belong in `.env`, validated at
 * boot; this collection is for business policy an admin changes at 9am
 * without a redeploy.
 */
export class UpdateSettingsDto {
  @ApiPropertyOptional({
    description: 'Delivery fee charged to the customer, INTEGER PAISE.',
    example: 2900,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'deliveryFeePaise must be an integer number of paise' })
  @Min(0)
  @Max(100_000)
  deliveryFeePaise?: number;

  @ApiPropertyOptional({
    description: 'Subtotal at which delivery becomes free, INTEGER PAISE.',
    example: 49900,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  freeDeliveryThresholdPaise?: number;

  @ApiPropertyOptional({
    description: 'Commission applied to a new vendor, percent.',
    example: 12,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  defaultCommissionPct?: number;

  @ApiPropertyOptional({
    description: 'Maximum cash an order may be placed for, INTEGER PAISE.',
    example: 200000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  codMaxAmountPaise?: number;

  @ApiPropertyOptional({ description: 'Serviceable radius in km.', example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0.5)
  @Max(50)
  serviceRadiusKm?: number;

  @ApiPropertyOptional({ example: 'Mandi' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  platformName?: string;

  @ApiPropertyOptional({ example: 'support@mandi.app' })
  @IsOptional()
  @IsEmail()
  @Length(5, 120)
  supportEmail?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'supportPhone must be exactly 10 digits' })
  supportPhone?: string;

  @ApiPropertyOptional({
    description:
      'When true the storefront shows the maintenance page. It does NOT ' +
      'disable the API — the guard chain is the only thing standing ' +
      'between a caller and the data, and a settings flag is not a guard.',
  })
  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;

  // ── Operations ────────────────────────────────────────────────────

  @ApiPropertyOptional({
    description:
      'Delivery promise in minutes, measured from `placedAt`. The ops ' +
      'board warns at 80% of this and marks a breach past 100%.',
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'slaMinutes must be a whole number of minutes' })
  @Min(5)
  @Max(480)
  slaMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Minimum order age, in minutes, before it may be reported as ' +
      'stuck. A floor on the order age, not extra slack on each ' +
      'per-status threshold.',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'stuckOrderGraceMinutes must be a whole number of minutes' })
  @Min(0)
  @Max(240)
  stuckOrderGraceMinutes?: number;
}
