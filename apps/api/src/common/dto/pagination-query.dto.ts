import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * The shared shape for every list endpoint (§6.1 of the implementation plan):
 *
 *     ?page=1&limit=20&sort=-createdAt
 *
 * `limit` is hard-capped at 100. Without a cap, `?limit=1000000` is a free
 * denial-of-service primitive and a bulk-export of the collection.
 *
 * `sort` is deliberately NOT passed to Mongoose verbatim. It matches a
 * conservative identifier pattern here, and every service additionally
 * checks it against an explicit allowlist of sortable fields — a sort key
 * is attacker-controlled input, and an arbitrary one leaks index structure
 * and can be used to order by a field the caller may not read.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Field name, optionally prefixed with `-` for descending.',
    example: '-createdAt',
  })
  @IsOptional()
  @Matches(/^-?[a-zA-Z][a-zA-Z0-9_]{0,39}$/, {
    message: 'sort must be a field name, optionally prefixed with "-"',
  })
  sort?: string;
}
