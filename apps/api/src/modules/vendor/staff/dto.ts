import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';

import { UserStatus } from '../../../common/constants/roles.enum';
import {
  ALL_PERMISSIONS,
  Permission,
  StaffRole,
} from '../../../common/constants/permissions';
import { VendorListQueryDto } from '../common/dto';

export class ListStaffQueryDto extends VendorListQueryDto {
  @ApiPropertyOptional({ enum: [UserStatus.ACTIVE, UserStatus.SUSPENDED] })
  @IsOptional()
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED])
  status?: UserStatus;
}

export class CreateStaffDto {
  @ApiProperty({ example: 'Sunita Pawar' })
  @IsString()
  @Matches(/^.{2,80}$/)
  name: string;

  @ApiProperty({
    example: '9876543210',
    description: '10 digits. Also the sign-in identifier.',
  })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be 10 digits' })
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  /**
   * Hashed with argon2id + the environment pepper before it touches the
   * database, exactly like a rider's. It is never echoed back, never
   * logged, and no endpoint can return it — the client shows it once.
   */
  @ApiProperty({ minLength: 12, description: 'Never stored in plain text.' })
  @IsString()
  @Matches(/^.{12,128}$/s, {
    message: 'password must be 12-128 characters',
  })
  password: string;

  @ApiProperty({ enum: StaffRole })
  @IsEnum(StaffRole)
  staffRole: StaffRole;

  @ApiPropertyOptional({
    enum: Permission,
    isArray: true,
    description: 'Required for CUSTOM, refused for a preset.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ALL_PERMISSIONS.length)
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];

  @ApiPropertyOptional({ example: 'Morning counter', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^.{1,40}$/)
  shiftLabel?: string;
}

export class UpdateStaffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^.{2,80}$/)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: StaffRole })
  @IsOptional()
  @IsEnum(StaffRole)
  staffRole?: StaffRole;

  @ApiPropertyOptional({ enum: Permission, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(ALL_PERMISSIONS.length)
  @IsEnum(Permission, { each: true })
  permissions?: Permission[];

  /** `null` clears it. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((_object, value) => value !== null && value !== undefined)
  @IsString()
  @Matches(/^.{1,40}$/)
  shiftLabel?: string | null;
}

export class UpdateStaffStatusDto {
  @ApiProperty({ enum: [UserStatus.ACTIVE, UserStatus.SUSPENDED] })
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED])
  status: UserStatus.ACTIVE | UserStatus.SUSPENDED;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^.{3,300}$/s)
  reason?: string;
}
