import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import {
  PartnerStatus,
  VehicleType,
} from '../../../database/schemas/delivery-partner.schema';

/**
 * `?isOnline=false` must mean false.
 *
 * The global ValidationPipe runs with `enableImplicitConversion`, which
 * turns a query-string boolean into `Boolean("false")` — that is, `true` —
 * BEFORE any `@Transform` sees it. Without this, the console's "Offline"
 * filter asked for the riders who were online. So the ORIGINAL string is
 * read back off `obj`; anything other than the two literal spellings is
 * passed through as the string it was, for `@IsBoolean()` to refuse.
 */
const queryBoolean = ({ obj, key }: TransformFnParams): unknown => {
  const raw: unknown = (obj as Record<string, unknown>)[key];
  if (raw === 'true' || raw === true) return true;
  if (raw === 'false' || raw === false) return false;
  return raw;
};

export const PARTNER_FLEETS = ['vendor', 'pool'] as const;
export type PartnerFleet = (typeof PARTNER_FLEETS)[number];

export class ListPartnersQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  isOnline?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(queryBoolean)
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

  @ApiPropertyOptional({
    enum: PARTNER_FLEETS,
    description:
      '`vendor` — riders attached to any store; `pool` — the shared ' +
      'platform pool (`vendorId: null`).',
  })
  @IsOptional()
  @IsIn(PARTNER_FLEETS)
  fleet?: PartnerFleet;
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
