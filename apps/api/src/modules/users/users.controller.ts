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
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  CurrentUser,
  JwtUser,
} from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/constants/roles.enum';
import { Paginated } from '../../common/dto/paginated';
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor';

/**
 * Admin-facing user administration.
 *
 * ── Authorisation ───────────────────────────────────────────────────────
 * Nothing here carries `@Public()`, so the global `JwtAuthGuard` already
 * requires a valid access token on every route. The controller-level
 * `@Roles(Role.ADMIN)` narrows that to platform staff; `RolesGuard` lets
 * SUPER_ADMIN through an ADMIN requirement implicitly.
 *
 * The two privilege-granting routes — provisioning and deleting accounts —
 * override that with `@Roles(Role.SUPER_ADMIN)`, which ADMIN does NOT
 * satisfy (inheritance only runs upward). A compromised ADMIN session can
 * therefore see and suspend accounts, but cannot mint a new admin for
 * itself to fall back on.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List users (paginated)',
    description:
      'Returns `{ data, meta: { page, limit, total, pages } }`. Filter by ' +
      'role, status or a literal search term. `limit` is capped at 100.',
  })
  list(@Query() query: ListUsersQueryDto): Promise<Paginated<UserResponseDto>> {
    return this.users.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single user' })
  @ApiNotFoundResponse({
    description:
      'Returned for a missing user AND for a malformed id, so the endpoint ' +
      'cannot be used to enumerate which ids exist.',
  })
  findOne(@Param('id') id: string): Promise<UserResponseDto> {
    return this.users.findById(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Activate, suspend or re-pend an account',
    description:
      'Suspending clears the refresh-token family, and `JwtStrategy` ' +
      're-reads `status` from the database on every request, so a live ' +
      'access token stops working on its next use.',
  })
  @ApiForbiddenResponse({
    description:
      'Changing your own status, a platform account as a non-SUPER_ADMIN, ' +
      'or a seeded system account.',
  })
  @ApiNotFoundResponse({ description: 'No such user.' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<UserResponseDto> {
    return this.users.updateStatus(id, dto, actor);
  }

  // ────────────────────────────────────────────────────────────────────
  //  SUPER_ADMIN ONLY — account provisioning and removal.
  //  @Roles() on a handler overrides the controller-level value, and
  //  ADMIN does not satisfy a SUPER_ADMIN requirement.
  // ────────────────────────────────────────────────────────────────────

  @Post()
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyInterceptor)
  @Idempotent('users.create')
  @ApiOperation({
    summary: 'Provision an account (SUPER_ADMIN only)',
    description:
      'Requires an `Idempotency-Key` header: a retried request replays the ' +
      'original response instead of creating a second account. `status` is ' +
      'derived from `role` and can never be supplied by the caller; ' +
      'SUPER_ADMIN cannot be created here at all.',
  })
  @ApiConflictResponse({ description: 'Email or phone already registered.' })
  @ApiForbiddenResponse({ description: 'Attempted to create a SUPER_ADMIN.' })
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.users.create(dto);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete an account (SUPER_ADMIN only)',
    description:
      'Suspension is the normal operational action. Deletion exists for ' +
      'mistakenly-provisioned accounts and erasure requests.',
  })
  @ApiForbiddenResponse({ description: 'Self-deletion or a system account.' })
  @ApiNotFoundResponse({ description: 'No such user.' })
  remove(
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<void> {
    return this.users.remove(id, actor);
  }
}
