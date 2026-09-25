import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

import {
  PartnerStatus,
  VehicleType,
} from '../../../database/schemas/delivery-partner.schema';
import { VendorListQueryDto } from '../common/dto';

export class ListPartnersQueryDto extends VendorListQueryDto {
  @ApiPropertyOptional({ enum: PartnerStatus })
  @IsOptional()
  @IsEnum(PartnerStatus)
  status?: PartnerStatus;

  @ApiPropertyOptional({ enum: VehicleType })
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;
}

export class CreatePartnerDto {
  @ApiProperty({ example: 'Ramesh Kadam' })
  @IsString()
  @Matches(/^.{2,80}$/)
  name: string;

  @ApiProperty({ example: '9876543210', description: '10 digits.' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be 10 digits' })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * Hashed with argon2id + the environment pepper before it touches the
   * database — see `PasswordService`. It is never logged: the audit
   * interceptor runs the request body through the same scrubber the
   * exception filter uses, and this service records the partner without
   * the credential.
   */
  @ApiProperty({ minLength: 12, description: 'Never stored in plain text.' })
  @IsString()
  @Matches(/^.{12,128}$/s, {
    message: 'password must be 12-128 characters',
  })
  password: string;

  @ApiProperty({ enum: VehicleType })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;
}

export class UpdatePartnerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^.{2,80}$/)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: VehicleType })
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;
}

/**
 * Administrative state, not the online/offline toggle.
 *
 * A suspended rider is not merely offline — they must not be able to come
 * back on, so the User account moves with the partner record. A suspended
 * rider whose User is still ACTIVE keeps a working token and can carry on
 * calling the delivery endpoints.
 */
export class UpdatePartnerStatusDto {
  @ApiProperty({ enum: PartnerStatus })
  @IsEnum(PartnerStatus)
  status: PartnerStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^.{3,300}$/s)
  reason?: string;
}
