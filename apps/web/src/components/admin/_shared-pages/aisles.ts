/**
 * The eight aisles, as CATEGORICAL SERIES COLOURS.
 *
 * Plan §2.4: the admin surface does NOT use the chromatic-aisle system — it is
 * neutral, and semantic colour (--good / --warn / --crit) is the only colour
 * that carries meaning here. The single exception is a breakdown *by aisle*,
 * where any other palette would be actively confusing: the hue has to match the
 * <AisleDot/> beside that aisle's name everywhere else on the page.
 *
 * The hues themselves come from `AISLE_SERIES_COLOR` in the shared components,
 * which resolves to the `--adm-aisle-*` tokens — so a chart tracks the theme
 * instead of freezing a light-mode hex into the markup.
 */

import { AISLE_SERIES_COLOR } from '@/components/admin';
import { AISLES, isAisleKey, type AisleKey } from '@mandi/design-system';

export type { AisleKey };

/** Identity hue. Fills and swatches only — never small text on the ground. */
export function aisleColor(key: string): string {
  return isAisleKey(key) ? AISLE_SERIES_COLOR[key] : 'var(--muted)';
}

export function aisleLabel(key: string): string {
  return isAisleKey(key) ? (AISLES.find((a) => a.key === key)?.name ?? key) : key;
}

/** Mutable, because `<FilterBar>` takes `FilterOption[]`. */
export const AISLE_OPTIONS: { label: string; value: string }[] = AISLES.map((a) => ({
  label: a.name,
  value: a.key,
}));

/**
 * For a breakdown that is NOT by aisle — payment method, report groupings.
 * Four steps of one ink plus the two semantic hues, never the aisle palette,
 * so nothing on screen implies an aisle that is not there.
 */
export const NEUTRAL_SERIES: readonly string[] = [
  'var(--adm-series-1)',
  'var(--adm-series-2)',
  'var(--adm-series-3)',
  'var(--adm-series-4)',
];
