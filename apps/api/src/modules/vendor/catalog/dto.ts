import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { AisleKey } from '../../../common/constants/aisle.enum';
import { ProductUnit } from '../../../database/schemas/product.schema';
import { VendorListQueryDto } from '../common/dto';

// ── Categories ────────────────────────────────────────────────────────

export class CreateCategoryDto {
  @ApiProperty({ example: 'Leafy Greens' })
  @IsString()
  @Matches(/^.{2,80}$/)
  name: string;

  @ApiProperty({
    enum: AisleKey,
    description:
      'One of the eight chromatic aisles. Closed enum: an unrecognised ' +
      'key has no hue and renders as an uncoloured hole in the customer UI.',
  })
  @IsEnum(AisleKey)
  aisleKey: AisleKey;

  @ApiPropertyOptional({ description: 'Parent category id, same tenant.' })
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @ApiPropertyOptional({ description: 'Absolute URL, https only.' })
  @IsOptional()
  @IsString()
  @Matches(/^https:\/\/\S{3,500}$/)
  imageUrl?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^.{2,80}$/)
  name?: string;

  @ApiPropertyOptional({ enum: AisleKey })
  @IsOptional()
  @IsEnum(AisleKey)
  aisleKey?: AisleKey;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^https:\/\/\S{3,500}$/)
  imageUrl?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 9999 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Products ──────────────────────────────────────────────────────────

export class CreateProductDto {
  @ApiProperty({ example: 'Alphonso Mango' })
  @IsString()
  @Matches(/^.{2,140}$/)
  name: string;

  @ApiProperty({ description: 'Global or own category.' })
  @IsMongoId()
  categoryId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^.{0,2000}$/s)
  description?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 8 })
  @IsOptional()
  @IsString({ each: true })
  @Matches(/^https:\/\/\S{3,500}$/, { each: true })
  @ArrayMaxSize(8)
  images?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^.{0,80}$/)
  brand?: string;

  @ApiProperty({ enum: ProductUnit })
  @IsEnum(ProductUnit)
  unit: ProductUnit;

  @ApiProperty({ example: 500, description: 'Quantity in `unit`.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  unitValue: number;

  @ApiProperty({ example: 'MND-2001', description: 'Unique per vendor.' })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{2,40}$/, {
    message: 'sku may contain letters, digits, dot, underscore and hyphen',
  })
  sku: string;

  @ApiProperty({ description: 'INTEGER PAISE. Rs 149.50 is 14950.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  mrp: number;

  @ApiProperty({ description: 'INTEGER PAISE. Must not exceed `mrp`.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  price: number;

  @ApiPropertyOptional({
    description: 'Opening stock. Creates the inventory row and its log.',
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  openingStock?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowStockThreshold?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^.{2,140}$/)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^.{0,2000}$/s)
  description?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 8 })
  @IsOptional()
  @IsString({ each: true })
  @Matches(/^https:\/\/\S{3,500}$/, { each: true })
  @ArrayMaxSize(8)
  images?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^.{0,80}$/)
  brand?: string;

  @ApiPropertyOptional({ enum: ProductUnit })
  @IsOptional()
  @IsEnum(ProductUnit)
  unit?: ProductUnit;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  unitValue?: number;

  @ApiPropertyOptional({ description: 'INTEGER PAISE.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  mrp?: number;

  @ApiPropertyOptional({ description: 'INTEGER PAISE.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListProductsQueryDto extends VendorListQueryDto {
  @ApiPropertyOptional({ description: 'Filter to one category.' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Only rows at or under their low-stock threshold.',
  })
  @IsOptional()
  @IsBoolean()
  lowStock?: boolean;
}

// ── Image upload ──────────────────────────────────────────────────────

/**
 * The file NEVER passes through the API — the client PUTs it straight to
 * object storage with the signed URL this returns. Routing image bytes
 * through a Node process is how an API server ends up memory-bound on a
 * 5 MB upload from every vendor at once.
 *
 * `sizeBytes` is required because it is SIGNED into the URL as
 * `content-length`. That is what makes the 5 MB cap real rather than a
 * client-side suggestion: an upload of any other length fails the
 * signature check at S3.
 */
export class PresignImageDto {
  @ApiProperty({
    example: 'image/webp',
    description: 'Allowlisted: image/jpeg, image/png, image/webp, image/avif.',
  })
  @IsString()
  @Matches(/^image\/(jpeg|png|webp|avif)$/, {
    message: 'contentType must be image/jpeg, image/png, image/webp or image/avif',
  })
  contentType: string;

  @ApiProperty({ description: 'Exact byte length. Hard cap 5 MB.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  sizeBytes: number;
}
