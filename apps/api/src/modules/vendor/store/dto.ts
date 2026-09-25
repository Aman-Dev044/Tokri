import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** 24-hour `HH:mm`, the format `Vendor.openingHours` stores. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class StoreAddressDto {
  @ApiProperty({ example: '12 Mandi Road' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^.{3,160}$/s)
  line1: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^.{0,160}$/s)
  line2?: string;

  @ApiProperty({ example: 'Pune' })
  @IsString()
  @Matches(/^.{2,80}$/)
  city: string;

  @ApiProperty({ example: 'Maharashtra' })
  @IsString()
  @Matches(/^.{2,80}$/)
  state: string;

  @ApiProperty({ example: '411001' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' })
  pincode: string;
}

export class StoreLocationDto {
  @ApiProperty({ example: 18.5204 })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 73.8567 })
  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

/**
 * The editable slice of the store profile.
 *
 * `commissionPct`, `status`, `slug`, `rating` and `ownerId` are absent by
 * design — they are platform decisions, not vendor ones. With the global
 * `ValidationPipe` running `forbidNonWhitelisted: true`, sending one of
 * them is a 400 rather than a silently ignored field, so a vendor who
 * tries to re-price their own commission is told no rather than left
 * believing it worked.
 */
export class UpdateStoreProfileDto {
  @ApiPropertyOptional({ example: 'Sharma Fresh Mandi' })
  @IsOptional()
  @IsString()
  @Matches(/^.{2,120}$/)
  storeName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^.{0,1000}$/s)
  description?: string;

  @ApiPropertyOptional({ description: 'Absolute URL, https only.' })
  @IsOptional()
  @IsString()
  @Matches(/^https:\/\/\S{3,500}$/)
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Absolute URL, https only.' })
  @IsOptional()
  @IsString()
  @Matches(/^https:\/\/\S{3,500}$/)
  bannerUrl?: string;

  @ApiPropertyOptional({ type: StoreAddressDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StoreAddressDto)
  address?: StoreAddressDto;

  @ApiPropertyOptional({ type: StoreLocationDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StoreLocationDto)
  location?: StoreLocationDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 25, example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  serviceRadiusKm?: number;

  @ApiPropertyOptional({ description: 'Locked decision #3 — per-vendor.' })
  @IsOptional()
  @IsBoolean()
  codEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'INTEGER PAISE. Platform ceiling is 200000 (Rs 2,000).',
    maximum: 200000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200000)
  codMaxAmount?: number;
}

export class UpdateStoreStatusDto {
  @ApiProperty({ description: 'Whether the store is accepting orders now.' })
  @IsBoolean()
  isOpen: boolean;
}

export class OpeningHourDto {
  @ApiProperty({ minimum: 0, maximum: 6, description: '0 = Sunday.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  day: number;

  @ApiProperty({ example: '07:30' })
  @IsString()
  @Matches(HHMM, { message: 'open must be 24-hour HH:mm' })
  open: string;

  @ApiProperty({ example: '22:00' })
  @IsString()
  @Matches(HHMM, { message: 'close must be 24-hour HH:mm' })
  close: string;
}

export class UpdateStoreHoursDto {
  @ApiProperty({ type: [OpeningHourDto], maxItems: 21 })
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  @ArrayMaxSize(21)
  hours: OpeningHourDto[];
}
