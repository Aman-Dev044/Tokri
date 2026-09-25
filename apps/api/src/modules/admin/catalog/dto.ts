import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Min,
} from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import { AisleKey } from '../../../common/constants/aisle.enum';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  @Length(2, 80)
  name: string;

  @ApiPropertyOptional({
    description: 'Lowercase kebab-case. Derived from `name` when omitted.',
  })
  @IsOptional()
  @IsString()
  @Matches(SLUG, { message: 'slug must be lowercase kebab-case' })
  @Length(2, 80)
  slug?: string;

  @ApiProperty({ enum: AisleKey })
  @IsEnum(AisleKey)
  aisleKey: AisleKey;

  @ApiPropertyOptional({ description: 'Omit for a platform-global category.' })
  @IsOptional()
  @IsMongoId()
  vendorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  parentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
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
  @Length(2, 80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(SLUG, { message: 'slug must be lowercase kebab-case' })
  @Length(2, 80)
  slug?: string;

  @ApiPropertyOptional({ enum: AisleKey })
  @IsOptional()
  @IsEnum(AisleKey)
  aisleKey?: AisleKey;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_tld: false })
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListProductsQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  vendorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ enum: AisleKey })
  @IsOptional()
  @IsEnum(AisleKey)
  aisleKey?: AisleKey;

  @ApiPropertyOptional({ description: 'Filter on the active flag.' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Only products whose stock is at or below their threshold.',
  })
  @IsOptional()
  @IsBoolean()
  lowStock?: boolean;
}

export class UpdateProductStatusDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}
