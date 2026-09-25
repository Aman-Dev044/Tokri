import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

import { AdminListQueryDto } from '../common/dto';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { AisleKey } from '../../../common/constants/aisle.enum';
import {
  IssuePriority,
  IssueStatus,
  IssueType,
} from '../../../database/schemas/issue.schema';

// ────────────────────────────────────────────────────────────────────────
//  Board
// ────────────────────────────────────────────────────────────────────────

/**
 * `GET /admin/ops/board`.
 *
 * Deliberately NOT a `PaginationQueryDto`: the board is a live picture of
 * everything in flight, and a paginated work queue is one an operator
 * scrolls past instead of clearing. Each lane is capped server-side and
 * reports `truncated` when it hit the cap.
 */
export class OpsBoardQueryDto {
  @ApiPropertyOptional({ description: 'Restrict the board to one vendor.' })
  @IsOptional()
  @IsMongoId()
  vendorId?: string;

  @ApiPropertyOptional({
    description: 'Free-text over order number and customer name.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  q?: string;
}

// ────────────────────────────────────────────────────────────────────────
//  Approvals
// ────────────────────────────────────────────────────────────────────────

export type ApprovalDecision = 'approve' | 'reject';

/**
 * Body of both approvals endpoints.
 *
 * `reason` is optional on the DTO and REQUIRED on a rejection — the check
 * lives in the service because it is conditional on another field, and a
 * rejected vendor is owed an explanation their account manager can read
 * back to them.
 */
export class ApprovalDecisionDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision: ApprovalDecision;

  @ApiPropertyOptional({
    description: 'Mandatory when `decision` is `reject`.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

// ────────────────────────────────────────────────────────────────────────
//  Dispatch
// ────────────────────────────────────────────────────────────────────────

export class AssignRiderDto {
  @ApiProperty()
  @IsMongoId()
  orderId: string;

  @ApiProperty({ description: 'DeliveryPartner id, not the rider User id.' })
  @IsMongoId()
  riderId: string;

  @ApiPropertyOptional({ description: 'Recorded on the status transition.' })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

export class UnassignRiderDto {
  @ApiProperty()
  @IsMongoId()
  orderId: string;

  @ApiProperty({
    description:
      'Mandatory. Taking an order off a rider is a decision the rider ' +
      'and the customer both feel, and it needs a name against it.',
  })
  @IsString()
  @Length(3, 500)
  reason: string;
}

// ────────────────────────────────────────────────────────────────────────
//  Issues
// ────────────────────────────────────────────────────────────────────────

export class ListIssuesQueryDto extends AdminListQueryDto {
  @ApiPropertyOptional({ enum: IssueStatus })
  @IsOptional()
  @IsEnum(IssueStatus)
  status?: IssueStatus;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsOptional()
  @IsEnum(IssuePriority)
  priority?: IssuePriority;

  @ApiPropertyOptional({ enum: IssueType })
  @IsOptional()
  @IsEnum(IssueType)
  type?: IssueType;

  @ApiPropertyOptional({
    description: 'The admin who owns the ticket.',
  })
  @IsOptional()
  @IsMongoId()
  assignedToUserId?: string;
}

export class CreateIssueDto {
  @ApiProperty({ enum: IssueType })
  @IsEnum(IssueType)
  type: IssueType;

  @ApiPropertyOptional({ enum: IssuePriority, default: IssuePriority.NORMAL })
  @IsOptional()
  @IsEnum(IssuePriority)
  priority?: IssuePriority;

  @ApiProperty()
  @IsString()
  @Length(3, 160)
  subject: string;

  @ApiProperty()
  @IsString()
  @Length(3, 4000)
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  orderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  vendorId?: string;

  @ApiPropertyOptional({ description: 'DeliveryPartner id.' })
  @IsOptional()
  @IsMongoId()
  riderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  assignedToUserId?: string;
}

/**
 * `PATCH /admin/ops/issues/:id`.
 *
 * Merge semantics: an omitted key keeps its current value. Moving
 * `status` to `resolved` requires a `resolution` — supplied here, or
 * already on the ticket. See `AdminOpsIssuesService.update`.
 */
export class UpdateIssueDto {
  @ApiPropertyOptional({ enum: IssueStatus })
  @IsOptional()
  @IsEnum(IssueStatus)
  status?: IssueStatus;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsOptional()
  @IsEnum(IssuePriority)
  priority?: IssuePriority;

  @ApiPropertyOptional({
    description: 'Pass an empty string to return it to the shared queue.',
  })
  @IsOptional()
  @IsString()
  assignedToUserId?: string;

  @ApiPropertyOptional({ description: 'What was actually done.' })
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  resolution?: string;
}

export class AddIssueMessageDto {
  @ApiProperty()
  @IsString()
  @Length(1, 4000)
  body: string;
}

// ────────────────────────────────────────────────────────────────────────
//  Stock alerts
// ────────────────────────────────────────────────────────────────────────

export type StockSeverity = 'low' | 'out';

export class StockAlertsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  vendorId?: string;

  @ApiPropertyOptional({ enum: AisleKey })
  @IsOptional()
  @IsEnum(AisleKey)
  aisleKey?: AisleKey;

  @ApiPropertyOptional({
    enum: ['low', 'out'],
    description: '`out` is stock 0; `low` is at or under the threshold.',
  })
  @IsOptional()
  @IsIn(['low', 'out'])
  severity?: StockSeverity;
}

export class StockAlertsSummaryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  vendorId?: string;
}
