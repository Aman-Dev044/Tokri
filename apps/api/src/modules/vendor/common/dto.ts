import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * `?from=&to=` — an inclusive ISO-8601 window.
 *
 * Validated as ISO-8601 rather than taken as a free string: `new Date()`
 * turns anything it cannot parse into `Invalid Date`, and an
 * `Invalid Date` inside a `$gte` matches NOTHING. A mistyped filter would
 * quietly render an empty earnings page instead of returning an error.
 */
export class VendorDateRangeQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive start, ISO-8601. Defaults to 30 days ago.',
    example: '2026-08-26T00:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive end, ISO-8601. Defaults to now.',
    example: '2026-09-25T23:59:59.999Z',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Pagination + free text + the date window, for vendor list endpoints. */
export class VendorListQueryDto extends PaginationQueryDto {
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
 * Without it `q=.*` returns the whole collection and `q=(a+)+$` is a
 * ReDoS pointed at the database process.
 */
export const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface ResolvedRange {
  from: Date;
  to: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Turns the optional window into a concrete one.
 *
 * A reversed range (`from` after `to`) is swapped rather than rejected:
 * it produces an empty report either way, and a silently empty report is
 * the failure mode this whole file exists to avoid.
 */
export function resolveRange(
  query: { from?: string; to?: string },
  defaultDays = 30,
): ResolvedRange {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - defaultDays * MS_PER_DAY);

  return from.getTime() <= to.getTime() ? { from, to } : { from: to, to: from };
}

/** Midnight local time on the day containing `at`. */
export const startOfDay = (at: Date): Date =>
  new Date(at.getFullYear(), at.getMonth(), at.getDate());

/** `YYYY-MM-DD` in local time, which is what the console displays. */
export const dayKey = (at: Date): string => {
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  return `${at.getFullYear()}-${month}-${day}`;
};

/** ISO-8601, or `null` — every date this API emits is one of the two. */
export const iso = (value: Date | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

/** Lowercase, hyphenated, ASCII-safe. */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/** Mongo duplicate-key error, without importing the `mongodb` package. */
export const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: number }).code === 11000;
