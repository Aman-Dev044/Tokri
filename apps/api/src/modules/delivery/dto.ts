import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

/**
 * Every DTO here is validated by the GLOBAL ValidationPipe with
 * `whitelist: true, forbidNonWhitelisted: true`. An unknown property is
 * REJECTED, not dropped — so a rider client cannot post
 * `{ isOnline: true, completedCount: 500 }` and have the extra field
 * reach a service that happens to spread it.
 */

export class AvailabilityDto {
  @ApiProperty({
    description:
      'Connected and taking work at all. Going offline while carrying an ' +
      'order is refused — finish it or hand it back first.',
  })
  @IsBoolean()
  isOnline: boolean;

  @ApiProperty({
    description:
      'Willing to receive a new offer. A rider can be online (visible on ' +
      'the dispatch board, location updating) but unavailable.',
  })
  @IsBoolean()
  isAvailable: boolean;
}

export class RejectOfferDto {
  @ApiPropertyOptional({
    description: 'Why the rider declined. Feeds the dispatch quality view.',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @Matches(/^.{3,200}$/s, { message: 'reason must be 3-200 characters' })
  reason?: string;
}

export class DeliverOrderDto {
  @ApiProperty({
    description:
      'The proof-of-delivery OTP read out by the customer. Compared ' +
      'against a HASH in constant time; never logged, never echoed back.',
    example: '0000',
  })
  @Matches(/^\d{4,6}$/, { message: 'otp must be 4 to 6 digits' })
  otp: string;

  @ApiPropertyOptional({
    description: 'Optional handover photo, already uploaded to storage.',
  })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  photoUrl?: string;
}

export class FailDeliveryDto {
  @ApiProperty({
    description:
      'Mandatory. A failed delivery becomes a support case and somebody ' +
      'has to be able to read what happened.',
    minLength: 3,
    maxLength: 500,
  })
  @IsString()
  @Matches(/^.{3,500}$/s, { message: 'reason must be 3-500 characters' })
  reason: string;
}

export class LocationPingDto {
  @ApiProperty({ example: 12.9716, description: 'Degrees, -90 to 90.' })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 77.5946, description: 'Degrees, -180 to 180.' })
  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @ApiPropertyOptional({ description: 'Metres, as reported by the handset.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  accuracy?: number;

  @ApiPropertyOptional({ description: 'Degrees clockwise from north, 0-359.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(359)
  heading?: number;
}

export class DeliveryHistoryQueryDto extends PaginationQueryDto {}

export class EarningsQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive ISO-8601 start. Defaults to 30 days ago.',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive ISO-8601 end. Defaults to now.',
    example: '2026-09-25',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
