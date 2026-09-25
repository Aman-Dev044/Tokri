import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserStatus } from '../../../common/constants/roles.enum';

/**
 * Body of `PATCH /users/:id/status`.
 *
 * ONE mutable field. There is deliberately no `role` here: a status change
 * is an operational action, a role change is a privilege grant, and merging
 * the two would let a compromised ADMIN session escalate an account in the
 * same request it "suspends" it.
 *
 * The global ValidationPipe runs with `forbidNonWhitelisted: true`, so
 * posting `{ "status": "active", "role": "super_admin" }` is rejected with
 * a 400 — the extra property is an error, not something silently dropped.
 */
export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserStatus, example: UserStatus.SUSPENDED })
  @IsEnum(UserStatus)
  status: UserStatus;

  @ApiPropertyOptional({
    description: 'Recorded on the audit trail. Why the status changed.',
    maxLength: 280,
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}
