import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, UserStatus } from '../../../common/constants/roles.enum';

/**
 * The ONLY shape a user is ever serialised into.
 *
 * Built by an explicit projection rather than by spreading the Mongoose
 * document, so a field added to the schema later (an OTP secret, a KYC
 * document URL, a payout account) cannot leak into an API response by
 * accident. Opt-in, not opt-out.
 */
export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  email: string | null;

  @ApiProperty()
  phone: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ enum: UserStatus })
  status: UserStatus;

  @ApiProperty({ nullable: true })
  vendorId: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  lastLoginAt: string | null;

  @ApiProperty({
    description: 'True for the bootstrap accounts created by the seed script.',
  })
  isSystemAccount: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
}
