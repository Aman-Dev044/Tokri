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
  Max,
  Min,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AisleKey } from '../../../common/constants/aisle.enum';

/**
 * `GET /stores?lat=&lng=&radius=&q=`
 *
 * `lat` and `lng` are optional but go together — a lone latitude is a
 * client bug, and silently ignoring half a coordinate would return a
 * nationwide list to someone who asked "what is near me".
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
