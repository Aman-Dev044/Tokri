import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import { UserStatus } from '../../../common/constants/roles.enum';

export class ListTeamQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

/**
 * Body of `POST /admin/team`.
 *
 * NOTE WHAT IS ABSENT: there is no `role` field and no `status` field.
 * The role is fixed to ADMIN by the service, so this endpoint cannot mint
 * a SUPER_ADMIN even if the caller is one. The only super-admin on the
 * platform is the one the seed script provisions from `.env`, which keeps
 * the highest privilege out of reach of a stolen admin session and off
 * any API path at all.
 */
export class CreateTeamMemberDto {
  @ApiProperty({ example: 'Priya Nair' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @ApiProperty({ example: 'priya@example.com' })
  @IsEmail()
  @MaxLength(120)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({ example: '9876543210', description: '10-digit phone number' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be exactly 10 digits' })
  phone: string;

  @ApiProperty({
    minLength: 12,
    maxLength: 128,
    description:
      'Minimum 12 characters. Length is the property that matters ' +
      '(NIST 800-63B); composition rules mostly produce "Password1!".',
  })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;
}

export class UpdateTeamStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status: UserStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}
