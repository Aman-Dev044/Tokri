import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { VendorRow } from '../vendors/vendors.service';
import { PartnerRow } from '../delivery-partners/delivery-partners.service';
import {
  AdminOpsApprovalsService,
  ApprovalsInbox,
} from './ops-approvals.service';
import { ApprovalDecisionDto } from './dto';

@ApiTags('admin/ops')
@ApiBearerAuth()
@Controller('admin/ops/approvals')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminOpsApprovalsController {
  constructor(private readonly approvals: AdminOpsApprovalsService) {}

  @Get()
  @ApiOperation({
    summary: 'Everything waiting for a decision',
    description:
      'Pending vendors and pending riders in the shapes the existing ' +
      '/admin/vendors and /admin/delivery-partners lists already return, ' +
      'so one row component renders both surfaces. `counts` are TOTALS, ' +
      'not page lengths.',
  })
  inbox(): Promise<ApprovalsInbox> {
    return this.approvals.inbox();
  }

  @Post('vendors/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve or reject a vendor application',
    description:
      'A rejection REQUIRES a reason and is recorded as `suspended` with ' +
      'that reason attached — the closed-store state the rest of the ' +
      'platform already understands, and one a later re-approval can ' +
      'undo without a duplicate store record. Audited.',
  })
  @ApiBadRequestResponse({ description: 'Rejected without a reason.' })
  @ApiNotFoundResponse({ description: 'Missing or malformed id.' })
  decideVendor(
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<VendorRow> {
    return this.approvals.decideVendor(id, dto, actor);
  }

  @Post('riders/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve or reject a delivery partner application',
    description:
      'Delegates to the delivery-partner service, so the decision also ' +
      'moves the rider\'s User account and clears their refresh-token ' +
      'family. A rejection REQUIRES a reason. Audited.',
  })
  @ApiBadRequestResponse({ description: 'Rejected without a reason.' })
  @ApiNotFoundResponse({ description: 'Missing or malformed id.' })
  decideRider(
    @Param('id') id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PartnerRow> {
    return this.approvals.decideRider(id, dto, actor);
  }
}
