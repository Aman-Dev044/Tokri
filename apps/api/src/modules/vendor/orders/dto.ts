import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
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

import { OrderStatus } from '../../../common/constants/order-status.enum';
import { VendorListQueryDto } from '../common/dto';

export class ListOrdersQueryDto extends VendorListQueryDto {
  @ApiPropertyOptional({
    enum: OrderStatus,
    description: 'Exact status. Omit for every status.',
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}

export class AcceptOrderDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 240,
    description:
      'Promised preparation time in minutes. Recorded on the status ' +
      'history entry and echoed back for the `order.accepted` event.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  etaMinutes?: number;
}

/**
 * The reason is REQUIRED, and that is a product decision, not a
 * validation preference.
 *
 * A rejection is the one moment a customer's order dies at the vendor's
 * hand. "Rejected" with no reason gives support nothing to say, the
 * customer nothing to act on, and the platform no signal about which
 * stores decline work. An optional field here would be empty on most
 * rows within a week.
 */
export class RejectOrderDto {
  @ApiProperty({ minLength: 3, maxLength: 300 })
  @IsString()
  @Matches(/^.{3,300}$/s, {
    message: 'reason is required and must be 3-300 characters',
  })
  reason: string;
}

export class UpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    description:
      'Validated through `canTransition` AND `ALLOWED_ACTOR`. Anything ' +
      'off the state machine is a 409.',
  })
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @ApiPropertyOptional({
    description: 'Required when moving to CANCELLED.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^.{3,300}$/s)
  reason?: string;
}

export class FulfilItemDto {
  @ApiProperty()
  @IsMongoId()
  productId: string;

  @ApiProperty({ description: 'false drops the line and refunds it.' })
  @IsBoolean()
  fulfilled: boolean;
}

/**
 * Partial fulfilment (decision #9).
 *
 * Send EVERY line's desired state, not just the ones that changed: a
 * sparse patch makes "line absent" ambiguous between "leave it alone" and
 * "the client does not know about it", and the second reading silently
 * re-instates a line the vendor already dropped.
 */
export class UpdateOrderItemsDto {
  @ApiProperty({ type: [FulfilItemDto], minItems: 1, maxItems: 200 })
  @ValidateNested({ each: true })
  @Type(() => FulfilItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  items: FulfilItemDto[];

  @ApiPropertyOptional({ description: 'Why lines were dropped.' })
  @IsOptional()
  @IsString()
  @Matches(/^.{3,300}$/s)
  reason?: string;
}

export class AssignPartnerDto {
  @ApiProperty({ description: 'A delivery partner belonging to this store.' })
  @IsMongoId()
  partnerId: string;
}
