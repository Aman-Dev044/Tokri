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
  ApiForbiddenResponse,
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
import { Idempotent } from '../../../common/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../../common/interceptors/idempotency.interceptor';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import {
  AdminFinanceService,
  GenerateResult,
  LedgerRow,
  SettlementDetail,
  SettlementRow,
} from './finance.service';
import {
  GenerateSettlementsDto,
  ListLedgerQueryDto,
  ListSettlementsQueryDto,
  PaySettlementDto,
} from './dto';

@ApiTags('admin/finance')
@ApiBearerAuth()
@Controller('admin')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminFinanceController {
  constructor(private readonly finance: AdminFinanceService) {}

  @Get('settlements')
  @ApiOperation({
    summary: 'Settlement list (paginated)',
    description:
      'Filters: status, vendorId, and from/to which select settlements ' +
      'whose PERIOD overlaps the window. All money is INTEGER PAISE.',
  })
  listSettlements(
    @Query() query: ListSettlementsQueryDto,
  ): Promise<Paginated<SettlementRow>> {
    return this.finance.listSettlements(query);
  }

  @Get('settlements/:id')
  @ApiOperation({
    summary: 'One settlement, with its ledger rows',
    description:
      '`entries` holds every LedgerEntry attached to this settlement — ' +
      'sale, commission, refund and (once paid) payout.',
  })
  findSettlement(@Param('id') id: string): Promise<SettlementDetail> {
    return this.finance.findSettlement(id);
  }

  @Get('ledger')
  @ApiOperation({
    summary: 'Ledger rows (paginated)',
    description:
      'Filters: vendorId, type, orderId, settlementId, from/to on `at`. ' +
      '`amount` is SIGNED INTEGER PAISE from the vendor perspective.',
  })
  listLedger(
    @Query() query: ListLedgerQueryDto,
  ): Promise<Paginated<LedgerRow>> {
    return this.finance.listLedger(query);
  }

  // ────────────────────────────────────────────────────────────────────
  //  SUPER_ADMIN ONLY — these two move money.
  // ────────────────────────────────────────────────────────────────────

  @Post('settlements/generate')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generate settlements for a period (SUPER_ADMIN only)',
    description:
      'Rolls DELIVERED orders in the window into one Settlement per ' +
      'vendor and reconciles the LedgerEntry rows. Safe to run twice: ' +
      '{ vendorId, periodStart, periodEnd } is unique, so a repeat run ' +
      'reports the vendor under `skipped` instead of paying the week ' +
      'out again.',
  })
  @ApiForbiddenResponse({ description: 'ADMIN is not sufficient here.' })
  generate(
    @Body() dto: GenerateSettlementsDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<GenerateResult> {
    return this.finance.generate(dto, actor);
  }

  @Post('settlements/:id/pay')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent('settlement.pay')
  @ApiOperation({
    summary: 'Mark a settlement paid (SUPER_ADMIN only)',
    description:
      'Requires an `Idempotency-Key` header: a retried request replays ' +
      'the original response rather than writing a second payout row. An ' +
      'already-paid settlement is a 409 regardless of the key.',
  })
  @ApiConflictResponse({ description: 'Already paid.' })
  @ApiForbiddenResponse({ description: 'ADMIN is not sufficient here.' })
  pay(
    @Param('id') id: string,
    @Body() dto: PaySettlementDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<SettlementDetail> {
    return this.finance.pay(id, dto, actor);
  }
}
