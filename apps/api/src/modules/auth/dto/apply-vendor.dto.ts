import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { IsNotCommonPassword } from './common-password.validator';
import { PHONE_PATTERN } from './register.dto';

export class ApplyVendorAddressDto {
  @ApiProperty({ example: '12 Mandi Road' })
  @IsString()
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

/**
 * A prospective vendor's self-service application.
 *
 * Deliberately has NO `commissionPct`, `status`, `slug` or `ownerId` —
 * those are platform decisions, never the applicant's. The global
 * `ValidationPipe` (`forbidNonWhitelisted: true`) turns any attempt to
 * post one of them into a 400. `commissionPct` for the created `Vendor`
 * comes from platform settings' `defaultCommissionPct` instead — see
 * `RegistrationService.applyVendor`.
 */
export class ApplyVendorDto {
  @ApiProperty({ example: 'Priya Sharma' })
  @IsString()
  @Matches(/^.{2,80}$/, { message: 'name must be 2-80 characters' })
  name: string;

  @ApiProperty({ example: 'priya@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '9876543210', description: '10-digit phone number' })
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be 10 digits' })
  phone: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @IsNotCommonPassword()
  password: string;

  @ApiProperty({ example: 'Sharma Fresh Mandi' })
  @IsString()
  @Matches(/^.{2,120}$/, { message: 'storeName must be 2-120 characters' })
  storeName: string;

  @ApiProperty({ type: ApplyVendorAddressDto })
  @ValidateNested()
  @Type(() => ApplyVendorAddressDto)
  address: ApplyVendorAddressDto;

  @ApiProperty({ example: 18.5204 })
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @ApiProperty({ example: 73.8567 })
  @Type(() => Number)
  @IsLongitude()
  lng: number;
}
