import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';

import {
  Setting,
  SettingDocument,
} from '../../../database/schemas/setting.schema';

/** The only platform settings the customer surface reads. */
export interface ShopSettings {
  /** INTEGER PAISE. */
  deliveryFeePaise: number;
  /** INTEGER PAISE. At or above this, delivery is free. */
  freeDeliveryThresholdPaise: number;
  /** Minutes an order is promised in; the honest basis for the ETA. */
  slaMinutes: number;
  /** Kilometres, used when the caller does not supply a radius. */
  serviceRadiusKm: number;
}

/**
 * Operational defaults for a database that has never been configured.
 *
 * These are BUSINESS values, not credentials. The ESLint ban on
 * `process.env.X || 'fallback'` targets a fallback SECRET — a value whose
 * absence must stop the process. A delivery fee has none of those
 * properties: it is visible in the admin console, changeable without a
 * deploy, and wrong in a way anyone can see. Nothing here is ever read
 * from the environment.
 *
 * They intentionally match the admin settings service's defaults, so the
 * customer app and the admin console agree about an unconfigured platform.
 */
const DEFAULTS: ShopSettings = {
  deliveryFeePaise: 2900,
  freeDeliveryThresholdPaise: 49900,
  slaMinutes: 30,
  serviceRadiusKm: 5,
};

const KEYS = Object.keys(DEFAULTS) as (keyof ShopSettings)[];

/**
 * Reads the operational settings the shop needs.
 *
 * Deliberately its own tiny reader rather than a dependency on
 * `AdminSettingsService`: the customer path must not import the admin
 * module, and it only needs four numbers out of that service's much
 * larger, audited write surface.
 */
@Injectable()
export class ShopSettingsService {
  constructor(
    @InjectModel(Setting.name)
    private readonly settings: Model<SettingDocument>,
  ) {}

  async read(session?: ClientSession): Promise<ShopSettings> {
    const rows = await this.settings
      .find({ key: { $in: KEYS } })
      .session(session ?? null)
      .lean<{ key: string; value: unknown }[]>()
      .exec();

    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const values: ShopSettings = { ...DEFAULTS };

    for (const key of KEYS) {
      const value = stored.get(key);
      // A stored value of the wrong type is ignored rather than trusted:
      // a string "2900" in `deliveryFeePaise` would otherwise turn every
      // total into string concatenation.
      if (typeof value === 'number' && Number.isFinite(value)) {
        values[key] = value;
      }
    }

    return values;
  }
}
