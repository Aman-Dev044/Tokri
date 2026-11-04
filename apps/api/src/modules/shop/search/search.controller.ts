import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../common/decorators/public.decorator';
import {
  POPULAR_LIMIT,
  POPULAR_MIN_COUNT,
  POPULAR_WINDOW_DAYS,
  PopularSearches,
  PopularSearchesService,
} from './popular-searches.service';

/**
 * `GET /search/popular` — public, and listed in
 * `test/integration/public-routes.spec.ts` with its justification.
 *
 * It is an aggregate over counters that never held an identity: the same
 * eight words for every caller, derived from nothing personal.
 */
@ApiTags('shop/search')
@Controller('search')
export class SearchController {
  constructor(private readonly popularSearches: PopularSearchesService) {}

  @Public()
  @Get('popular')
  @ApiOperation({
    summary: 'The most-searched terms of the last week',
    description:
      `Top ${POPULAR_LIMIT} normalised terms over the last ` +
      `${POPULAR_WINDOW_DAYS} UTC days, most searched first. A term needs ` +
      `at least ${POPULAR_MIN_COUNT} searches in the window to appear. ` +
      'Counted anonymously from the first page of `GET /products?q=` ' +
      'and `GET /stores/:id/products?q=`: no user, no IP.',
  })
  @ApiOkResponse({ description: '{ windowDays, terms: { term, count }[] }' })
  popular(): Promise<PopularSearches> {
    return this.popularSearches.popular();
  }
}
