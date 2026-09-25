/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * `/admin/settings` is a `Setting` collection keyed by name (plan §5.1), which
 * the API flattens into one object. These are the defaults the console falls
 * back to when the endpoint cannot be reached — shown behind the amber banner,
 * and never saveable in that state.
 *
 * Money is INTEGER PAISE.
 */

export interface PlatformSettings {
  platformName: string;
  supportEmail: string;
  supportPhone: string;
  deliveryFeePaise: number;
  freeDeliveryThresholdPaise: number;
  serviceRadiusKm: number;
  defaultCommissionPct: number;
  codMaxAmountPaise: number;
  maintenanceMode: boolean;
}

export type SettingKey = keyof PlatformSettings;

export const SETTINGS_FIXTURE: PlatformSettings = {
  platformName: 'Mandi',
  supportEmail: 'help@mandi.example.in',
  supportPhone: '+91 80 4718 2200',
  deliveryFeePaise: 3_500,
  freeDeliveryThresholdPaise: 59_900,
  serviceRadiusKm: 5,
  defaultCommissionPct: 12,
  codMaxAmountPaise: 2_50_000,
  maintenanceMode: false,
};

/**
 * Changing one of these moves money — either what a customer pays or what a
 * vendor is owed. The save bar asks for an explicit confirmation listing them
 * by name rather than letting a stray keystroke reprice the platform.
 */
export const MONEY_KEYS: readonly SettingKey[] = [
  'deliveryFeePaise',
  'freeDeliveryThresholdPaise',
  'defaultCommissionPct',
  'codMaxAmountPaise',
];

export const KEY_LABEL: Readonly<Record<SettingKey, string>> = {
  platformName: 'Platform name',
  supportEmail: 'Support email',
  supportPhone: 'Support phone',
  deliveryFeePaise: 'Delivery fee',
  freeDeliveryThresholdPaise: 'Free delivery threshold',
  serviceRadiusKm: 'Service radius',
  defaultCommissionPct: 'Default commission',
  codMaxAmountPaise: 'COD maximum',
  maintenanceMode: 'Maintenance mode',
};
