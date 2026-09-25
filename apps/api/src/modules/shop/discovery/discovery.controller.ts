import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../../../common/decorators/public.decorator';
import { Paginated } from '../../../common/dto/paginated';
import {
  AisleGroup,
  DiscoveryService,
  ProductDetail,
  ProductRow,
  StoreDetail,
  StoreRow,
} from './discovery.service';
import { BrowseProductsQueryDto, BrowseStoresQueryDto } from './dto';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  BROWSE BEFORE LOGIN — the public half of the customer API
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every route here carries `@Public()`, and every one of them is listed in
 * `test/integration/public-routes.spec.ts`. That test asserts the public
 * set EXACTLY, so nothing can quietly join it.
 *
 * Why these five and nothing else: they return CATALOGUE — which stores
 * exist, what they stock, what it costs. None of it is personal, none of
 * it is writable, and a grocery app that demands a login before it will
 * show a price loses the customer at the front door. The moment anything
 * here becomes personal (a saved store, a recent search), it stops being
 * public.
 */
@ApiTags('shop/discovery')
@Controller()
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Public()
  @Get('stores')
  @ApiOperation({
    summary: 'Serviceable stores, nearest first',
    description:
      'With `lat`/`lng` the list is a $geoNear ranked by distance and ' +
      'filtered to stores whose own serviceRadiusKm actually covers the ' +
      'caller. Without them it is an ordinary list ranked by rating, and ' +
      '`distanceKm` is null.',
  })
  @ApiOkResponse({ description: '{ data: StoreRow[], meta }' })
  browseStores(
    @Query() query: BrowseStoresQueryDto,
  ): Promise<Paginated<StoreRow>> {
    return this.discovery.browseStores(query);
  }

  @Public()
  @Get('stores/:slug')
  @ApiOperation({ summary: 'One store by slug' })
  @ApiNotFoundResponse({ description: 'No approved store with that slug.' })
  storeBySlug(@Param('slug') slug: string): Promise<StoreDetail> {
    return this.discovery.storeBySlug(slug);
  }

  @Public()
  @Get('stores/:id/categories')
  @ApiOperation({
    summary: 'The store\'s categories, grouped into the eight aisles',
    description:
      'Empty categories are omitted — an aisle tile that leads to zero ' +
      'products is a dead end.',
  })
  storeCategories(@Param('id') id: string): Promise<AisleGroup[]> {
    return this.discovery.storeCategories(id);
  }

  @Public()
  @Get('stores/:id/products')
  @ApiOperation({
    summary: 'The store catalogue',
    description:
      'Filters: `category` (id or slug), `aisleKey`, `q` (text index). ' +
      'Sorts: name, -name, price, -price, createdAt, -createdAt, ' +
      'relevance (requires `q`). Each row carries live `inStock` / ' +
      '`availableQty` read from the inventory collection.',
  })
  browseProducts(
    @Param('id') id: string,
    @Query() query: BrowseProductsQueryDto,
  ): Promise<Paginated<ProductRow>> {
    return this.discovery.browseProducts(id, query);
  }

  @Public()
  @Get('products/:id')
  @ApiOperation({ summary: 'One product, with its store and live stock' })
  @ApiNotFoundResponse({
    description:
      'Unknown, inactive, or sold by a store that is not approved. All ' +
      'three are the same 404 — the distinction would be an oracle.',
  })
  productById(@Param('id') id: string): Promise<ProductDetail> {
    return this.discovery.productById(id);
  }
}
