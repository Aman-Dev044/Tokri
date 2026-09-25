import { ApiProperty } from '@nestjs/swagger';

/** `meta` block returned by every list endpoint. */
export class PaginationMeta {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 137, description: 'Total matching documents.' })
  total: number;

  @ApiProperty({ example: 7, description: 'Total number of pages.' })
  pages: number;
}

/** `{ data, meta }` — the list envelope mandated by §6.1. */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Builds the envelope from a page of documents and the matching total.
 *
 * Centralised so `pages` is never miscomputed per-endpoint (a wrong page
 * count is how "page 4 of 3" bugs and silent truncation happen).
 */
export function paginate<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
): Paginated<T> {
  return {
    data,
    meta: {
      page,
      limit,
      total,
      pages: limit > 0 ? Math.ceil(total / limit) : 0,
    },
  };
}
