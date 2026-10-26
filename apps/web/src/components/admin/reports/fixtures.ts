/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * ── THE ENDPOINT ────────────────────────────────────────────────────────────
 * `GET /admin/reports?report=&grouping=&from=&to=` (SUPER_ADMIN only) answers
 * `{ data: ReportRow[], meta }`, unpaged, with rows SPARSE — a day with no
 * orders has no row. These fixtures stand in for it only when it cannot be
 * reached, and they speak its shape, not the screen's: product rows carry
 * `aisleKey` and no display name (the page names the aisle), vendor rows carry
 * `vendorId`.
 *
 * ── COLUMNS THAT DO NOT EXIST, AND WHY ─────────────────────────────────────
 * Each was removed because the platform stores nothing it could be computed
 * from, and a plausible number on a report is read as fact:
 *   vendor Rating        `Vendor.rating` is never written — every store reads 0
 *   Riders online        only the CURRENT online flag is stored; pings expire
 *   CGST / SGST          the split depends on the customer's state, which an
 *                        order address does not store
 * Likewise the groupings "vendors by city", "delivery by city", "products by
 * category" and "tax by state": each would have put a city, a category or a
 * state into a column headed Vendor, Date, Aisle or GST slab.
 *
 * Money is INTEGER PAISE. Percentages are 0–100 numbers, not fractions.
 * `null` means "not measurable for this row" (an average over zero
 * deliveries) and is drawn as a dash, never as 0.
 */

import { AISLES } from '@mandi/design-system';

/** A report row. Values are raw — formatting is the table's job, not the data's. */
export type ReportRow = Record<string, string | number | null>;

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
  /** a unique key per row, when `xKey` can repeat (two stores, one name) */
  rowKey?: string;
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
    description:
      'Orders and gross merchandise value (order totals, cancelled and rejected orders excluded), by UTC day, week or month.',
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
    description:
      'How much each store sold, the commission on it, and the share of its orders that were cancelled or rejected.',
    chart: 'bar',
    xKey: 'vendor',
    rowKey: 'vendorId',
    series: [{ key: 'gmvPaise', label: 'GMV' }],
    columns: [
      { key: 'vendor', header: 'Vendor', kind: 'text' },
      { key: 'city', header: 'City', kind: 'text' },
      { key: 'orders', header: 'Orders', kind: 'number' },
      { key: 'gmvPaise', header: 'GMV', kind: 'money' },
      { key: 'commissionPaise', header: 'Commission', kind: 'money' },
      { key: 'cancelPct', header: 'Cancelled', kind: 'pct' },
    ],
    groupings: [{ label: 'By vendor', value: 'vendor' }],
  },
  {
    key: 'product_performance',
    label: 'Product performance',
    description: 'Units sold and line revenue from fulfilled lines, grouped by aisle.',
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
    groupings: [{ label: 'By aisle', value: 'aisle' }],
  },
  {
    key: 'delivery_performance',
    label: 'Delivery performance',
    description:
      'Placed-to-delivered minutes, the on-time rate against the platform SLA, and failed delivery attempts, by UTC day.',
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
    ],
    groupings: [{ label: 'By day', value: 'day' }],
  },
  {
    key: 'tax_summary',
    label: 'Tax summary',
    description:
      'Taxable value and GST on delivered orders, by the rate each order was actually charged.',
    chart: 'bar',
    xKey: 'slab',
    series: [{ key: 'taxPaise', label: 'Tax collected' }],
    columns: [
      { key: 'slab', header: 'GST slab', kind: 'text' },
      { key: 'orders', header: 'Orders', kind: 'number' },
      { key: 'taxablePaise', header: 'Taxable value', kind: 'money' },
      { key: 'taxPaise', header: 'Total tax', kind: 'money' },
    ],
    groupings: [{ label: 'By slab', value: 'slab' }],
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
  { vendorId: 'v_01', vendor: 'Nandini Fresh, HSR', city: 'Bengaluru', orders: 3_218, gmvPaise: 3_74_11_200, commissionPaise: 56_11_680, cancelPct: 2.1 },
  { vendorId: 'v_02', vendor: 'Jubilee Daily Needs', city: 'Hyderabad', orders: 2_486, gmvPaise: 2_81_44_900, commissionPaise: 39_40_286, cancelPct: 3.4 },
  { vendorId: 'v_03', vendor: 'Sahyadri Kirana', city: 'Pune', orders: 2_047, gmvPaise: 2_18_36_500, commissionPaise: 26_20_380, cancelPct: 1.8 },
  { vendorId: 'v_04', vendor: 'T. Nagar Grocers', city: 'Chennai', orders: 1_512, gmvPaise: 1_64_82_100, commissionPaise: 21_42_673, cancelPct: 4.2 },
  { vendorId: 'v_05', vendor: 'Park Street Provisions', city: 'Kolkata', orders: 964, gmvPaise: 98_74_300, commissionPaise: 13_82_402, cancelPct: 5.7 },
  { vendorId: 'v_06', vendor: 'Marine Drive Mart', city: 'Kochi', orders: 703, gmvPaise: 71_21_650, commissionPaise: 10_68_247, cancelPct: 6.9 },
];

/**
 * Aisle rows are derived so the keys can never drift. Like the endpoint, they
 * carry `aisleKey` only — the page puts the name on — and omit an aisle with
 * no sales rather than listing it at zero.
 */
const AISLE_GMV: readonly number[] = [
  1_84_21_000, 2_41_66_500, 1_52_30_400, 68_44_200, 96_18_700, 1_12_73_900, 2_08_55_100, 47_91_300,
];
const AISLE_UNITS: readonly number[] = [41_280, 68_940, 52_110, 19_440, 27_360, 33_820, 58_770, 12_650];
const AISLE_PRODUCTS: readonly number[] = [115, 170, 85, 57, 117, 155, 265, 64];

const PRODUCT_ROWS: readonly ReportRow[] = (() => {
  const total = AISLE_GMV.reduce((sum, n) => sum + n, 0);
  return AISLES.flatMap((aisle, index) => {
    const gmv = AISLE_GMV[index] ?? 0;
    if (gmv === 0) return [];
    return [
      {
        aisleKey: aisle.key,
        products: AISLE_PRODUCTS[index] ?? 0,
        units: AISLE_UNITS[index] ?? 0,
        gmvPaise: gmv,
        sharePct: total === 0 ? 0 : Math.round((gmv / total) * 1000) / 10,
      },
    ];
  });
})();

const DELIVERY_ROWS: readonly ReportRow[] = [
  { date: '2026-09-18', deliveries: 1_241, avgMinutes: 22, onTimePct: 93.4, failed: 18 },
  { date: '2026-09-19', deliveries: 1_318, avgMinutes: 21, onTimePct: 94.1, failed: 14 },
  { date: '2026-09-20', deliveries: 1_654, avgMinutes: 26, onTimePct: 88.7, failed: 41 },
  { date: '2026-09-21', deliveries: 1_602, avgMinutes: 25, onTimePct: 90.2, failed: 33 },
  { date: '2026-09-22', deliveries: 1_158, avgMinutes: 20, onTimePct: 95.8, failed: 9 },
  { date: '2026-09-23', deliveries: 1_277, avgMinutes: 21, onTimePct: 94.6, failed: 12 },
  { date: '2026-09-24', deliveries: 812, avgMinutes: 19, onTimePct: 96.3, failed: 5 },
];

const TAX_ROWS: readonly ReportRow[] = [
  { slab: '0%', orders: 6_418, taxablePaise: 4_82_14_600, taxPaise: 0 },
  { slab: '5%', orders: 4_112, taxablePaise: 2_16_40_800, taxPaise: 10_82_040 },
  { slab: '12%', orders: 1_874, taxablePaise: 96_22_300, taxPaise: 11_54_676 },
  { slab: '18%', orders: 1_205, taxablePaise: 71_08_900, taxPaise: 12_79_602 },
];

export const REPORT_ROWS: Readonly<Record<ReportKey, readonly ReportRow[]>> = {
  sales: SALES_ROWS,
  vendor_performance: VENDOR_ROWS,
  product_performance: PRODUCT_ROWS,
  delivery_performance: DELIVERY_ROWS,
  tax_summary: TAX_ROWS,
};
