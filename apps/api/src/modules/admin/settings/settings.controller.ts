import { Body, Controller, Get, Put, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
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
import { AuditInterceptor } from '../../../common/interceptors/audit.interceptor';
import { AdminSettingsService, SettingsResponse } from './settings.service';
import { UpdateSettingsDto } from './dto';

@ApiTags('admin/settings')
@ApiBearerAuth()
@Controller('admin/settings')
@Roles(Role.ADMIN)
@UseInterceptors(AuditInterceptor)
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Platform settings',
    description:
      'Every key is always present, filled from a default when it has ' +
      'never been written. Money is INTEGER PAISE. No secret is stored ' +
      'here — credentials live in `.env` and are validated at boot.',
  })
  get(): Promise<SettingsResponse> {
    return this.settings.get();
  }

  @Put()
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update platform settings (SUPER_ADMIN only)',
    description:
      'Merge semantics: an omitted key keeps its current value. Each key ' +
      'is upserted individually so two admins editing different fields do ' +
      'not clobber one another. Every change is audited with a diff of ' +
      'only the keys that moved.',
  })
  @ApiForbiddenResponse({ description: 'ADMIN is not sufficient here.' })
  update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() actor: JwtUser,
  ): Promise<SettingsResponse> {
    return this.settings.update(dto, actor);
  }
}
