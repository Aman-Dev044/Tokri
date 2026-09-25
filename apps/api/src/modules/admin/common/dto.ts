import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * `?from=&to=` — an inclusive ISO-8601 window.
 *
 * Validated as ISO-8601 rather than accepted as a free string: `new Date()`
 * silently produces `Invalid Date` for anything it cannot parse, and an
 * `Invalid Date` inside a `$gte` matches NOTHING. A mistyped filter would
 * quietly render an empty dashboard instead of an error.
 */
export class DateRangeQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive start, ISO-8601. Defaults to 30 days ago.',
    example: '2026-08-25T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive end, ISO-8601. Defaults to now.',
    example: '2026-09-24T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Pagination + a free-text term + the date window, for list endpoints. */
export class AdminListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search term.' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;

  @ApiPropertyOptional({ description: 'Inclusive start, ISO-8601.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive end, ISO-8601.' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

/**
 * Escapes regex metacharacters so a search term is matched literally.
 * Without it, `q=.*` returns the whole collection and `q=(a+)+$` is a
 * ReDoS aimed at the database process.
 */
export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
