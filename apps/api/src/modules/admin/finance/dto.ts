import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import { SettlementStatus } from '../../../database/schemas/settlement.schema';
import { LedgerEntryType } from '../../../database/schemas/ledger-entry.schema';

export class ListSettlementsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  status?: SettlementStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  vendorId?: string;
}

export class GenerateSettlementsDto {
  @ApiProperty({
    description:
      'Inclusive period start, ISO-8601. Normalised to 00:00:00.000 UTC.',
    example: '2026-09-14T00:00:00.000Z',
  })
  @IsISO8601()
  periodStart: string;

  @ApiProperty({
    description:
      'Inclusive period end, ISO-8601. Normalised to 23:59:59.999 UTC.',
    example: '2026-09-20T23:59:59.999Z',
  })
  @IsISO8601()
  periodEnd: string;

  @ApiPropertyOptional({
    description: 'Restrict to one vendor. Omit to settle every vendor.',
  })
  @IsOptional()
  @IsMongoId()
  vendorId?: string;
}

export class PaySettlementDto {
  @ApiProperty({
    description: 'Bank/UTR reference for the transfer. Recorded on the row.',
  })
  @IsString()
  @Length(3, 120)
  reference: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 500)
  note?: string;
}

export class ListLedgerQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  vendorId?: string;

  @ApiPropertyOptional({ enum: LedgerEntryType })
  @IsOptional()
  @IsEnum(LedgerEntryType)
  type?: LedgerEntryType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  settlementId?: string;
}
