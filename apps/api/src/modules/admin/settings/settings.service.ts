import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  Setting,
  SettingDocument,
} from '../../../database/schemas/setting.schema';
import { JwtUser } from '../../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { UpdateSettingsDto } from './dto';

/**
 * The complete, typed settings surface. Every key is present in every
 * response, so the admin form never has to reason about "missing" versus
 * "not set yet".
 */
export interface PlatformSettings {
  deliveryFeePaise: number;
  freeDeliveryThresholdPaise: number;
  defaultCommissionPct: number;
  codMaxAmountPaise: number;
  serviceRadiusKm: number;
  platformName: string;
  supportEmail: string;
  supportPhone: string;
  maintenanceMode: boolean;

  // ── Operations (read by /admin/ops/*) ─────────────────────────────
  /**
   * Minutes from `placedAt` that an order is promised in. The ops board
   * warns at 80% of this and marks a breach past 100%.
   */
  slaMinutes: number;
  /**
   * Minimum age, in minutes, before an order may be reported as stuck.
   *
   * A floor on the ORDER's age, not extra slack on each per-status
   * threshold — raising it quietens the whole queue during a known
   * incident without redefining what "PLACED > 10 minutes" means.
   */
  stuckOrderGraceMinutes: number;
}

export interface SettingsResponse extends PlatformSettings {
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Seed values for a database that has never been configured.
 *
 * These are BUSINESS defaults, not credentials — the ESLint ban on
 * `process.env.X || 'fallback'` exists because a fallback SECRET lets the
 * app boot misconfigured and sign tokens with a known string. A default
 * delivery fee has none of those properties: it is visible, changeable
 * from the admin panel, and wrong in an obvious way rather than a silent
 * one. Nothing here is ever read from the environment.
 *
 * They match the locked decisions: Rs 2,000 COD cap (#3) and a 5 km
 * serviceable radius (#11).
 *
 * The ONE exception to "nothing here is read from the environment" is
 * `platformName` and the support address derived from it: the product
 * name lives in APP_NAME and nowhere else, so that a rename is an env
 * change rather than a hunt through source. They are still ordinary
 * settings once an admin edits them — this only decides what they say
 * before anyone has.
 */
const NUMERIC_DEFAULTS = {
  deliveryFeePaise: 2900,
  freeDeliveryThresholdPaise: 49900,
  defaultCommissionPct: 12,
  codMaxAmountPaise: 200000,
  serviceRadiusKm: 5,
  supportPhone: '9000000000',
  maintenanceMode: false,
  slaMinutes: 30,
  stuckOrderGraceMinutes: 10,
} as const;

/** The brand-dependent half, resolved from APP_NAME at construction. */
export function defaultsFor(appName: string): PlatformSettings {
  return {
    ...NUMERIC_DEFAULTS,
    platformName: appName,
    // `.app` to match the seeded admin addresses. A support inbox is a
    // real operational decision an admin makes in the panel; this is only
    // a sensible-looking starting value, never something that sends mail.
    supportEmail: `support@${appName.toLowerCase()}.app`,
  };
}

const SETTING_KEYS = Object.keys(
  defaultsFor('x'),
) as (keyof PlatformSettings)[];

@Injectable()
export class AdminSettingsService {
  /** Resolved once at construction — APP_NAME cannot change at runtime. */
  private readonly defaults: PlatformSettings;

  constructor(
    @InjectModel(Setting.name)
    private readonly settings: Model<SettingDocument>,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.defaults = defaultsFor(config.getOrThrow<string>('brand.name'));
  }

  /**
   * Reads every known key, filling in the default for any that has never
   * been written. Unknown keys sitting in the collection are ignored
   * rather than echoed back — the response shape is defined by this
   * service, not by whatever happens to be stored.
   */
  async get(): Promise<SettingsResponse> {
    const rows = await this.settings
      .find({ key: { $in: SETTING_KEYS } })
      .lean<
        {
          key: string;
          value: unknown;
          updatedBy?: Types.ObjectId | null;
          updatedAt?: Date;
        }[]
      >()
      .exec();

    const stored = new Map(rows.map((row) => [row.key, row]));

    const values = { ...this.defaults };
    for (const key of SETTING_KEYS) {
      const row = stored.get(key);
      if (row === undefined) continue;
      if (typeof row.value === typeof this.defaults[key]) {
        // Assigning through a narrowed union needs the cast; the typeof
        // check above is what actually makes it sound.
        (values[key] as unknown) = row.value;
      }
    }

    const newest = rows
      .map((row) => row.updatedAt)
      .filter((date): date is Date => Boolean(date))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const newestRow = rows.find(
      (row) => row.updatedAt && newest && row.updatedAt.getTime() === newest.getTime(),
    );

    return {
      ...values,
      updatedAt: newest ? newest.toISOString() : null,
      updatedBy: newestRow?.updatedBy ? newestRow.updatedBy.toString() : null,
    };
  }

  /**
   * SUPER_ADMIN only (enforced on the route).
   *
   * Merge semantics: an omitted key keeps its current value. Every write
   * is upserted key-by-key so two admins editing different fields do not
   * clobber each other, and the whole change is audited with a before/
   * after diff of only the keys that actually moved.
   */
  async update(
    dto: UpdateSettingsDto,
    actor: JwtUser,
  ): Promise<SettingsResponse> {
    const before = await this.get();

    const entries = SETTING_KEYS.filter(
      (key) => dto[key] !== undefined,
    ).map((key) => ({ key, value: dto[key] }));

    if (entries.length > 0) {
      await this.settings.bulkWrite(
        entries.map((entry) => ({
          updateOne: {
            filter: { key: entry.key },
            update: {
              $set: {
                value: entry.value,
                updatedBy: Types.ObjectId.isValid(actor.sub)
                  ? new Types.ObjectId(actor.sub)
                  : null,
              },
            },
            upsert: true,
          },
        })),
      );
    }

    const after = await this.get();

    await this.audit.record({
      action: 'settings.update',
      entity: 'Setting',
      entityId: null,
      before: pick(before, entries.map((entry) => entry.key)),
      after: pick(after, entries.map((entry) => entry.key)),
      actor,
    });

    return after;
  }
}

function pick(
  source: SettingsResponse,
  keys: (keyof PlatformSettings)[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = source[key];
  return out;
}
