import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Setting, SettingSchema } from '../../database/schemas/setting.schema';
import { PublicSettingsController } from './public-settings.controller';
import { PublicSettingsService } from './public-settings.service';

/**
 * The public, read-only face of platform settings. Writing them is
 * `PUT /admin/settings`, in the admin module, behind the admin guard.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Setting.name, schema: SettingSchema }]),
  ],
  controllers: [PublicSettingsController],
  providers: [PublicSettingsService],
})
export class PublicSettingsModule {}
