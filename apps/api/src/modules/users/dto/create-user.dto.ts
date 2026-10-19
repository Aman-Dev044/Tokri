import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '../../../common/constants/roles.enum';

/**
 * Body of `POST /users` — reachable by SUPER_ADMIN only.
 *
 * ── Why `role` is allowed here but nowhere else ──────────────────────────
 * This is the one endpoint whose entire purpose is provisioning an account
 * on someone else's behalf, and it is gated by `@Roles(Role.SUPER_ADMIN)`.
 * No self-service DTO anywhere in the API carries `role` or `status`, so a
 * customer cannot promote themselves by adding a field to a request body.
 * `forbidNonWhitelisted: true` turns any such attempt into a 400.
 *
 * `status` is absent even here: a new account's status is derived by the
 * service from its role (vendors start PENDING and must be approved).
 * SUPER_ADMIN cannot be created through the API at all — the only
 * super-admin is the one the seed script provisions from `.env`.
 */
export class CreateUserDto {
  @ApiProperty({ example: 'Priya Nair' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @ApiPropertyOptional({ example: 'priya@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email?: string;

  @ApiProperty({ example: '9876543210', description: '10-digit phone number' })
  @IsString()
  @Matches(/^\d{10}$/, { message: 'phone must be exactly 10 digits' })
  phone: string;

  /**
   * Minimum 12 characters. NIST 800-63B: length is the property that
   * matters; composition rules mostly produce `Password1!`.
   */
  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;

  @ApiProperty({
    enum: [Role.ADMIN, Role.VENDOR, Role.CUSTOMER, Role.DELIVERY],
    description:
      'SUPER_ADMIN cannot be provisioned through the API — only by the seed.',
  })
  @IsEnum(Role)
  role: Role;

  @ApiPropertyOptional({
    description: 'Required for VENDOR and DELIVERY accounts (tenant scope).',
  })
  @IsOptional()
  @IsMongoId()
  vendorId?: string;
}
