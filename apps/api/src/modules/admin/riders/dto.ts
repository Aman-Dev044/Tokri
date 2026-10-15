import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { KycStatus } from '../../../database/schemas/delivery-partner.schema';

/**
 * `GET /admin/riders/kyc?status=&page=&limit=`
 *
 * No `sort`: the queue is ALWAYS ordered by `kycSlaDueAt` ascending —
 * the submission closest to breaching its 24-hour promise, first. A
 * sortable queue is a queue an operator can accidentally work in the
 * wrong order, and the whole point of the SLA is that nobody has to
 * decide what to look at next.
 */
export class ListRiderKycQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: KycStatus,
    description: 'Defaults to SUBMITTED — the queue that needs a human.',
  })
  @IsOptional()
  @IsEnum(KycStatus)
  status?: KycStatus;
}

export class RejectRiderKycDto {
  @ApiProperty({
    description:
      'Shown to the rider verbatim, so it must say what to fix. Mandatory: ' +
      'a rejection with no reason is a rider who resubmits the same thing.',
    minLength: 5,
    maxLength: 300,
  })
  @IsString()
  @Matches(/^.{5,300}$/s, { message: 'reason must be 5-300 characters' })
  reason: string;
}

/**
 * `POST /admin/riders/:id/wallet/credit` — SUPER_ADMIN only.
 *
 * This is how a rider actually gets money on a deployment with no
 * payment gateway. It represents a transfer that happened SOMEWHERE
 * ELSE — a bank transfer, cash at the office — so the note is mandatory
 * and the whole call is audited with the actor attached.
 */
export class CreditRiderWalletDto {
  @ApiProperty({
    description: 'INTEGER PAISE. 2500 is ₹25. Never a float, never rupees.',
    minimum: 1,
    maximum: 10_000_000,
    example: 100_000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountPaise: number;

  @ApiProperty({
    description:
      'Why. Mandatory — an unexplained credit is indistinguishable from ' +
      'theft six months later.',
    minLength: 3,
    maxLength: 300,
  })
  @IsString()
  @Matches(/^.{3,300}$/s, { message: 'note must be 3-300 characters' })
  note: string;
}
