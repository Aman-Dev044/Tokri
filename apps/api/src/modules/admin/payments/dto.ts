import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../../common/constants/order-status.enum';

/**
 * `GET /admin/payments` — exactly what `PaymentsView` sends.
 *
 * The page builds its query with `cleanParams({ q, method, status, from,
 * to, page, limit })`, which drops empty strings. Every one of those keys
 * is declared here (q/from/to/page/limit through `AdminListQueryDto`); a
 * key the page sends that this class did not declare would 400 under
 * `forbidNonWhitelisted`, and the page would quietly fall back to its
 * fixture behind the amber banner.
 */
export class ListPaymentsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;
}

export class RefundPaymentDto {
  @ApiProperty({
    description:
      'INTEGER PAISE to return. At most the order total minus what has ' +
      'already been refunded.',
    example: 12_500,
  })
  @Type(() => Number)
  @IsInt({ message: 'amountPaise must be a whole number of paise' })
  @Min(1)
  amountPaise: number;

  @ApiProperty({
    description: 'Why. Recorded on the ledger row and in the audit log.',
  })
  @IsString()
  @Length(3, 500)
  reason: string;
}
