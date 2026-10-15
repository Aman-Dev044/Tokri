import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { IsNotCommonPassword } from './common-password.validator';

/** 10-digit phone number, no country code, no separators. */
export const PHONE_PATTERN = /^\d{10}$/;

export class RequestOtpDto {
  @ApiProperty({ example: '9876543210', description: '10-digit phone number' })
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be 10 digits' })
  phone: string;
}

export class VerifyOtpDto {
  @ApiProperty({ description: 'requestId returned by request-otp' })
  @IsMongoId()
  requestId: string;

  @ApiProperty({ example: '9876543210', description: '10-digit phone number' })
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'phone must be 10 digits' })
  phone: string;

  @ApiProperty({ example: '482913', description: '6-digit code' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be 6 digits' })
  otp: string;
}

/**
 * The final signup step. Deliberately has NO `phone` field — the phone
 * comes only from the verified claim inside `registrationToken`, so this
 * call cannot be used to attach a password to a number that was never
 * proven to belong to the caller. It also has no `role` field: every
 * account created here is a CUSTOMER, and the global `ValidationPipe`
 * (`forbidNonWhitelisted: true`) turns an attempt to smuggle one in
 * (`{ role: 'admin' }`) into a 400 rather than a silently ignored field.
 */
export class RegisterDto {
  @ApiProperty({
    description: 'Short-lived token proving the phone was verified (from verify-otp)',
  })
  @IsString()
  @IsNotEmpty()
  registrationToken: string;

  @ApiProperty({ example: 'Aman Sharma' })
  @IsString()
  @Matches(/^.{2,80}$/, { message: 'name must be 2-80 characters' })
  name: string;

  @ApiProperty({
    minLength: 8,
    description: 'Minimum 8 characters; not one of the 20 most common passwords.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @IsNotCommonPassword()
  password: string;

  @ApiPropertyOptional({ example: 'aman@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
