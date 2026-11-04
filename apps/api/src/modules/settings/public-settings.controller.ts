import { Controller, Get, Header } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { PublicSettings, PublicSettingsService } from './public-settings.service';

/**
 * `GET /settings/public` — the help, privacy and terms pages read the
 * support contact and the delivery terms from here, before anyone signs
 * in.
 *
 * Listed in `test/integration/public-routes.spec.ts`. The six keys it
 * returns are the whole contract; see `PUBLIC_SETTING_KEYS`.
 */
@ApiTags('settings')
@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: PublicSettingsService) {}

  @Public()
  @Get('public')
  // Identical for every caller, and changed by an admin a few times a
  // year: a short shared cache keeps a crawler off the database.
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    summary: 'Non-sensitive platform settings',
    description:
      'Exactly platformName, supportEmail, supportPhone, deliveryFeePaise, ' +
      'freeDeliveryThresholdPaise and serviceRadiusKm. Nothing else is ' +
      'ever returned — commission, the COD ceiling, maintenance mode and ' +
      'the ops thresholds stay behind the admin guard.',
  })
  @ApiOkResponse({ description: 'PublicSettings' })
  read(): Promise<PublicSettings> {
    return this.settings.read();
  }
}
