import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import {
  AdminOpsIssuesService,
  IssueDetail,
  IssueRow,
} from './ops-issues.service';
import {
  AddIssueMessageDto,
  CreateIssueDto,
  ListIssuesQueryDto,
  UpdateIssueDto,
} from './dto';

@ApiTags('admin/ops')
@ApiBearerAuth()
@Controller('admin/ops/issues')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminOpsIssuesController {
  constructor(private readonly issues: AdminOpsIssuesService) {}

  @Get()
  @ApiOperation({
    summary: 'The support queue (paginated)',
    description:
      'Filters: status, priority, type, assignedToUserId, `q` (code, ' +
      'subject, description) and a created-at window. Default order is ' +
      'urgent first, then newest. Sortable on createdAt, updatedAt, ' +
      'priority, status, code — `priority` sorts by RANK, so `urgent` ' +
      'outranks `high` rather than losing to it alphabetically.',
  })
  list(@Query() query: ListIssuesQueryDto): Promise<Paginated<IssueRow>> {
    return this.issues.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One issue, with the order, customer and vendor resolved',
  })
  @ApiNotFoundResponse({ description: 'Missing or malformed id.' })
  findOne(@Param('id') id: string): Promise<IssueDetail> {
    return this.issues.findById(id);
  }

  @Post()
  @ApiOperation({
    summary: 'Raise an issue',
    description:
      'The `ISS-YYYYMMDD-NNNN` code is allocated server-side against a ' +
      'unique index. Audited.',
  })
  create(
    @Body() dto: CreateIssueDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<IssueDetail> {
    return this.issues.create(dto, actor);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update status, priority, assignee or resolution',
    description:
      'Merge semantics. Moving `status` to `resolved` REQUIRES a ' +
      '`resolution` — supplied in the same request or already recorded — ' +
      'and stamps `resolvedAt`/`resolvedBy`. Reopening clears both. ' +
      'Audited.',
  })
  @ApiBadRequestResponse({
    description: 'Resolved without a resolution, or a non-admin assignee.',
  })
  @ApiNotFoundResponse({ description: 'Missing or malformed id.' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIssueDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<IssueDetail> {
    return this.issues.update(id, dto, actor);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Append to the thread',
    description:
      'A reply on an untouched ticket also moves it from `open` to ' +
      '`in_progress`: somebody has picked it up, and the queue should ' +
      'say so without a second request. Audited.',
  })
  @ApiNotFoundResponse({ description: 'Missing or malformed id.' })
  addMessage(
    @Param('id') id: string,
    @Body() dto: AddIssueMessageDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<IssueDetail> {
    return this.issues.addMessage(id, dto, actor);
  }
}
