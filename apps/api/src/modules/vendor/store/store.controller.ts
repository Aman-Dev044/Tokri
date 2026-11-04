import { Body, Controller, Get, Patch, Put, UseInterceptors } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { Roles } from '../../../common/decorators/roles.decorator';
import {
  RequirePermission,
} from '../../../common/decorators/require-permission.decorator';
import { Permission } from '../../../common/constants/permissions';
import { Role } from '../../../common/constants/roles.enum';
import {
  CurrentUser,
  JwtUser,
} from '../../../common/decorators/current-user.decorator';
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { VendorScope } from '../common/vendor-scope.decorator';
import {
  StoreProfile,
  StoreStatus,
  VendorDashboard,
  VendorStoreService,
} from './store.service';
import {
  UpdateStoreHoursDto,
  UpdateStoreProfileDto,
  UpdateStoreStatusDto,
} from './dto';

/**
 * The store's own record and the console's home screen.
 *
 * `@Roles(Role.VENDOR)` on the controller covers every route. Note that
 * ADMIN does NOT satisfy it: role inheritance in `RolesGuard` runs upward
 * only (SUPER_ADMIN → ADMIN), and there is no rule that makes a platform
 * role a vendor. An admin acting on a store does it through
 * `/admin/vendors/*`, where it is audited as an admin action.
 */
@ApiTags('vendor/store')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Not a vendor token.' })
@Controller('vendor')
@Roles(Role.VENDOR, Role.STAFF)
@UseInterceptors(AuditInterceptor)
export class VendorStoreController {
  constructor(private readonly store: VendorStoreService) {}

  @RequirePermission(Permission.STORE_MANAGE)
  @Get('profile')
  @ApiOperation({
    summary: 'The caller’s own store profile',
    description:
      'Resolved from the vendor id in the verified JWT. There is no ' +
      '`:vendorId` parameter anywhere in this module — see §8.1.',
  })
  getProfile(@VendorScope() scope: string): Promise<StoreProfile> {
    return this.store.getProfile(scope);
  }

  @RequirePermission(Permission.STORE_MANAGE)
  @Put('profile')
  @ApiOperation({
    summary: 'Update the store profile',
    description:
      'Commission, approval status, slug and rating are NOT editable ' +
      'here — they are platform decisions. Sending one is a 400, not a ' +
      'silent no-op.',
  })
  @ApiBadRequestResponse({ description: 'Unknown or invalid field.' })
  updateProfile(
    @VendorScope() scope: string,
    @Body() dto: UpdateStoreProfileDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<StoreProfile> {
    return this.store.updateProfile(scope, dto, actor);
  }

  @RequirePermission(Permission.STORE_MANAGE)
  @Patch('store/status')
  @ApiOperation({
    summary: 'Open or close the store',
    description:
      'Only an APPROVED store may open. A suspended store that could ' +
      'flip itself back open would make suspension advisory.',
  })
  @ApiBadRequestResponse({ description: 'Store is not approved.' })
  setOpen(
    @VendorScope() scope: string,
    @Body() dto: UpdateStoreStatusDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<StoreStatus> {
    return this.store.setOpen(scope, dto, actor);
  }

  @RequirePermission(Permission.STORE_MANAGE)
  @Put('store/hours')
  @ApiOperation({
    summary: 'Replace the weekly opening hours',
    description:
      'A full replacement, not a merge: partial hour updates are how a ' +
      'store ends up advertising two overlapping Tuesday windows.',
  })
  setHours(
    @VendorScope() scope: string,
    @Body() dto: UpdateStoreHoursDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<StoreProfile> {
    return this.store.setHours(scope, dto, actor);
  }

  @RequirePermission(Permission.ORDERS_VIEW)
  @Get('dashboard')
  @ApiOperation({
    summary: 'Today’s operating picture',
    description:
      'Orders by status, revenue, the pending-accept count, low and out ' +
      'of stock counts, the store rating and a 7-day sparkline.',
  })
  dashboard(@VendorScope() scope: string): Promise<VendorDashboard> {
    return this.store.dashboard(scope);
  }
}
