import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { REVIEW_COMMENT_MAX } from '../../database/schemas/product-review.schema';

/**
 * Trim a comment, and turn an all-whitespace one into `null`: "   " is
 * not a comment, and storing it would render an empty quote under the
 * stars.
 */
function blankToNull({ value }: { value: unknown }): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** `GET /products/:id/reviews`. Newest first, always. */
export class ListReviewsQueryDto extends PaginationQueryDto {}

/** `POST /products/:id/reviews`. */
export class CreateReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({
    maxLength: REVIEW_COMMENT_MAX,
    nullable: true,
    example: 'Sweet and ripe, packed carefully.',
  })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(REVIEW_COMMENT_MAX)
  comment?: string | null;
}

/**
 * `PATCH /products/:id/reviews/mine` — either field, or both. An omitted
 * field keeps its value; `comment: null` (or blank) removes the comment.
 */
export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ maxLength: REVIEW_COMMENT_MAX, nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(REVIEW_COMMENT_MAX)
  comment?: string | null;
}

/** `GET /admin/reviews`. */
export class AdminListReviewsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['visible', 'hidden'] })
  @IsOptional()
  @IsIn(['visible', 'hidden'])
  status?: 'visible' | 'hidden';

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'Only reviews of this product.' })
  @IsOptional()
  @IsMongoId()
  productId?: string;
}

/**
 * `PATCH /admin/reviews/:id/visibility`.
 *
 * A reason is required in BOTH directions: hiding a customer's words and
 * restoring them are both editorial decisions somebody may later ask
 * about, and the audit row is only useful if it says why.
 */
export class SetReviewVisibilityDto {
  @ApiProperty({ description: 'true hides the review, false restores it.' })
  @IsBoolean()
  hidden: boolean;

  @ApiProperty({ minLength: 3, maxLength: 300, example: 'Contains a phone number' })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Length(3, 300)
  reason: string;
}
