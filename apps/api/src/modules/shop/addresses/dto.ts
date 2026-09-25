import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

/**
 * A delivery address.
 *
 * ── Why the coordinates are required ───────────────────────────────────
 * Serviceability, rider assignment and the ETA all run off the stored
 * `2dsphere` point. §8.7 #11 is explicit: geocode ONCE, when the address
 * is saved, and never on render — a Maps call per page view is both a
 * latency tax and, at grocery volumes, a bill worth noticing. So the
 * client geocodes at save time and sends the result here.
 */
export class CreateAddressDto {
  @ApiPropertyOptional({ default: 'Home' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  label?: string;

  @ApiProperty()
  @IsString()
  @Length(3, 200)
  line1: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 200)
  line2?: string;

  @ApiProperty()
  @IsString()
  @Length(2, 80)
  city: string;

  @ApiProperty({ example: '560034' })
  @Matches(/^\d{6}$/, { message: 'pincode must be 6 digits' })
  pincode: string;

  @ApiProperty({ example: 12.9302 })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 77.6201 })
  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @ApiProperty({ example: '9800000000' })
  @Matches(/^\d{10}$/, { message: 'phone must be 10 digits' })
  phone: string;

  @ApiPropertyOptional({
    description: 'Make this the default. The previous default is demoted.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
