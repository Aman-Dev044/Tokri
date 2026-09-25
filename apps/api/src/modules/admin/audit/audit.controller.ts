import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Paginated } from '../../../common/dto/paginated';
import { AuditLogResponse, AuditService } from './audit.service';
import { ListAuditLogsQueryDto } from './dto';

@ApiTags('admin/audit')
@ApiBearerAuth()
@Controller('admin/audit-logs')
@Roles(Role.ADMIN)
export class AdminAuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({
    summary: 'The admin audit trail (paginated)',
    description:
      'Filter by actor, action substring, entity, entity id and date ' +
      'range. Newest first. Values were passed through the secret ' +
      'scrubber before being stored, so no credential material appears.',
  })
  list(
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<Paginated<AuditLogResponse>> {
    return this.audit.list(query);
  }
}
