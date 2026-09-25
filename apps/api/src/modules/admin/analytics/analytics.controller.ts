import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles.enum';
import {
  AdminAnalyticsService,
  AisleRow,
  OverviewResponse,
  StatusCount,
  TopProductRow,
  TopVendorRow,
} from './analytics.service';
import { TimeseriesQueryDto, TopQueryDto } from './dto';
import { DateRangeQueryDto } from '../common/dto';
import { SeriesPoint } from './kpi.util';

@ApiTags('admin/analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
@Roles(Role.ADMIN)
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Dashboard KPI tiles',
    description:
      'Every tile is `{ value, previous, deltaPct }`. `deltaPct` is null ' +
      'when the previous window was zero — a change from nothing is not a ' +
      'percentage. Money is INTEGER PAISE. Defaults to the last 30 days.',
  })
  overview(@Query() query: DateRangeQueryDto): Promise<OverviewResponse> {
    return this.analytics.overview(query);
  }

  @Get('timeseries')
  @ApiOperation({
    summary: 'GMV / orders / AOV over time',
    description:
      'Dense: every bucket in the range is returned, zero-filled. Buckets ' +
      'are UTC and `date` is the bucket START as `YYYY-MM-DD`.',
  })
  timeseries(@Query() query: TimeseriesQueryDto): Promise<SeriesPoint[]> {
    return this.analytics.timeseries(query);
  }

  @Get('orders-by-status')
  @ApiOperation({
    summary: 'Order counts per status',
    description: 'All eleven statuses are always present, zero included.',
  })
  ordersByStatus(@Query() query: DateRangeQueryDto): Promise<StatusCount[]> {
    return this.analytics.ordersByStatus(query);
  }

  @Get('top-vendors')
  @ApiOperation({ summary: 'Highest-GMV vendors in the window' })
  topVendors(@Query() query: TopQueryDto): Promise<TopVendorRow[]> {
    return this.analytics.topVendors(query);
  }

  @Get('top-products')
  @ApiOperation({ summary: 'Highest-GMV products in the window' })
  topProducts(@Query() query: TopQueryDto): Promise<TopProductRow[]> {
    return this.analytics.topProducts(query);
  }

  @Get('sales-by-aisle')
  @ApiOperation({
    summary: 'GMV split across the eight chromatic aisles',
    description: 'All eight aisles are always present so the hue legend is stable.',
  })
  salesByAisle(@Query() query: DateRangeQueryDto): Promise<AisleRow[]> {
    return this.analytics.salesByAisle(query);
  }
}
