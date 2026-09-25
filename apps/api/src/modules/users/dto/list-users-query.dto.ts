import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { Role, UserStatus } from '../../../common/constants/roles.enum';

/**
 * Filters for `GET /users`.
 *
 * Note what is NOT here: there is no free-form `filter` object and no
 * `select` parameter. Both are how a list endpoint turns into an arbitrary
 * query interface over the users collection.
 */
export class ListUsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /**
   * Substring match on name / email / phone. Escaped before it reaches
   * Mongo so a caller cannot smuggle a regular expression (`.*` or a
   * catastrophic backtracking pattern) into the query.
   */
  @ApiPropertyOptional({ description: 'Search name, email or phone.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q?: string;
}
