/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * Stands in for `/admin/ops/stock-alerts` and its `/summary` while those
 * endpoints are being built. Shown only behind the amber <SampleBanner/>.
 *
 * ── SHAPE NOTES ─────────────────────────────────────────────────────────────
 * `price` is INTEGER PAISE, like every money field in this console (plan §5.2).
 * `stock` is the joined inventory figure — stock does not live on the product
 * document. `severity` is derived by the API, not by this file: `out` when
 * stock is zero, `low` when it is at or under `lowStockThreshold`.
 *
 * Timestamps are frozen literals rather than offsets from `Date.now()`, so the
 * server render and the first client render produce identical strings.
 */

import type { AisleKey } from '@mandi/design-system';

export type StockSeverity = 'low' | 'out';

export interface StockAlertRow {
  id: string;
  name: string;
  vendorId: string;
  vendorName: string;
  aisleKey: AisleKey;
  stock: number;
  lowStockThreshold: number;
  severity: StockSeverity;
  lastRestockedAt: string;
  /** the velocity signal — how fast this empties once it is refilled */
  unitsSold30d: number;
  /** INTEGER PAISE */
  price: number;
  unit: string;
  unitValue: number;
}

export interface StockSummary {
  low: number;
  out: number;
  byVendor: { vendorId: string; vendorName: string; low: number; out: number }[];
  byAisle: { aisleKey: string; low: number; out: number }[];
}

interface Vendor {
  id: string;
  name: string;
}

const VENDORS: Vendor[] = [
  { id: 'ven-301', name: 'Anand Fresh Mart' },
  { id: 'ven-302', name: 'Green Basket Organics' },
  { id: 'ven-303', name: 'Kadai Kirana Stores' },
  { id: 'ven-304', name: 'Daily Dairy Depot' },
  { id: 'ven-305', name: 'Coastal Catch & Greens' },
];

export const STOCK_VENDOR_OPTIONS: { label: string; value: string }[] = [
  { label: 'Every vendor', value: '' },
  ...VENDORS.map((vendor) => ({ label: vendor.name, value: vendor.id })),
];

interface Seed {
  name: string;
  vendor: number;
  aisleKey: AisleKey;
  stock: number;
  threshold: number;
  restocked: string;
  sold30d: number;
  price: number;
  unit: string;
  unitValue: number;
}

const SEEDS: Seed[] = [
  /* out of stock — the rows that outrank everything else */
  { name: 'Amul Taaza Toned Milk', vendor: 3, aisleKey: 'dairy', stock: 0, threshold: 40, restocked: '2026-09-22T05:00:00.000Z', sold30d: 1840, price: 2800, unit: 'ml', unitValue: 500 },
  { name: 'Farm Eggs, tray of 12', vendor: 3, aisleKey: 'dairy', stock: 0, threshold: 25, restocked: '2026-09-21T04:30:00.000Z', sold30d: 720, price: 9200, unit: 'piece', unitValue: 12 },
  { name: 'Alphonso Mangoes', vendor: 0, aisleKey: 'fruits', stock: 0, threshold: 15, restocked: '2026-09-19T06:15:00.000Z', sold30d: 410, price: 34900, unit: 'kg', unitValue: 1 },
  { name: 'Brown Bread, whole wheat', vendor: 0, aisleKey: 'bakery', stock: 0, threshold: 20, restocked: '2026-09-23T03:00:00.000Z', sold30d: 960, price: 5500, unit: 'g', unitValue: 400 },
  { name: 'Frozen Green Peas', vendor: 4, aisleKey: 'frozen', stock: 0, threshold: 18, restocked: '2026-09-15T09:40:00.000Z', sold30d: 305, price: 12000, unit: 'g', unitValue: 500 },
  { name: 'Tender Coconut Water', vendor: 4, aisleKey: 'beverages', stock: 0, threshold: 24, restocked: '2026-09-20T07:20:00.000Z', sold30d: 540, price: 6000, unit: 'ml', unitValue: 200 },
  { name: 'Paneer, fresh block', vendor: 1, aisleKey: 'dairy', stock: 0, threshold: 12, restocked: '2026-09-22T04:10:00.000Z', sold30d: 388, price: 9900, unit: 'g', unitValue: 200 },
  { name: 'Coriander Leaves', vendor: 1, aisleKey: 'vegetables', stock: 0, threshold: 30, restocked: '2026-09-23T02:45:00.000Z', sold30d: 1220, price: 1500, unit: 'g', unitValue: 100 },

  /* low stock */
  { name: 'Basmati Rice, aged', vendor: 2, aisleKey: 'staples', stock: 4, threshold: 20, restocked: '2026-09-17T08:00:00.000Z', sold30d: 260, price: 41000, unit: 'kg', unitValue: 5 },
  { name: 'Toor Dal', vendor: 2, aisleKey: 'staples', stock: 7, threshold: 25, restocked: '2026-09-18T08:00:00.000Z', sold30d: 430, price: 18500, unit: 'kg', unitValue: 1 },
  { name: 'Bananas, Robusta', vendor: 0, aisleKey: 'fruits', stock: 9, threshold: 35, restocked: '2026-09-23T05:30:00.000Z', sold30d: 1560, price: 6000, unit: 'kg', unitValue: 1 },
  { name: 'Tomatoes, hybrid', vendor: 0, aisleKey: 'vegetables', stock: 11, threshold: 40, restocked: '2026-09-23T05:30:00.000Z', sold30d: 1980, price: 3800, unit: 'kg', unitValue: 1 },
  { name: 'Onions', vendor: 2, aisleKey: 'vegetables', stock: 14, threshold: 45, restocked: '2026-09-22T06:00:00.000Z', sold30d: 2240, price: 4200, unit: 'kg', unitValue: 1 },
  { name: 'Curd, set', vendor: 3, aisleKey: 'dairy', stock: 6, threshold: 20, restocked: '2026-09-24T03:15:00.000Z', sold30d: 890, price: 4500, unit: 'g', unitValue: 400 },
  { name: 'Butter, salted', vendor: 3, aisleKey: 'dairy', stock: 3, threshold: 15, restocked: '2026-09-21T03:15:00.000Z', sold30d: 310, price: 5800, unit: 'g', unitValue: 100 },
  { name: 'Masala Sandwich Bread', vendor: 1, aisleKey: 'bakery', stock: 5, threshold: 18, restocked: '2026-09-24T02:00:00.000Z', sold30d: 470, price: 4800, unit: 'g', unitValue: 350 },
  { name: 'Chocolate Chip Cookies', vendor: 1, aisleKey: 'snacks', stock: 8, threshold: 22, restocked: '2026-09-16T11:00:00.000Z', sold30d: 205, price: 11500, unit: 'g', unitValue: 250 },
  { name: 'Salted Potato Chips', vendor: 2, aisleKey: 'snacks', stock: 12, threshold: 30, restocked: '2026-09-19T11:00:00.000Z', sold30d: 640, price: 2000, unit: 'g', unitValue: 52 },
  { name: 'Cold-pressed Orange Juice', vendor: 4, aisleKey: 'beverages', stock: 2, threshold: 12, restocked: '2026-09-23T06:40:00.000Z', sold30d: 180, price: 16000, unit: 'ml', unitValue: 750 },
  { name: 'Masala Chai Leaves', vendor: 2, aisleKey: 'beverages', stock: 10, threshold: 20, restocked: '2026-09-12T10:00:00.000Z', sold30d: 95, price: 24000, unit: 'g', unitValue: 500 },
  { name: 'Frozen Paratha, pack of 5', vendor: 4, aisleKey: 'frozen', stock: 6, threshold: 16, restocked: '2026-09-20T09:00:00.000Z', sold30d: 275, price: 13500, unit: 'piece', unitValue: 5 },
  { name: 'Whole Wheat Atta', vendor: 2, aisleKey: 'staples', stock: 13, threshold: 28, restocked: '2026-09-21T08:30:00.000Z', sold30d: 520, price: 26000, unit: 'kg', unitValue: 5 },
  { name: 'Pomegranate', vendor: 0, aisleKey: 'fruits', stock: 5, threshold: 18, restocked: '2026-09-22T05:45:00.000Z', sold30d: 330, price: 21000, unit: 'kg', unitValue: 1 },
  { name: 'Baby Spinach', vendor: 1, aisleKey: 'vegetables', stock: 7, threshold: 24, restocked: '2026-09-24T02:30:00.000Z', sold30d: 460, price: 4000, unit: 'g', unitValue: 250 },
];

function vendorAt(index: number): Vendor {
  const vendor = VENDORS[index % VENDORS.length];
  if (vendor === undefined) throw new Error('VENDORS is empty');
  return vendor;
}

/**
 * Worst first: out of stock ahead of low, and inside each band the fastest
 * seller first — an empty shelf that turns over 1,800 units a month costs far
 * more than an empty shelf nobody was buying from.
 */
export const STOCK_ALERTS_FIXTURE: StockAlertRow[] = SEEDS.map((seed, index) => {
  const vendor = vendorAt(seed.vendor);
  return {
    id: `prd-${String(index + 1).padStart(4, '0')}`,
    name: seed.name,
    vendorId: vendor.id,
    vendorName: vendor.name,
    aisleKey: seed.aisleKey,
    stock: seed.stock,
    lowStockThreshold: seed.threshold,
    severity: seed.stock === 0 ? ('out' as const) : ('low' as const),
    lastRestockedAt: seed.restocked,
    unitsSold30d: seed.sold30d,
    price: seed.price,
    unit: seed.unit,
    unitValue: seed.unitValue,
  };
}).sort((a, b) => {
  if (a.severity !== b.severity) return a.severity === 'out' ? -1 : 1;
  return b.unitsSold30d - a.unitsSold30d;
});

/**
 * The summary the API computes across the WHOLE catalogue.
 *
 * Derived from the same rows here so the fixture cannot contradict itself. On
 * the live path it comes from its own endpoint and counts every alert, not just
 * the page on screen — which is the reason it is a separate call at all.
 */
export function summaryFrom(rows: readonly StockAlertRow[]): StockSummary {
  const byVendor = new Map<string, { vendorId: string; vendorName: string; low: number; out: number }>();
  const byAisle = new Map<string, { aisleKey: string; low: number; out: number }>();

  for (const row of rows) {
    const vendor = byVendor.get(row.vendorId) ?? {
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      low: 0,
      out: 0,
    };
    const aisle = byAisle.get(row.aisleKey) ?? { aisleKey: row.aisleKey, low: 0, out: 0 };
    if (row.severity === 'out') {
      vendor.out += 1;
      aisle.out += 1;
    } else {
      vendor.low += 1;
      aisle.low += 1;
    }
    byVendor.set(row.vendorId, vendor);
    byAisle.set(row.aisleKey, aisle);
  }

  return {
    low: rows.filter((row) => row.severity === 'low').length,
    out: rows.filter((row) => row.severity === 'out').length,
    byVendor: [...byVendor.values()].sort((a, b) => b.out - a.out || b.low - a.low),
    byAisle: [...byAisle.values()].sort((a, b) => b.out - a.out || b.low - a.low),
  };
}

export const STOCK_SUMMARY_FIXTURE: StockSummary = summaryFrom(STOCK_ALERTS_FIXTURE);
