import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';

/** Guards against a fat-finger `qty: 99999` emptying a shelf. */
export const MAX_QTY_PER_LINE = 20;

export class GetCartQueryDto {
  @ApiPropertyOptional({
    description:
      'Which store\'s cart to read. Omitted, the ACTIVE cart is returned.',
  })
  @IsOptional()
  @IsMongoId()
  vendorId?: string;
}

/**
 * `POST /cart/items` — adds to the line, it does not replace it.
 *
 * Sending `{ qty: 1 }` twice leaves 2 in the basket, which is what a
 * customer tapping "+" twice means. `PATCH` is the absolute set.
 */
export class AddCartItemDto {
  @ApiProperty({ description: 'The store this product belongs to.' })
  @IsMongoId()
  vendorId: string;

  @ApiProperty()
  @IsMongoId()
  productId: string;

  @ApiProperty({ minimum: 1, maximum: MAX_QTY_PER_LINE, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QTY_PER_LINE)
  qty?: number = 1;
}

/** `PATCH /cart/items/:productId` — sets the line to an absolute quantity. */
export class UpdateCartItemDto {
  @ApiProperty({ minimum: 1, maximum: MAX_QTY_PER_LINE })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QTY_PER_LINE)
  qty: number;
}

/**
 * `POST /cart/park` — set the current basket aside.
 *
 * `vendorId` is an assertion, not a selector: the client says which cart
 * it believes is active, and a mismatch is a 409 rather than a silently
 * parked basket the customer was still using.
 */
export class ParkCartDto {
  @ApiPropertyOptional({
    description: 'The vendor whose cart the client believes is active.',
  })
  @IsOptional()
  @IsMongoId()
  vendorId?: string;
}
