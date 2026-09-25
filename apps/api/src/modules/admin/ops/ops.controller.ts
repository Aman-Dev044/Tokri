import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Paginated } from '../../../common/dto/paginated';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  AdminOpsService,
  OpsBoardLane,
  OpsSummary,
  StuckOrderRow,
} from './ops.service';
import { OpsBoardQueryDto } from './dto';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  /admin/ops — the OPERATIONS console
 * ════════════════════════════════════════════════════════════════════════
 *
 * `@Roles(Role.ADMIN)` is the LOWEST role permitted, and `RolesGuard`
 * lets SUPER_ADMIN through it implicitly. Nothing in this sub-module is
 * SUPER_ADMIN-only: none of it moves money, re-prices the platform or
 * grants a privilege. It moves WORK, which is precisely the job ADMIN
 * exists to do.
 *
 * Every route here is a read. The three that write live on the approvals,
 * dispatch and issues controllers, and each of those carries the audit
 * interceptor.
 */
@ApiTags('admin/ops')
@ApiBearerAuth()
@Controller('admin/ops')
@Roles(Role.ADMIN)
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'The operations landing payload',
    description:
      'Live order counts, the needs-action queue, dispatch capacity and ' +
      "today's throughput. Money is INTEGER PAISE; `avgAssignMinutes` " +
      'and `onTimePct` are null when there is nothing to average.',
  })
  summary(): Promise<OpsSummary> {
    return this.ops.summary();
  }

  @Get('board')
  @ApiOperation({
    summary: 'The live order board',
    description:
      'Five lanes (new · preparing · ready · assigned · in_transit), ' +
      'oldest first inside each. NOT paginated: each lane is capped at ' +
      '50 cards and sets `truncated` when `total` exceeds what it ' +
      'returned. Filterable by `vendorId` and `q` (order number or ' +
      'customer name).',
  })
  board(@Query() query: OpsBoardQueryDto): Promise<OpsBoardLane[]> {
    return this.ops.board(query);
  }

  @Get('stuck')
  @ApiOperation({
    summary: 'Orders sitting in one status too long',
    description:
      'Per-status thresholds: PLACED 10m · ACCEPTED/PACKING 25m · ' +
      'READY_FOR_PICKUP 15m (unassigned) · ASSIGNED 15m · ' +
      'OUT_FOR_DELIVERY 45m. Worst first. Each row carries `reason`, ' +
      '`suggestedAction` and `stuckSinceMinutes` (minutes BEYOND the ' +
      'threshold).',
  })
  stuck(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<StuckOrderRow>> {
    return this.ops.stuck(query);
  }
}
