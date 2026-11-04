import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  Setting,
  SettingDocument,
} from '../../database/schemas/setting.schema';
import {
  defaultsFor,
  PlatformSettings,
} from '../admin/settings/settings.service';

/**
 * The ONLY platform settings a signed-out visitor may read.
 *
 * Every one of these is already printed somewhere public — the support
 * contact on the help page, the delivery fee and free-delivery threshold
 * on every basket, the radius on the landing page. Nothing here is a
 * credential, a commercial term (commission), an operational lever
 * (maintenance mode, SLA, stuck-order grace) or a risk control (the COD
 * ceiling). Adding a key to this list is a deliberate edit, and
 * `test/integration/public-settings.spec.ts` fails on any key it does
 * not expect.
 */
export const PUBLIC_SETTING_KEYS = [
  'platformName',
  'supportEmail',
  'supportPhone',
  'deliveryFeePaise',
  'freeDeliveryThresholdPaise',
  'serviceRadiusKm',
] as const satisfies readonly (keyof PlatformSettings)[];

export type PublicSettings = Pick<
  PlatformSettings,
  (typeof PUBLIC_SETTING_KEYS)[number]
>;

/**
 * Reads the public subset of platform settings.
 *
 * Its own tiny reader, like `ShopSettingsService`, rather than a
 * dependency on `AdminSettingsService` (whose module carries the audited
 * write surface). The DEFAULTS, though, are the admin service's own
 * `defaultsFor` — so the help page, the customer basket and the admin
 * console can never disagree about an unconfigured platform.
 *
 * The response is BUILT key by key from the allowlist above. It never
 * spreads a stored document or the full settings object, so a key added
 * to the collection tomorrow cannot leak here by accident.
 */
@Injectable()
export class PublicSettingsService {
  private readonly defaults: PlatformSettings;

  constructor(
    @InjectModel(Setting.name)
    private readonly settings: Model<SettingDocument>,
    config: ConfigService,
  ) {
    this.defaults = defaultsFor(config.getOrThrow<string>('brand.name'));
  }

  async read(): Promise<PublicSettings> {
    const rows = await this.settings
      .find({ key: { $in: [...PUBLIC_SETTING_KEYS] } }, { key: 1, value: 1 })
      .lean<{ key: string; value: unknown }[]>()
      .exec();

    const stored = new Map(rows.map((row) => [row.key, row.value]));

    const pick = <K extends (typeof PUBLIC_SETTING_KEYS)[number]>(
      key: K,
    ): PlatformSettings[K] => {
      const value = stored.get(key);
      const fallback = this.defaults[key];
      // A stored value of the wrong type is ignored rather than trusted —
      // the same rule the admin and shop readers apply.
      if (typeof value !== typeof fallback) return fallback;
      if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
      return value as PlatformSettings[K];
    };

    return {
      platformName: pick('platformName'),
      supportEmail: pick('supportEmail'),
      supportPhone: pick('supportPhone'),
      deliveryFeePaise: pick('deliveryFeePaise'),
      freeDeliveryThresholdPaise: pick('freeDeliveryThresholdPaise'),
      serviceRadiusKm: pick('serviceRadiusKm'),
    };
  }
}
