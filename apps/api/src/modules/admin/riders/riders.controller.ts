import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Role } from '../../../common/constants/roles.enum';
import { Roles } from '../../../common/decorators/roles.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import {
  CreditRiderWalletDto,
  ListRiderKycQueryDto,
  RejectRiderKycDto,
} from './dto';
import {
  AdminRidersService,
  RiderKycFullView,
  RiderKycQueueRow,
} from './riders.service';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ADMIN — RIDERS
 * ════════════════════════════════════════════════════════════════════════
 *
 * `@Roles(Role.ADMIN)` on the controller — the LOWEST role permitted;
 * `RolesGuard` lets SUPER_ADMIN through implicitly. Nothing here is
 * `@Public()`.
 *
 * ONE route is SUPER_ADMIN-only: `POST /admin/riders/:id/wallet/credit`.
 * It moves money into a person's balance on a platform with no gateway
 * to reconcile it against, which puts it in exactly the same class as
 * `POST /admin/settlements/:id/pay` — irreversible, and therefore above
 * day-to-day operations. A compromised ADMIN session can work the
 * verification queue; it cannot mint balance.
 *
 * `GET /admin/riders/:id/kyc` is the ONE endpoint in this platform that
 * returns Aadhaar, PAN and driving-licence numbers in full. It exists so
 * a human can compare the number against the uploaded photograph of the
 * card — a masked number beside a readable card is not a control. Every
 * call to it writes an audit row saying an identifier was revealed.
 */
@ApiTags('admin/riders')
@ApiBearerAuth()
@Controller('admin/riders')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminRidersController {
  constructor(private readonly riders: AdminRidersService) {}

  @Get('kyc')
  @ApiOperation({
    summary: 'The verification queue, closest deadline first',
    description:
      'Defaults to `status=submitted`. Ordered by `kycSlaDueAt` ascending ' +
      'so the submission nearest to breaching its promise is worked ' +
      'first, and `breached` is reported rather than hidden. Carries NO ' +
      'identifier numbers — a page of twenty riders is no reason to put ' +
      "twenty Aadhaar numbers in an operator's browser.",
  })
  list(
    @Query() query: ListRiderKycQueryDto,
  ): Promise<Paginated<RiderKycQueueRow>> {
    return this.riders.list(query);
  }

  @Get(':id/kyc')
  @ApiOperation({
    summary: 'One rider\'s KYC — the numbers IN FULL',
    description:
      'The ONLY endpoint in this platform that returns Aadhaar, PAN, ' +
      'driving-licence and vehicle (plate, RC, policy) numbers unmasked. ' +
      'It exists so a reviewer can compare each number against the ' +
      'uploaded document. `vehicleInsuranceStatus` flags a policy that ' +
      'has expired or expires within 30 days. Every call is ' +
      'audited as `admin.riders.kyc.read` — the audit row records that an ' +
      'identifier was revealed, never the identifier itself.',
  })
  @ApiNotFoundResponse({ description: 'Missing or malformed rider id.' })
  findOne(@Param('id') id: string): Promise<RiderKycFullView> {
    return this.riders.findByIdForVerification(id);
  }

  @Post(':id/kyc/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve the rider',
    description:
      'Sets VERIFIED, discharges the SLA deadline, emits ' +
      '`kyc.status_changed` to the rider and notifies them. Only after ' +
      'this can the rider accept an order at all.',
  })
  @ApiOkResponse({ description: 'The updated KYC record.' })
  @ApiConflictResponse({
    description: 'KYC_ALREADY_VERIFIED or KYC_NOT_SUBMITTED.',
  })
  verify(
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<RiderKycFullView> {
    return this.riders.verify(id, actor);
  }

  @Post(':id/kyc/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject, with a reason the rider can act on',
    description:
      'The reason is shown to the rider verbatim, so it is mandatory. ' +
      'The rider may resubmit; a REJECTED record is not a dead end.',
  })
  @ApiConflictResponse({
    description: 'KYC_ALREADY_VERIFIED or KYC_NOT_SUBMITTED.',
  })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectRiderKycDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<RiderKycFullView> {
    return this.riders.reject(id, dto, actor);
  }

  /**
   * SUPER_ADMIN only. Role inheritance runs upward, so ADMIN does not
   * satisfy this — the same treatment as commission, settlements and
   * platform settings, and for the same reason: it moves money.
   */
  @Roles(Role.SUPER_ADMIN)
  @Post(':id/wallet/credit')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Credit a rider wallet (SUPER_ADMIN)',
    description:
      'How a rider actually gets money while there is no payment ' +
      'gateway. Written as an ADJUSTMENT with `createdBy` set — NOT as a ' +
      'TOPUP, which would corrupt `lifetimeToppedUpPaise`, a figure ' +
      'somebody will reconcile against gateway settlements. Audited, and ' +
      'the note is mandatory.',
  })
  @ApiCreatedResponse({ description: '{ balancePaise, transactionId }' })
  @ApiNotFoundResponse({ description: 'Missing or malformed rider id.' })
  creditWallet(
    @Param('id') id: string,
    @Body() dto: CreditRiderWalletDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<{ balancePaise: number; transactionId: string }> {
    return this.riders.creditWallet(id, dto, actor);
  }
}
