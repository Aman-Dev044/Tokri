import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AisleKey } from '../../../common/constants/aisle.enum';

/**
 * `GET /stores?lat=&lng=&radius=&q=&pincode=`
 *
 * `lat` and `lng` are optional but go together — a lone latitude is a
 * client bug, and silently ignoring half a coordinate would return a
 * nationwide list to someone who asked "what is near me".
 *
 * `pincode` is the fallback for a customer who denied geolocation
 * permission (`useGeolocation.ts`): resolved through the static table in
 * `pincode-table.ts`, never a paid geocoding call. When `lat`/`lng` are
 * ALSO supplied, an actual GPS fix wins — `pincode` is only consulted
 * when neither is present.
 */
export class BrowseStoresQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Customer latitude.', example: 12.9352 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Customer longitude.', example: 77.6101 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    description:
      'Search radius in kilometres (0.5–25). A store is still only ' +
      'returned when the customer is inside ITS OWN serviceRadiusKm.',
    default: 5,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(25)
  radius?: number;

  @ApiPropertyOptional({ description: 'Store-name search term.' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Indian PIN code, used only when lat/lng are absent. Resolved ' +
      'through a small static table of serviceable cities — an unknown ' +
      'PIN is a 400, not a silently empty list.',
    example: '560102',
  })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'pincode must be exactly 6 digits' })
  pincode?: string;
}

/** `GET /stores/:id/products?category=&aisleKey=&q=&sort=&page=` */
export class BrowseProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Category id or category slug.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  category?: string;

  @ApiPropertyOptional({
    enum: AisleKey,
    description: 'Restrict to one chromatic aisle.',
  })
  @IsOptional()
  @IsEnum(AisleKey)
  aisleKey?: AisleKey;

  @ApiPropertyOptional({
    description:
      'Full-text term, matched against the `searchText` text index.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;
}

/**
 * `GET /products?q=&aisleKey=&lat=&lng=&pincode=&page=&limit=`
 *
 * Market-wide: every APPROVED, OPEN vendor, not one store. `lat`/`lng`
 * are for DISPLAY only here (`store.distanceKm` on each row) — there is
 * no radius filter, because a market-wide search across the whole
 * platform is not "near me", it is "does anyone sell this".
 *
 * ── Why `pincode` is here, and why `radius` is NOT ───────────────────────
 * The customer's chosen location is ONE object in the web app
 * (`useGeolocation`), and it is either a device fix or a typed PIN. Both
 * have to be expressible here or the whole product grid 400s the moment
 * someone who denied geolocation types a PIN — `forbidNonWhitelisted` is
 * on, so an unknown param is a hard refusal, not an ignored extra. It
 * resolves through the same static `pincode-table` as `GET /stores` and
 * feeds `store.distanceKm` exactly as `lat`/`lng` would.
 *
 * `radius` stays absent on purpose. It belongs to `GET /stores`, where it
 * FILTERS. Accepting it here would imply a filter this endpoint does not
 * apply, which is worse than refusing it.
 */
export class BrowseMarketProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Full-text term, matched against the `searchText` text index — ' +
      'never a regex scan.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;

  @ApiPropertyOptional({
    enum: AisleKey,
    description: 'Restrict to one chromatic aisle, across every store.',
  })
  @IsOptional()
  @IsEnum(AisleKey)
  aisleKey?: AisleKey;

  @ApiPropertyOptional({ description: 'Customer latitude, for display only.' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Customer longitude, for display only.' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    description:
      'Indian PIN code, consulted only when lat/lng are absent. Same ' +
      'static table as GET /stores; an unlisted PIN is a 400 carrying the ' +
      'serviceable list, not a silently unfiltered page.',
    example: '560102',
  })
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'pincode must be exactly 6 digits' })
  pincode?: string;
}
