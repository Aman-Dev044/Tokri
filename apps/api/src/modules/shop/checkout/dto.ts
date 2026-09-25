import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString, Length } from 'class-validator';

import { PaymentMethod } from '../../../common/constants/order-status.enum';

/**
 * `POST /checkout/validate`
 *
 * Note what is NOT here: items, quantities, prices, totals. The basket
 * comes from the CART COLLECTION and the prices from the PRODUCT
 * collection. A client-sent price is never an input to anything — see
 * `PricingService`.
 */
export class ValidateCheckoutDto {
  @ApiProperty({ description: 'The store being checked out.' })
  @IsMongoId()
  vendorId: string;

  @ApiPropertyOptional({
    description: 'Drop address. Serviceability is checked against it.',
  })
  @IsOptional()
  @IsMongoId()
  addressId?: string;

  @ApiPropertyOptional({ example: 'MANDI50' })
  @IsOptional()
  @IsString()
  @Length(3, 40)
  couponCode?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

/** `POST /checkout` — the address and the payment method are now required. */
export class PlaceOrderDto {
  @ApiProperty()
  @IsMongoId()
  vendorId: string;

  @ApiProperty()
  @IsMongoId()
  addressId: string;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @ApiPropertyOptional({ example: 'MANDI50' })
  @IsOptional()
  @IsString()
  @Length(3, 40)
  couponCode?: string;
}
