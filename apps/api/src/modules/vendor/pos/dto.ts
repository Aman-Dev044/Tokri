import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  PosPaymentMode,
  PosSaleStatus,
} from '../../../database/schemas/pos-sale.schema';
import { VendorListQueryDto } from '../common/dto';

export class PosProductQueryDto {
  @ApiProperty({
    description:
      'Name, SKU or the exact barcode. A scanner types the code plus Enter.',
    example: '8901063010277',
  })
  @IsString()
  @Matches(/^.{1,64}$/s)
  q: string;
}

/**
 * One line of a sale — WHAT and HOW MANY, nothing else.
 *
 * There is deliberately no price, name or tax field here. Under
 * `forbidNonWhitelisted` a client that sends `price` gets a 400, and the
 * server reads every figure from the product. A till that trusted the
 * browser's arithmetic would let anybody with dev tools sell the shop's
 * stock for a rupee.
 */
export class PosSaleLineDto {
  @ApiProperty()
  @IsMongoId()
  productId: string;

  @ApiProperty({ minimum: 1, maximum: 9999 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  qty: number;
}

export class CreatePosSaleDto {
  @ApiProperty({ type: [PosSaleLineDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PosSaleLineDto)
  items: PosSaleLineDto[];

  @ApiProperty({ enum: PosPaymentMode })
  @IsEnum(PosPaymentMode)
  paymentMode: PosPaymentMode;

  @ApiPropertyOptional({
    description: 'INTEGER PAISE. Required for cash; must cover the total.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  cashTenderedPaise?: number;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'customerPhone must be 10 digits' })
  customerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^.{1,80}$/)
  customerName?: string;

  @ApiPropertyOptional({
    description: 'INTEGER PAISE off the subtotal. Capped at the subtotal.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  discountPaise?: number;
}

export class ListPosSalesQueryDto extends VendorListQueryDto {
  @ApiPropertyOptional({ enum: PosSaleStatus })
  @IsOptional()
  @IsEnum(PosSaleStatus)
  status?: PosSaleStatus;

  @ApiPropertyOptional({ enum: PosPaymentMode })
  @IsOptional()
  @IsEnum(PosPaymentMode)
  paymentMode?: PosPaymentMode;
}

export class VoidPosSaleDto {
  @ApiProperty({ example: 'Customer returned the basket unopened' })
  @IsString()
  @Matches(/^.{3,300}$/s, { message: 'reason must be 3-300 characters' })
  reason: string;
}
