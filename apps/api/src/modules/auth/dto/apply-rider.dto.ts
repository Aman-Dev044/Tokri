import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

import { VehicleType } from '../../../database/schemas/delivery-partner.schema';
import { IsNotCommonPassword } from './common-password.validator';
import { PHONE_PATTERN } from './register.dto';

/**
 * A rider's self-service application to the shared PLATFORM pool
 * (`vendorId: null`). A store's own riders are created by the vendor
 * directly via `POST /vendor/delivery-partners` (`VendorPartnersService`)
 * — that flow already exists and is not duplicated here.
 *
 * No `role`, no `vendorId`: this always lands in the platform pool,
 * PENDING, exactly like a vendor application — see
 * `RegistrationService.applyRider`.
 */
export class ApplyRiderDto {
  @ApiProperty({ example: 'Ramesh Kadam' })
  @IsString()
  @Matches(/^.{2,80}$/, { message: 'name must be 2-80 characters' })
  name: string;

  @ApiPropertyOptional({ example: 'ramesh@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

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

  @ApiProperty({ enum: VehicleType })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;
}
