import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
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
import { OpsOrderCard } from './ops-cards.service';
import {
  AdminOpsDispatchService,
  DispatchMonitor,
} from './ops-dispatch.service';
import { AssignRiderDto, UnassignRiderDto } from './dto';

@ApiTags('admin/ops')
@ApiBearerAuth()
@Controller('admin/ops/dispatch')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminOpsDispatchController {
  constructor(private readonly dispatch: AdminOpsDispatchService) {}

  @Get()
  @ApiOperation({
    summary: 'The dispatch monitor',
    description:
      'Packed orders with nobody on them, each with up to five nearest ' +
      'riders found through the `2dsphere` index and bounded by the ' +
      "store's serviceRadiusKm; plus every online rider with their " +
      'current job and distance to the drop.',
  })
  monitor(): Promise<DispatchMonitor> {
    return this.dispatch.monitor();
  }

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Put a rider on an order',
    description:
      'Validated through the order state machine and written in ONE ' +
      'transaction with the rider record, so the board can never show a ' +
      'rider who does not know they have a job. Audited.',
  })
  @ApiConflictResponse({
    description:
      'The transition is not on the state machine, or the rider is ' +
      'already carrying another order.',
  })
  @ApiNotFoundResponse({ description: 'Unknown order or rider.' })
  assign(
    @Body() dto: AssignRiderDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<OpsOrderCard> {
    return this.dispatch.assign(dto, actor);
  }

  @Post('unassign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take an order back off a rider',
    description:
      'Returns the order to READY_FOR_PICKUP and frees the rider, in one ' +
      'transaction. A reason is mandatory. Anything past ASSIGNED is a ' +
      '409 — once the goods have left the store this is no longer a ' +
      'dispatch decision. Audited.',
  })
  @ApiConflictResponse({ description: 'The order cannot be returned.' })
  @ApiNotFoundResponse({ description: 'Unknown order.' })
  unassign(
    @Body() dto: UnassignRiderDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<OpsOrderCard> {
    return this.dispatch.unassign(dto, actor);
  }
}
