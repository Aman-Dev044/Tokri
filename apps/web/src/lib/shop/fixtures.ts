/**
 * Sample data for the customer surface — and the rules that keep it honest.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Workers B and C are landing `/stores`, `/cart`, `/checkout` and `/orders` in
 * parallel with this app. Without a fallback, every shop screen would be an
 * error state and none of the design would be reviewable.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A fixture is NEVER presented as real. `useShopQuery` sets `isFixture: true`
 * whenever it serves one, and every screen that can show one renders
 * `<FixtureBanner>` — a visible strip naming the endpoint that did not answer.
 * Prices, stock and ETAs from this file are sample values and the user is told
 * so before they read a single number.
 *
 * If a path has NO fixture here, the real `ApiError` is surfaced instead. A
 * missing endpoint must look like a missing endpoint.
 *
 * The shapes below are deliberately written the way the API is specced to
 * return them (plan §5.1 / §6.2) — nested `pricing`, GeoJSON `location`,
 * integer paise — so they exercise the readers in `types.ts` rather than
 * bypassing them.
 */

import { AISLES, type AisleKey } from '@mandi/design-system';

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/* ────────────────────────────── the stores ──────────────────────────────── */

interface FixtureStore {
  _id: string;
  slug: string;
  storeName: string;
  description: string;
  address: { line1: string; city: string; state: string; pincode: string };
  location: { type: 'Point'; coordinates: [number, number] };
  distanceKm: number;
  etaMinutes: number;
  isOpen: boolean;
  rating: number;
  codEnabled: boolean;
  aisles: AisleKey[];
  productCount: number;
}

const STORES: readonly FixtureStore[] = [
  {
    _id: 'fx-store-hosur',
    slug: 'hosur-road-mandi',
    storeName: 'Hosur Road Mandi',
    description: 'Wholesale produce floor, trading since 1994. Cut and weighed to order.',
    address: {
      line1: '14, Hosur Main Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560068',
    },
    location: { type: 'Point', coordinates: [77.6221, 12.9099] },
    distanceKm: 1.2,
    etaMinutes: 14,
    isOpen: true,
    rating: 4.6,
    codEnabled: true,
    aisles: ['fruits', 'vegetables', 'staples', 'dairy'],
    productCount: 412,
  },
  {
    _id: 'fx-store-dairy',
    slug: 'srinivasa-dairy',
    storeName: 'Srinivasa Dairy & Bakery',
    description: 'Cold chain held at 4°C. Bread out of the oven between 4 and 6am.',
    address: {
      line1: '3rd Cross, Jayanagar',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560041',
    },
    location: { type: 'Point', coordinates: [77.5833, 12.9304] },
    distanceKm: 2.8,
    etaMinutes: 22,
    isOpen: true,
    rating: 4.4,
    codEnabled: true,
    aisles: ['dairy', 'bakery', 'beverages'],
    productCount: 168,
  },
  {
    _id: 'fx-store-kirana',
    slug: 'annapurna-kirana',
    storeName: 'Annapurna Kirana Stores',
    description: 'Staples milled to order. Batch date printed on every pack.',
    address: {
      line1: '22, Kanakapura Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560078',
    },
    location: { type: 'Point', coordinates: [77.5563, 12.9081] },
    distanceKm: 3.9,
    etaMinutes: 28,
    isOpen: false,
    rating: 4.2,
    codEnabled: false,
    aisles: ['staples', 'snacks', 'frozen'],
    productCount: 297,
  },
  {
    _id: 'fx-store-frozen',
    slug: 'coldline-frozen',
    storeName: 'Coldline Frozen Foods',
    description: 'Insulated bag on every frozen order. No surcharge, no soggy handover.',
    address: {
      line1: 'Unit 7, Bommanahalli',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560068',
    },
    location: { type: 'Point', coordinates: [77.6165, 12.9047] },
    distanceKm: 4.4,
    etaMinutes: 31,
    isOpen: true,
    rating: 4.1,
    codEnabled: true,
    aisles: ['frozen', 'snacks', 'beverages'],
    productCount: 84,
  },
];

const FIRST_STORE: FixtureStore = STORES[0] as FixtureStore;

/* ───────────────────────────── the products ─────────────────────────────── */

interface FixtureProduct {
  _id: string;
  vendorId: string;
  storeName: string;
  name: string;
  slug: string;
  brand: string;
  description: string;
  images: string[];
  unit: string;
  pricePaise: number;
  mrpPaise: number;
  aisleKey: AisleKey;
  inStock: boolean;
  stock: number;
}

function storeForAisle(aisle: AisleKey): FixtureStore {
  return STORES.find((s) => s.aisles.includes(aisle)) ?? FIRST_STORE;
}

/**
 * Built from the eight aisles in the design system, so the sample catalogue and
 * the landing page's ticker never drift apart — one source of truth for both.
 */
const PRODUCTS: readonly FixtureProduct[] = AISLES.flatMap((aisle) => {
  const store = storeForAisle(aisle.key);
  return aisle.items.map((item, index) => ({
    _id: `fx-${aisle.key}-${index}`,
    vendorId: store._id,
    storeName: store.storeName,
    name: item.name,
    slug: item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    brand: aisle.name,
    description: aisle.blurb,
    images: [],
    unit: item.unit,
    pricePaise: item.paise,
    // A believable MRP: 8–18% above the selling price, deterministic.
    mrpPaise: Math.round(item.paise * (1.08 + (index % 5) * 0.025)),
    aisleKey: aisle.key,
    inStock: !(aisle.key === 'frozen' && index === 4),
    stock: aisle.key === 'frozen' && index === 4 ? 0 : 6 + index * 3,
  }));
});

/* ─────────────────────────────── the cart ───────────────────────────────── */

const CART_SOURCE = PRODUCTS.filter((p) => p.aisleKey === 'vegetables').slice(0, 3);
const CART_QTY = (index: number): number => (index === 0 ? 2 : 1);
const CART_SUBTOTAL = CART_SOURCE.reduce(
  (sum, product, index) => sum + product.pricePaise * CART_QTY(index),
  0,
);

const CART_ITEMS = CART_SOURCE.map((product, index) => ({
  productId: product._id,
  name: product.name,
  image: null,
  unit: product.unit,
  price: product.pricePaise,
  qty: CART_QTY(index),
  lineTotal: product.pricePaise * CART_QTY(index),
  maxQty: product.stock,
  // The three honest flags the cart screen renders as inline chips. One of
  // each, so the sample exercises every branch rather than the happy path.
  flags:
    index === 0
      ? [{ code: 'price_changed', from: product.pricePaise - 400, to: product.pricePaise }]
      : index === 1
        ? [{ code: 'reduced_qty', fromQty: 3, toQty: 1 }]
        : [],
}));

const CART_PRICING = {
  itemsSubtotal: CART_SUBTOTAL,
  discount: 0,
  deliveryFee: 2900,
  taxes: 0,
  grandTotal: CART_SUBTOTAL + 2900,
};

const CART = {
  _id: 'fx-cart-1',
  vendorId: FIRST_STORE._id,
  storeName: FIRST_STORE.storeName,
  storeSlug: FIRST_STORE.slug,
  items: CART_ITEMS,
  pricing: CART_PRICING,
  couponCode: null,
};

/* ───────────────────────────── the addresses ────────────────────────────── */

const ADDRESSES = [
  {
    _id: 'fx-addr-home',
    label: 'Home',
    line1: '402, Sunrise Residency',
    line2: '8th Main, BTM Layout',
    city: 'Bengaluru',
    pincode: '560076',
    phone: '+91 98450 00000',
    location: { type: 'Point', coordinates: [77.6101, 12.9166] },
    isDefault: true,
  },
  {
    _id: 'fx-addr-work',
    label: 'Work',
    line1: 'Tower B, Level 4',
    line2: 'Outer Ring Road, Bellandur',
    city: 'Bengaluru',
    pincode: '560103',
    phone: '+91 98450 00000',
    location: { type: 'Point', coordinates: [77.6748, 12.9304] },
    isDefault: false,
  },
];

/* ─────────────────────────────── the orders ─────────────────────────────── */

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const LIVE_ORDER = {
  _id: 'fx-order-live',
  orderNo: 'MND-20260925-0042',
  status: 'OUT_FOR_DELIVERY',
  statusHistory: [
    { from: null, to: 'PLACED', at: minutesAgo(26), byRole: 'customer' },
    { from: 'PLACED', to: 'ACCEPTED', at: minutesAgo(24), byRole: 'vendor' },
    { from: 'ACCEPTED', to: 'PACKING', at: minutesAgo(21), byRole: 'vendor' },
    { from: 'PACKING', to: 'READY_FOR_PICKUP', at: minutesAgo(16), byRole: 'vendor' },
    { from: 'READY_FOR_PICKUP', to: 'ASSIGNED', at: minutesAgo(14), byRole: 'system' },
    { from: 'ASSIGNED', to: 'PICKED_UP', at: minutesAgo(9), byRole: 'delivery' },
    { from: 'PICKED_UP', to: 'OUT_FOR_DELIVERY', at: minutesAgo(8), byRole: 'delivery' },
  ],
  vendorId: FIRST_STORE._id,
  storeName: FIRST_STORE.storeName,
  storeSlug: FIRST_STORE.slug,
  storeLocation: FIRST_STORE.location,
  aisleKey: 'vegetables',
  items: CART_ITEMS,
  pricing: CART_PRICING,
  address: ADDRESSES[0],
  payment: { method: 'cod', status: 'pending' },
  placedAt: minutesAgo(26),
  etaMinutes: 11,
  deliveryPartner: { name: 'Ravi K.', phoneMasked: '+91 ***** 41' },
};

const PAST_ORDERS = [
  {
    _id: 'fx-order-2',
    orderNo: 'MND-20260922-0018',
    status: 'DELIVERED',
    vendorId: STORES[1]?._id ?? FIRST_STORE._id,
    storeName: STORES[1]?.storeName ?? FIRST_STORE.storeName,
    aisleKey: 'dairy',
    items: PRODUCTS.filter((p) => p.aisleKey === 'dairy')
      .slice(0, 2)
      .map((product) => ({
        productId: product._id,
        name: product.name,
        unit: product.unit,
        price: product.pricePaise,
        qty: 1,
        lineTotal: product.pricePaise,
        fulfilled: true,
      })),
    pricing: { itemsSubtotal: 12300, discount: 0, deliveryFee: 2900, taxes: 0, grandTotal: 15200 },
    address: ADDRESSES[0],
    payment: { method: 'online', status: 'paid' },
    placedAt: minutesAgo(60 * 72),
    deliveredAt: minutesAgo(60 * 72 - 34),
  },
  {
    _id: 'fx-order-3',
    orderNo: 'MND-20260919-0004',
    status: 'CANCELLED',
    vendorId: STORES[2]?._id ?? FIRST_STORE._id,
    storeName: STORES[2]?.storeName ?? FIRST_STORE.storeName,
    aisleKey: 'staples',
    items: PRODUCTS.filter((p) => p.aisleKey === 'staples')
      .slice(0, 1)
      .map((product) => ({
        productId: product._id,
        name: product.name,
        unit: product.unit,
        price: product.pricePaise,
        qty: 1,
        lineTotal: product.pricePaise,
        fulfilled: false,
      })),
    pricing: { itemsSubtotal: 42000, discount: 0, deliveryFee: 0, taxes: 0, grandTotal: 42000 },
    address: ADDRESSES[1],
    payment: { method: 'cod', status: 'pending' },
    placedAt: minutesAgo(60 * 144),
  },
];

/**
 * A short route from the store towards the drop. Enough points for the polyline
 * to read as a road rather than a ruler, and the rider sits partway along it.
 */
const ROUTE: ReadonlyArray<{ lat: number; lng: number }> = [
  { lat: 12.9099, lng: 77.6221 },
  { lat: 12.9118, lng: 77.6198 },
  { lat: 12.9137, lng: 77.6171 },
  { lat: 12.9149, lng: 77.6142 },
  { lat: 12.9158, lng: 77.6118 },
  { lat: 12.9166, lng: 77.6101 },
];

const TRACK = {
  order: LIVE_ORDER,
  rider: {
    lat: 12.9137,
    lng: 77.6171,
    // Deliberately ~40s old, so the "last seen" path is visible in the sample.
    at: new Date(Date.now() - 40_000).toISOString(),
    etaMinutes: 11,
  },
  route: ROUTE,
};

/* ══════════════════════════════ resolution ═════════════════════════════ */

function paged<T>(rows: readonly T[], params: QueryParams): { data: T[]; meta: object } {
  const limitRaw = Number(params['limit'] ?? 20);
  const pageRaw = Number(params['page'] ?? 1);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20;
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const start = (page - 1) * limit;
  return {
    data: rows.slice(start, start + limit),
    meta: { page, limit, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / limit)) },
  };
}

function matchesQuery(product: FixtureProduct, q: string): boolean {
  const needle = q.toLowerCase();
  return (
    product.name.toLowerCase().includes(needle) ||
    product.brand.toLowerCase().includes(needle) ||
    product.aisleKey.includes(needle)
  );
}

/**
 * Returns sample data for a known path, or `null` when there is none —
 * in which case `useShopQuery` surfaces the real error.
 */
export function resolveShopFixture(path: string, params: QueryParams = {}): unknown | null {
  const clean = path.split('?')[0] ?? path;
  const segments = clean.split('/').filter(Boolean);

  /* /stores … */
  if (segments[0] === 'stores') {
    if (segments.length === 1) {
      const aisle = params['aisle'];
      const rows =
        typeof aisle === 'string' && aisle !== ''
          ? STORES.filter((s) => (s.aisles as string[]).includes(aisle))
          : STORES;
      return paged(rows, params);
    }
    if (segments.length === 2) {
      const key = segments[1];
      return STORES.find((s) => s.slug === key || s._id === key) ?? null;
    }
    if (segments.length === 3 && segments[2] === 'products') {
      const vendorId = segments[1];
      const store = STORES.find((s) => s._id === vendorId || s.slug === vendorId);
      let rows = PRODUCTS.filter((p) => p.vendorId === (store?._id ?? vendorId));
      const aisle = params['aisle'] ?? params['category'];
      if (typeof aisle === 'string' && aisle !== '') {
        rows = rows.filter((p) => p.aisleKey === aisle);
      }
      const q = params['q'];
      if (typeof q === 'string' && q.trim() !== '') {
        rows = rows.filter((p) => matchesQuery(p, q.trim()));
      }
      return paged(rows, params);
    }
  }

  /* /products … */
  if (segments[0] === 'products') {
    if (segments.length === 1) {
      let rows = PRODUCTS;
      const aisle = params['aisle'] ?? params['category'];
      if (typeof aisle === 'string' && aisle !== '') {
        rows = rows.filter((p) => p.aisleKey === aisle);
      }
      const q = params['q'];
      if (typeof q === 'string' && q.trim() !== '') {
        rows = rows.filter((p) => matchesQuery(p, q.trim()));
      }
      return paged(rows, params);
    }
    if (segments.length === 2) {
      const id = segments[1];
      return PRODUCTS.find((p) => p._id === id || p.slug === id) ?? null;
    }
  }

  if (clean === '/cart') return CART;
  if (clean === '/addresses') return paged(ADDRESSES, params);

  if (segments[0] === 'orders') {
    if (segments.length === 1) return paged([LIVE_ORDER, ...PAST_ORDERS], params);
    if (segments.length === 2) {
      const id = segments[1];
      return [LIVE_ORDER, ...PAST_ORDERS].find((o) => o._id === id) ?? LIVE_ORDER;
    }
    if (segments.length === 3 && segments[2] === 'track') return TRACK;
  }

  return null;
}

/** Ids that only exist in this file — used to keep sample links self-consistent. */
export const FIXTURE_LIVE_ORDER_ID = LIVE_ORDER._id;
