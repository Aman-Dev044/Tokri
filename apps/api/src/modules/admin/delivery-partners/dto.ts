import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsMongoId, IsOptional, IsString, Length } from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import {
  PartnerStatus,
  VehicleType,
} from '../../../database/schemas/delivery-partner.schema';

export class ListPartnersQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ enum: PartnerStatus })
  @IsOptional()
  @IsEnum(PartnerStatus)
  status?: PartnerStatus;

  @ApiPropertyOptional({ enum: VehicleType })
  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @ApiPropertyOptional({ description: 'Riders belonging to one vendor.' })
  @IsOptional()
  @IsMongoId()
  vendorId?: string;
}

export class UpdatePartnerStatusDto {
  @ApiProperty({ enum: PartnerStatus })
  @IsEnum(PartnerStatus)
  status: PartnerStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}
