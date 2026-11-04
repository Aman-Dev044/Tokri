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

import { Roles } from '../../../common/decorators/roles.decorator';
import {
  RequirePermission,
  StoreMember,
} from '../../../common/decorators/require-permission.decorator';
import { Permission } from '../../../common/constants/permissions';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { Paginated } from '../../../common/dto/paginated';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { VendorScope } from '../common/vendor-scope.decorator';
import {
  StaffCatalogue,
  StaffRow,
  StoreMe,
  VendorStaffService,
} from './staff.service';
import {
  CreateStaffDto,
  ListStaffQueryDto,
  UpdateStaffDto,
  UpdateStaffStatusDto,
} from './dto';

/**
 * `GET /vendor/me` — the one store route open to every member.
 *
 * It describes the CALLER (name, role, the permissions the guard resolved
 * for this request) and the store's name and open state. The panel needs
 * it to decide what to draw; it is not an authorization input anywhere.
 */
@ApiTags('vendor/staff')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not a store token.' })
@Controller('vendor')
@Roles(Role.VENDOR, Role.STAFF)
export class VendorMeController {
  constructor(private readonly staff: VendorStaffService) {}

  @StoreMember()
  @Get('me')
  @ApiOperation({
    summary: 'Who is signed in to this store, and what they may do',
    description:
      'Permissions are resolved from the database on this request — the ' +
      'same answer the guard used. The owner holds every permission.',
  })
  me(
    @VendorScope() scope: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<StoreMe> {
    return this.staff.me(scope, actor);
  }
}

/**
 * The store's employees.
 *
 * `staff.manage` on every route. A manager holds it too, which is why the
 * service — not this controller — enforces the rules that keep a manager
 * from escalating: no granting what you do not hold, no acting on someone
 * who holds more than you, no editing yourself or the owner.
 */
@ApiTags('vendor/staff')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Missing staff.manage, or escalation.' })
@ApiNotFoundResponse({ description: 'No such staff member in this store.' })
@Controller('vendor/staff')
@Roles(Role.VENDOR, Role.STAFF)
@UseInterceptors(AuditInterceptor)
export class VendorStaffController {
  constructor(private readonly staff: VendorStaffService) {}

  @RequirePermission(Permission.STAFF_MANAGE)
  @Get()
  @ApiOperation({ summary: 'Staff list (paginated)' })
  list(
    @VendorScope() scope: string,
    @Query() query: ListStaffQueryDto,
  ): Promise<Paginated<StaffRow>> {
    return this.staff.list(scope, query);
  }

  @RequirePermission(Permission.STAFF_MANAGE)
  @Get('roles')
  @ApiOperation({
    summary: 'The permission catalogue, the presets, and what you may grant',
  })
  roles(@CurrentUser() actor: JwtUser): StaffCatalogue {
    return this.staff.catalogue(actor);
  }

  @RequirePermission(Permission.STAFF_MANAGE)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a staff member (creates their login)',
    description:
      'The password is hashed and never returned. A preset takes no ' +
      '`permissions`; CUSTOM requires them. Granting anything the caller ' +
      'does not hold is a 403.',
  })
  @ApiConflictResponse({ description: 'Phone or email already in use.' })
  create(
    @VendorScope() scope: string,
    @Body() dto: CreateStaffDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<StaffRow> {
    return this.staff.create(scope, dto, actor);
  }

  @RequirePermission(Permission.STAFF_MANAGE)
  @Get(':id')
  @ApiOperation({ summary: 'One staff member' })
  findOne(
    @VendorScope() scope: string,
    @Param('id') id: string,
  ): Promise<StaffRow> {
    return this.staff.findOne(scope, id);
  }

  @RequirePermission(Permission.STAFF_MANAGE)
  @Patch(':id')
  @ApiOperation({ summary: 'Change name, email, role, permissions or shift' })
  update(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<StaffRow> {
    return this.staff.update(scope, id, dto, actor);
  }

  @RequirePermission(Permission.STAFF_MANAGE)
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Suspend or reinstate',
    description:
      'Suspending revokes the refresh-token family; the live access token ' +
      'stops on its next use because status is re-read every request.',
  })
  setStatus(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @Body() dto: UpdateStaffStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<StaffRow> {
    return this.staff.setStatus(scope, id, dto, actor);
  }

  @RequirePermission(Permission.STAFF_MANAGE)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a staff member and their login' })
  remove(
    @VendorScope() scope: string,
    @Param('id') id: string,
    @CurrentUser() actor: JwtUser,
  ): Promise<void> {
    return this.staff.remove(scope, id, actor);
  }
}
