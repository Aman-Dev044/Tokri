import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsMongoId, IsOptional, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by the acting user id.' })
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring of the action label.',
    example: 'vendor.status',
  })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  action?: string;

  @ApiPropertyOptional({ example: 'Vendor' })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  entity?: string;

  @ApiPropertyOptional({ description: 'Id of the audited document.' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  entityId?: string;

  @ApiPropertyOptional({ description: 'Inclusive start, ISO-8601.' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Inclusive end, ISO-8601.' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
