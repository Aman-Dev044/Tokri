import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { InventoryReason } from '../../../database/schemas/inventory-log.schema';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { VendorListQueryDto } from '../common/dto';

/**
 * The reasons a VENDOR may cite.
 *
 * `order_reserve`, `order_release` and `order_commit` are written by the
 * checkout and delivery paths and are deliberately absent: a vendor who
 * could log a manual change as `order_commit` would make the stock trail
 * un-auditable, because nothing would distinguish a genuine sale from a
 * hand-typed correction.
 */
export enum VendorInventoryReason {
  RESTOCK = InventoryReason.RESTOCK,
  MANUAL = InventoryReason.MANUAL,
}

export class ListInventoryQueryDto extends VendorListQueryDto {
  @ApiPropertyOptional({
    description: 'Only rows at or under their low-stock threshold.',
  })
  @IsOptional()
  @IsBoolean()
  lowStock?: boolean;

  @ApiPropertyOptional({ description: 'Only rows with zero stock.' })
  @IsOptional()
  @IsBoolean()
  outOfStock?: boolean;

  @ApiPropertyOptional({ description: 'Filter to one category.' })
  @IsOptional()
  @IsMongoId()
  categoryId?: string;
}

/**
 * Stock is ADJUSTED, never SET.
 *
 * A `{ stock: 40 }` write destroys the information that makes the ledger
 * reconstructable: two concurrent sets silently discard one another,
 * whereas two `$inc`s both land. `delta` plus the append-only
 * `InventoryLog` means the current quantity is always the sum of its own
 * history — which is what lets a disputed count be settled from the data
 * rather than from memory.
 */
export class AdjustStockDto {
  @ApiProperty({
    description: 'Signed change. +25 on a restock, -2 on breakage.',
    example: 25,
  })
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  delta: number;

  @ApiProperty({ enum: VendorInventoryReason })
  @IsEnum(VendorInventoryReason)
  reason: VendorInventoryReason;

  @ApiPropertyOptional({ description: 'Free-text note, recorded in the audit trail.' })
  @IsOptional()
  @IsString()
  @Matches(/^.{1,200}$/s)
  note?: string;

  @ApiPropertyOptional({
    description: 'Optionally move the low-stock threshold in the same call.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowStockThreshold?: number;
}

export class BulkAdjustmentItemDto {
  @ApiProperty()
  @IsMongoId()
  productId: string;

  @ApiProperty({ example: -3 })
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  delta: number;

  @ApiPropertyOptional({ enum: VendorInventoryReason })
  @IsOptional()
  @IsEnum(VendorInventoryReason)
  reason?: VendorInventoryReason;
}

/**
 * One transaction for the whole batch: a stock-take that applied 40 of
 * its 60 lines and then failed leaves the vendor with no way to know
 * which 20 to retype. All or nothing.
 */
export class BulkAdjustStockDto {
  @ApiProperty({ type: [BulkAdjustmentItemDto], minItems: 1, maxItems: 200 })
  @ValidateNested({ each: true })
  @Type(() => BulkAdjustmentItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  adjustments: BulkAdjustmentItemDto[];

  @ApiPropertyOptional({ enum: VendorInventoryReason, default: 'manual' })
  @IsOptional()
  @IsEnum(VendorInventoryReason)
  reason?: VendorInventoryReason;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^.{1,200}$/s)
  note?: string;
}

/** `GET /vendor/inventory/:productId/logs?page=&limit=` — no extra filters. */
export class ListInventoryLogsQueryDto extends PaginationQueryDto {}
