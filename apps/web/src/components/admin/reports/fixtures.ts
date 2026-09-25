/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * ── A NOTE ON THE ENDPOINT ──────────────────────────────────────────────────
 * `/admin/reports` is not in the enumerated admin endpoint list (plan §6.2) —
 * only `/vendor/reports/sales` is. The builder calls `/admin/reports` with the
 * report key and window as query params, which is the read-model this page
 * needs; until the API grows one it will render these fixtures behind the
 * amber banner.
 *
 * Money is INTEGER PAISE. Percentages are 0–100 numbers, not fractions.
 */

import { AISLES } from '@mandi/design-system';

/** A report row. Values are raw — formatting is the table's job, not the data's. */
export type ReportRow = Record<string, string | number>;

export type ReportKey =
  | 'sales'
  | 'vendor_performance'
  | 'product_performance'
  | 'delivery_performance'
  | 'tax_summary';

export type CellKind = 'text' | 'money' | 'number' | 'pct' | 'date';

export interface ReportColumn {
  key: string;
  header: string;
  kind: CellKind;
}

export interface ReportSeries {
  key: string;
  label: string;
  color?: string;
}

export interface ReportDef {
  key: ReportKey;
  label: string;
  description: string;
  chart: 'line' | 'bar' | 'donut';
  /** the column the chart plots along its x axis */
  xKey: string;
  series: ReportSeries[];
  columns: ReportColumn[];
  groupings: { label: string; value: string }[];
  /** true ⇒ the series colours are the eight aisle hues (a breakdown BY aisle) */
  byAisle?: boolean;
}

/* ------------------------------------------------------------------ */
/* Definitions                                                         */
/* ------------------------------------------------------------------ */

export const REPORTS: readonly ReportDef[] = [
  {
    key: 'sales',
    label: 'Sales',
    description: 'Gross merchandise value and order count over the window.',
    chart: 'line',
    xKey: 'date',
    series: [
      { key: 'gmvPaise', label: 'GMV' },
      { key: 'orders', label: 'Orders' },
    ],
    columns: [
      { key: 'date', header: 'Date', kind: 'date' },
      { key: 'orders', header: 'Orders', kind: 'number' },
      { key: 'gmvPaise', header: 'GMV', kind: 'money' },
      { key: 'aovPaise', header: 'Average order', kind: 'money' },
      { key: 'discountPaise', header: 'Discounts', kind: 'money' },
      { key: 'commissionPaise', header: 'Commission', kind: 'money' },
    ],
    groupings: [
      { label: 'By day', value: 'day' },
      { label: 'By week', value: 'week' },
      { label: 'By month', value: 'month' },
    ],
  },
  {
    key: 'vendor_performance',
    label: 'Vendor performance',
    description: 'How much each store sold, and what the platform earned from it.',
    chart: 'bar',
    xKey: 'vendor',
    series: [{ key: 'gmvPaise', label: 'GMV' }],
    columns: [
      { key: 'vendor', header: 'Vendor', kind: 'text' },
      { key: 'city', header: 'City', kind: 'text' },
      { key: 'orders', header: 'Orders', kind: 'number' },
      { key: 'gmvPaise', header: 'GMV', kind: 'money' },
      { key: 'commissionPaise', header: 'Commission', kind: 'money' },
      { key: 'cancelPct', header: 'Cancelled', kind: 'pct' },
      { key: 'rating', header: 'Rating', kind: 'number' },
    ],
    groupings: [
      { label: 'By vendor', value: 'vendor' },
      { label: 'By city', value: 'city' },
    ],
  },
  {
    key: 'product_performance',
    label: 'Product performance',
    description: 'Units sold and revenue, grouped by aisle.',
    chart: 'donut',
    xKey: 'aisle',
    series: [{ key: 'gmvPaise', label: 'GMV' }],
    byAisle: true,
    columns: [
      { key: 'aisle', header: 'Aisle', kind: 'text' },
      { key: 'products', header: 'Products sold', kind: 'number' },
      { key: 'units', header: 'Units', kind: 'number' },
      { key: 'gmvPaise', header: 'GMV', kind: 'money' },
      { key: 'sharePct', header: 'Share of GMV', kind: 'pct' },
    ],
    groupings: [
      { label: 'By aisle', value: 'aisle' },
      { label: 'By category', value: 'category' },
    ],
  },
  {
    key: 'delivery_performance',
    label: 'Delivery performance',
    description: 'Time to deliver, on-time rate and failures.',
    chart: 'line',
    xKey: 'date',
    series: [
      { key: 'avgMinutes', label: 'Avg minutes' },
      { key: 'onTimePct', label: 'On time %' },
    ],
    columns: [
      { key: 'date', header: 'Date', kind: 'date' },
      { key: 'deliveries', header: 'Deliveries', kind: 'number' },
      { key: 'avgMinutes', header: 'Avg minutes', kind: 'number' },
      { key: 'onTimePct', header: 'On time', kind: 'pct' },
      { key: 'failed', header: 'Failed', kind: 'number' },
      { key: 'ridersOnline', header: 'Riders online', kind: 'number' },
    ],
    groupings: [
      { label: 'By day', value: 'day' },
      { label: 'By city', value: 'city' },
    ],
  },
  {
    key: 'tax_summary',
    label: 'Tax summary',
    description: 'Taxable value and GST collected, by rate slab.',
    chart: 'bar',
    xKey: 'slab',
    series: [{ key: 'taxPaise', label: 'Tax collected' }],
    columns: [
      { key: 'slab', header: 'GST slab', kind: 'text' },
      { key: 'orders', header: 'Orders', kind: 'number' },
      { key: 'taxablePaise', header: 'Taxable value', kind: 'money' },
      { key: 'cgstPaise', header: 'CGST', kind: 'money' },
      { key: 'sgstPaise', header: 'SGST', kind: 'money' },
      { key: 'taxPaise', header: 'Total tax', kind: 'money' },
    ],
    groupings: [
      { label: 'By slab', value: 'slab' },
      { label: 'By state', value: 'state' },
    ],
  },
];

export function reportDef(key: ReportKey): ReportDef {
  const found = REPORTS.find((r) => r.key === key);
  // REPORTS is a non-empty literal, so the fallback is unreachable; it exists
  // so this function is total rather than returning `ReportDef | undefined`.
  if (found === undefined) throw new Error(`Unknown report: ${key}`);
  return found;
}

/* ------------------------------------------------------------------ */
/* Fixture rows                                                        */
/* ------------------------------------------------------------------ */

const SALES_ROWS: readonly ReportRow[] = [
  { date: '2026-09-18', orders: 1_284, gmvPaise: 1_48_62_400, aovPaise: 11_575, discountPaise: 6_21_400, commissionPaise: 20_80_736 },
  { date: '2026-09-19', orders: 1_361, gmvPaise: 1_57_04_150, aovPaise: 11_539, discountPaise: 6_88_200, commissionPaise: 21_98_581 },
  { date: '2026-09-20', orders: 1_702, gmvPaise: 1_99_31_800, aovPaise: 11_711, discountPaise: 8_94_600, commissionPaise: 27_90_452 },
  { date: '2026-09-21', orders: 1_648, gmvPaise: 1_91_20_050, aovPaise: 11_602, discountPaise: 8_41_100, commissionPaise: 26_76_807 },
  { date: '2026-09-22', orders: 1_197, gmvPaise: 1_36_88_900, aovPaise: 11_436, discountPaise: 5_74_300, commissionPaise: 19_16_446 },
  { date: '2026-09-23', orders: 1_315, gmvPaise: 1_52_47_600, aovPaise: 11_595, discountPaise: 6_39_800, commissionPaise: 21_34_664 },
  { date: '2026-09-24', orders: 842, gmvPaise: 98_11_250, aovPaise: 11_652, discountPaise: 4_02_700, commissionPaise: 13_73_575 },
];

const VENDOR_ROWS: readonly ReportRow[] = [
  { vendor: 'Nandini Fresh, HSR', city: 'Bengaluru', orders: 3_218, gmvPaise: 3_74_11_200, commissionPaise: 56_11_680, cancelPct: 2.1, rating: 4.8 },
  { vendor: 'Jubilee Daily Needs', city: 'Hyderabad', orders: 2_486, gmvPaise: 2_81_44_900, commissionPaise: 39_40_286, cancelPct: 3.4, rating: 4.6 },
  { vendor: 'Sahyadri Kirana', city: 'Pune', orders: 2_047, gmvPaise: 2_18_36_500, commissionPaise: 26_20_380, cancelPct: 1.8, rating: 4.7 },
  { vendor: 'T. Nagar Grocers', city: 'Chennai', orders: 1_512, gmvPaise: 1_64_82_100, commissionPaise: 21_42_673, cancelPct: 4.2, rating: 4.3 },
  { vendor: 'Park Street Provisions', city: 'Kolkata', orders: 964, gmvPaise: 98_74_300, commissionPaise: 13_82_402, cancelPct: 5.7, rating: 4.1 },
  { vendor: 'Marine Drive Mart', city: 'Kochi', orders: 703, gmvPaise: 71_21_650, commissionPaise: 10_68_247, cancelPct: 6.9, rating: 3.9 },
];

/** Aisle rows are derived so the eight keys and labels can never drift. */
const AISLE_GMV: readonly number[] = [
  1_84_21_000, 2_41_66_500, 1_52_30_400, 68_44_200, 96_18_700, 1_12_73_900, 2_08_55_100, 47_91_300,
];
const AISLE_UNITS: readonly number[] = [41_280, 68_940, 52_110, 19_440, 27_360, 33_820, 58_770, 12_650];
const AISLE_PRODUCTS: readonly number[] = [115, 170, 85, 57, 117, 155, 265, 64];

const PRODUCT_ROWS: readonly ReportRow[] = (() => {
  const total = AISLE_GMV.reduce((sum, n) => sum + n, 0);
  return AISLES.map((aisle, index) => {
    const gmv = AISLE_GMV[index] ?? 0;
    return {
      aisleKey: aisle.key,
      aisle: aisle.name,
      products: AISLE_PRODUCTS[index] ?? 0,
      units: AISLE_UNITS[index] ?? 0,
      gmvPaise: gmv,
      sharePct: total === 0 ? 0 : Math.round((gmv / total) * 1000) / 10,
    };
  });
})();

const DELIVERY_ROWS: readonly ReportRow[] = [
  { date: '2026-09-18', deliveries: 1_241, avgMinutes: 22, onTimePct: 93.4, failed: 18, ridersOnline: 214 },
  { date: '2026-09-19', deliveries: 1_318, avgMinutes: 21, onTimePct: 94.1, failed: 14, ridersOnline: 228 },
  { date: '2026-09-20', deliveries: 1_654, avgMinutes: 26, onTimePct: 88.7, failed: 41, ridersOnline: 241 },
  { date: '2026-09-21', deliveries: 1_602, avgMinutes: 25, onTimePct: 90.2, failed: 33, ridersOnline: 238 },
  { date: '2026-09-22', deliveries: 1_158, avgMinutes: 20, onTimePct: 95.8, failed: 9, ridersOnline: 205 },
  { date: '2026-09-23', deliveries: 1_277, avgMinutes: 21, onTimePct: 94.6, failed: 12, ridersOnline: 219 },
  { date: '2026-09-24', deliveries: 812, avgMinutes: 19, onTimePct: 96.3, failed: 5, ridersOnline: 198 },
];

const TAX_ROWS: readonly ReportRow[] = [
  { slab: '0% (exempt — fresh produce)', orders: 6_418, taxablePaise: 4_82_14_600, cgstPaise: 0, sgstPaise: 0, taxPaise: 0 },
  { slab: '5%', orders: 4_112, taxablePaise: 2_16_40_800, cgstPaise: 5_41_020, sgstPaise: 5_41_020, taxPaise: 10_82_040 },
  { slab: '12%', orders: 1_874, taxablePaise: 96_22_300, cgstPaise: 5_77_338, sgstPaise: 5_77_338, taxPaise: 11_54_676 },
  { slab: '18%', orders: 1_205, taxablePaise: 71_08_900, cgstPaise: 6_39_801, sgstPaise: 6_39_801, taxPaise: 12_79_602 },
];

export const REPORT_ROWS: Readonly<Record<ReportKey, readonly ReportRow[]>> = {
  sales: SALES_ROWS,
  vendor_performance: VENDOR_ROWS,
  product_performance: PRODUCT_ROWS,
  delivery_performance: DELIVERY_ROWS,
  tax_summary: TAX_ROWS,
};
