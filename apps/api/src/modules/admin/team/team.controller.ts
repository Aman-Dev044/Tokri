import {
  Body,
  Controller,
  Delete,
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
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { AdminTeamService, TeamMemberRow } from './team.service';
import {
  CreateTeamMemberDto,
  ListTeamQueryDto,
  UpdateTeamStatusDto,
} from './dto';

/**
 * Platform staff administration — SUPER_ADMIN ONLY, on every route.
 *
 * ADMIN does not satisfy a SUPER_ADMIN requirement (role inheritance runs
 * upward only), so a compromised ADMIN session can neither mint itself a
 * spare admin account nor suspend every other admin and take sole control
 * of the platform. That is the whole reason this controller is separate
 * from the rest of `/admin`.
 */
@ApiTags('admin/team')
@ApiBearerAuth()
@Controller('admin/team')
@Roles(Role.SUPER_ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get()
  @ApiOperation({
    summary: 'Platform staff (paginated)',
    description: 'Both ADMIN and SUPER_ADMIN accounts. Never returns hashes.',
  })
  list(@Query() query: ListTeamQueryDto): Promise<Paginated<TeamMemberRow>> {
    return this.team.list(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an ADMIN',
    description:
      'The role is fixed to ADMIN by the service and is not a field on ' +
      'the body. A SUPER_ADMIN can NEVER be created through the API — the ' +
      'only one is provisioned by the seed script from `.env`.',
  })
  @ApiConflictResponse({ description: 'Email or phone already registered.' })
  create(
    @Body() dto: CreateTeamMemberDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<UserResponseDto> {
    return this.team.create(dto, actor);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Suspend or reactivate a team member',
    description:
      'Refused for your own account and for a seeded system account. ' +
      'Suspension clears the refresh-token family.',
  })
  @ApiForbiddenResponse({
    description: 'Self, or a seeded system account.',
  })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTeamStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<UserResponseDto> {
    return this.team.updateStatus(id, dto, actor);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a team member',
    description:
      'Suspension is the normal action. Refused for your own account and ' +
      'for seeded system accounts, which are the break-glass identities.',
  })
  @ApiForbiddenResponse({ description: 'Self, or a seeded system account.' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<void> {
    return this.team.remove(id, actor);
  }
}
