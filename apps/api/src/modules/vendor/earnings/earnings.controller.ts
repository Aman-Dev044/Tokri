import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import { Paginated } from '../../../common/dto/paginated';
import { VendorScope } from '../common/vendor-scope.decorator';
import {
  EarningsSummary,
  LedgerRow,
  SalesReport,
  SettlementRow,
  TopProductsReport,
  VendorEarningsService,
} from './earnings.service';
import {
  EarningsQueryDto,
  ListLedgerQueryDto,
  ListSettlementsQueryDto,
  SalesReportQueryDto,
  TopProductsQueryDto,
} from './dto';

/**
 * Money, read-only.
 *
 * Nothing on this controller writes: settlements are generated and paid
 * by SUPER_ADMIN (`/admin/settlements/*`), and the ledger is append-only
 * by design — a mistake is corrected with a new `adjustment` row, never
 * by editing history. A vendor endpoint that could edit either would make
 * the audit trail worthless exactly where it matters most.
 */
@ApiTags('vendor/earnings')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not a vendor token.' })
@Controller('vendor')
@Roles(Role.VENDOR)
export class VendorEarningsController {
  constructor(private readonly earnings: VendorEarningsService) {}

  @Get('earnings')
  @ApiOperation({
    summary: 'Earnings summary for a window',
    description:
      'Gross, commission, refunds, net, order count and the payout still ' +
      'pending. Counted on DELIVERED orders only — an order still being ' +
      'packed is not income. Commission is the per-order SNAPSHOT, never ' +
      'the vendor’s current rate.',
  })
  summary(
    @VendorScope() scope: string,
    @Query() query: EarningsQueryDto,
  ): Promise<EarningsSummary> {
    return this.earnings.summary(scope, query);
  }

  @Get('earnings/ledger')
  @ApiOperation({
    summary: 'Ledger entries (paginated)',
    description:
      '`amount` is SIGNED INTEGER PAISE from the vendor’s point of view: ' +
      'sale positive, commission / refund / payout negative.',
  })
  ledger(
    @VendorScope() scope: string,
    @Query() query: ListLedgerQueryDto,
  ): Promise<Paginated<LedgerRow>> {
    return this.earnings.ledgerPage(scope, query);
  }

  @Get('settlements')
  @ApiOperation({
    summary: 'Own settlements (paginated)',
    description:
      'Weekly payout windows, newest first. Read-only: generating and ' +
      'paying a settlement is SUPER_ADMIN-only.',
  })
  settlements(
    @VendorScope() scope: string,
    @Query() query: ListSettlementsQueryDto,
  ): Promise<Paginated<SettlementRow>> {
    return this.earnings.settlementsPage(scope, query);
  }

  @Get('settlements/:id')
  @ApiOperation({
    summary: 'One of the store’s own settlements',
    description:
      'Another vendor’s settlement is a 404 — never a 403, which would ' +
      'confirm the id is real.',
  })
  @ApiNotFoundResponse({ description: 'No such settlement in this store.' })
  settlement(
    @VendorScope() scope: string,
    @Param('id') id: string,
  ): Promise<SettlementRow> {
    return this.earnings.findSettlement(scope, id);
  }

  @Get('reports/sales')
  @ApiOperation({
    summary: 'Sales grouped by day, week or month',
    description:
      'Weeks use ISO week numbering, so the end of December lands in the ' +
      'week it belongs to rather than a phantom week 53.',
  })
  salesReport(
    @VendorScope() scope: string,
    @Query() query: SalesReportQueryDto,
  ): Promise<SalesReport> {
    return this.earnings.salesReport(scope, query);
  }

  @Get('reports/top-products')
  @ApiOperation({
    summary: 'Best sellers by revenue',
    description:
      'Fulfilled lines of DELIVERED orders only, using each line’s ' +
      'SNAPSHOT name — renaming a product must not rewrite last month’s ' +
      'report.',
  })
  topProducts(
    @VendorScope() scope: string,
    @Query() query: TopProductsQueryDto,
  ): Promise<TopProductsReport> {
    return this.earnings.topProducts(scope, query);
  }
}
