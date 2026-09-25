import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DateRangeQueryDto } from '../common/dto';

export class AnalyticsRangeQueryDto extends DateRangeQueryDto {}

export class TimeseriesQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({
    enum: ['gmv', 'orders', 'aov'],
    default: 'gmv',
    description: 'gmv and aov are INTEGER PAISE; orders is a count.',
  })
  @IsOptional()
  @IsIn(['gmv', 'orders', 'aov'])
  metric?: 'gmv' | 'orders' | 'aov' = 'gmv';

  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  interval?: 'day' | 'week' | 'month' = 'day';
}

export class TopQueryDto extends DateRangeQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
