import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** The longest comment an order rating may carry. */
export const ORDER_RATING_COMMENT_MAX = 500;

/**
 * `POST /orders/:id/rating`.
 *
 * `riderRating` is optional: the customer may rate the store and skip the
 * rider. Sending one for an order no rider carried is a 400 rather than a
 * silently dropped number.
 */
export class RateOrderDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  storeRating: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5, nullable: true, example: 4 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  riderRating?: number | null;

  @ApiPropertyOptional({ maxLength: ORDER_RATING_COMMENT_MAX, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  })
  @IsString()
  @MaxLength(ORDER_RATING_COMMENT_MAX)
  comment?: string | null;
}
