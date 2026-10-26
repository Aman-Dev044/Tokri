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
  ApiServiceUnavailableResponse,
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
import { AdminPaymentsService, PaymentRow } from './payments.service';
import { ListPaymentsQueryDto, RefundPaymentDto } from './dto';

/**
 * The cross-vendor transactions ledger.
 *
 * SUPER_ADMIN only, on the class rather than per route: every customer's
 * spend across every store, plus the one button in the console that sends
 * money back out. ADMIN runs the platform day to day without either.
 */
@ApiTags('admin/payments')
@ApiBearerAuth()
@Controller('admin/payments')
@Roles(Role.SUPER_ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Payment list (paginated, SUPER_ADMIN only)',
    description:
      'One row per order: `Order.payment` flattened onto it. Filters: ' +
      'q (order no, gateway ref, customer or store name), method, status, ' +
      'and from/to on `placedAt` (a bare YYYY-MM-DD `to` includes that ' +
      'whole UTC day). All money is INTEGER PAISE.',
  })
  @ApiForbiddenResponse({ description: 'ADMIN is not sufficient here.' })
  list(@Query() query: ListPaymentsQueryDto): Promise<Paginated<PaymentRow>> {
    return this.payments.list(query);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refund a collected payment (SUPER_ADMIN only)',
    description:
      '`:id` is the order id. Online: the gateway must accept the refund ' +
      'first — 503 `PAYMENT_PROVIDER_NOT_CONFIGURED` while Razorpay has no ' +
      'keys, and nothing is written. COD: recorded against the vendor ' +
      'ledger; the cash goes back out of band. Returns the updated row.',
  })
  @ApiConflictResponse({
    description: 'Not a collected payment, or changed concurrently.',
  })
  @ApiServiceUnavailableResponse({
    description: 'PAYMENT_PROVIDER_NOT_CONFIGURED — online refunds only.',
  })
  @ApiForbiddenResponse({ description: 'ADMIN is not sufficient here.' })
  refund(
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<PaymentRow> {
    return this.payments.refund(id, dto, actor);
  }
}
