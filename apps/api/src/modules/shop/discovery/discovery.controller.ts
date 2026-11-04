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
  MarketProductRow,
  PincodeResolution,
  ProductDetail,
  ProductRow,
  StoreDetail,
  StoreRow,
} from './discovery.service';
import {
  BrowseMarketProductsQueryDto,
  BrowseProductsQueryDto,
  BrowseStoresQueryDto,
} from './dto';
import { PopularSearchesService } from '../search/popular-searches.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  BROWSE BEFORE LOGIN — the public half of the customer API
 * ════════════════════════════════════════════════════════════════════════
 *
 * Every route here carries `@Public()`, and every one of them is listed in
 * `test/integration/public-routes.spec.ts`. That test asserts the public
 * set EXACTLY, so nothing can quietly join it.
 *
 * Why these six and nothing else: they return CATALOGUE — which stores
 * exist, what they stock, what it costs. None of it is personal, none of
 * it is writable, and a grocery app that demands a login before it will
 * show a price loses the customer at the front door. The moment anything
 * here becomes personal (a saved store, a recent search), it stops being
 * public.
 *
 * `GET /products` (market-wide) joined the set alongside the original
 * five: it is the same CATALOGUE guarantee — every APPROVED, OPEN
 * vendor's products, filtered and paginated — just not scoped to one
 * store first. See `test/integration/public-routes.spec.ts` for the
 * one-line justification recorded there.
 */
@ApiTags('shop/discovery')
@Controller()
export class DiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly popularSearches: PopularSearchesService,
  ) {}

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
    this.countSearch(query);
    return this.discovery.browseProducts(id, query);
  }

  @Public()
  @Get('products')
  @ApiOperation({
    summary: 'Market-wide search and aisle browsing, across every store',
    description:
      'The store-scoped listing above is `GET /stores/:id/products`; this ' +
      'is its platform-wide sibling — every APPROVED, OPEN vendor\'s ' +
      'products, filtered by `q` (the `searchText` text index, never a ' +
      'regex scan) and/or `aisleKey`. Each row carries `store:{id,slug,' +
      'storeName,distanceKm}`; `distanceKm` is null unless `lat`/`lng` ' +
      'or a serviceable `pincode` were supplied. Neither FILTERS here — ' +
      'they only measure. There is no `radius`; that belongs to ' +
      '`GET /stores`, where it actually narrows the list.',
  })
  browseMarketProducts(
    @Query() query: BrowseMarketProductsQueryDto,
  ): Promise<Paginated<MarketProductRow>> {
    this.countSearch(query);
    return this.discovery.browseMarketProducts(query);
  }

  @Public()
  @Get('pincodes/:pincode')
  @ApiOperation({
    summary: 'Resolve a serviceable PIN code to its approximate centre',
    description:
      'The non-map way to get a delivery point. `CreateAddressDto` ' +
      'requires lat/lng, and the web app normally collects them from a ' +
      'map pin — which is unavailable wherever Google Maps is not ' +
      'billed. Reads the same static table as `?pincode=` on the two ' +
      'browse routes; never a paid geocoding call. An unserviceable PIN ' +
      'is a 400 carrying `PINCODE_NOT_SERVICEABLE` and the list that ' +
      'does work.',
  })
  @ApiOkResponse({ description: '{ pincode, city, lat, lng }' })
  resolvePincode(@Param('pincode') pincode: string): PincodeResolution {
    return this.discovery.resolvePincodeCentre(pincode);
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

  /**
   * Feeds `GET /search/popular`. Only the TERM crosses — no user, no IP —
   * and only on the first page, so "show more" is not a second search.
   * `count` returns before its write starts: the search never waits on
   * it and never fails because of it.
   */
  private countSearch(query: { q?: string; page?: number }): void {
    if (query.q && (query.page ?? 1) === 1) this.popularSearches.count(query.q);
  }
}
