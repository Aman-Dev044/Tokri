import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional, IsString, Length } from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../../common/constants/order-status.enum';

export class ListOrdersQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  vendorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional({ enum: PaymentMethod })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;
}

export class CancelOrderDto {
  @ApiProperty({
    description:
      'Why the order was cancelled. Mandatory: a cancellation moves money ' +
      'and the customer will be told what this says.',
  })
  @IsString()
  @Length(3, 500)
  reason: string;
}
