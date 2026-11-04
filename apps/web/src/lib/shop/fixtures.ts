/**
 * Sample data for the customer surface — and the rules that keep it honest.
 *
 * ── WHEN THIS FIRES, AND ONLY WHEN ──────────────────────────────────────────
 * A fixture is served for ONE reason: the API could not be reached at all — a
 * dead server, a dropped connection, a CORS block, a timeout. `useShopQuery`
 * checks `ApiError.isNetworkError` and nothing else.
 *
 * It is NOT served for a 4xx. A 400 means this app sent a parameter the API
 * does not accept, and showing sample groceries on top of that hides the bug
 * behind a banner instead of fixing it. A 404 means the endpoint does not
 * exist; that must look like a missing endpoint. A 401 means sign in.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A fixture is NEVER presented as real. `useShopQuery` sets `isFixture: true`
 * whenever it serves one, and every screen that can show one renders
 * `<FixtureBanner>` — a visible strip naming the endpoint that did not answer.
 *
 * ── SHAPES ──────────────────────────────────────────────────────────────────
 * Every object below is written the way the RUNNING API returns it (flat `id`,
 * `{lat,lng}` locations, integer paise, `preview[]` on an order row, string
 * flag codes on a cart line), so it exercises the readers in `types.ts` rather
 * than bypassing them. If a reader stops accepting a fixture, the fixture is
 * wrong — not the reader.
 */

import { AISLES, type AisleKey } from '@mandi/design-system';

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/* ────────────────────────────── the stores ──────────────────────────────── */

interface FixtureStore {
  id: string;
  slug: string;
  storeName: string;
  description: string;
  logoUrl: null;
  bannerUrl: null;
  city: string;
  location: { lat: number; lng: number };
  isOpen: boolean;
  rating: number;
  serviceRadiusKm: number;
  codEnabled: boolean;
  distanceKm: number | null;
  /** Not part of StoreRow — used here only to build the categories fixture. */
  aisles: AisleKey[];
}

const STORES: readonly FixtureStore[] = [
  {
    id: 'fx-store-hosur',
    slug: 'hosur-road-mandi',
    storeName: 'Hosur Road Mandi',
    description: 'Wholesale produce floor, trading since 1994. Cut and weighed to order.',
    logoUrl: null,
    bannerUrl: null,
    city: 'Bengaluru',
    location: { lat: 12.9099, lng: 77.6221 },
    isOpen: true,
    rating: 4.6,
    serviceRadiusKm: 5,
    codEnabled: true,
    distanceKm: 1.2,
    aisles: ['fruits', 'vegetables', 'staples', 'dairy'],
  },
  {
    id: 'fx-store-dairy',
    slug: 'srinivasa-dairy',
    storeName: 'Srinivasa Dairy & Bakery',
    description: 'Cold chain held at 4°C. Bread out of the oven between 4 and 6am.',
    logoUrl: null,
    bannerUrl: null,
    city: 'Bengaluru',
    location: { lat: 12.9304, lng: 77.5833 },
    isOpen: true,
    rating: 4.4,
    serviceRadiusKm: 4,
    codEnabled: true,
    distanceKm: 2.8,
    aisles: ['dairy', 'bakery', 'beverages'],
  },
  {
    id: 'fx-store-kirana',
    slug: 'annapurna-kirana',
    storeName: 'Annapurna Kirana Stores',
    description: 'Staples milled to order. Batch date printed on every pack.',
    logoUrl: null,
    bannerUrl: null,
    city: 'Bengaluru',
    location: { lat: 12.9081, lng: 77.5563 },
    isOpen: false,
    rating: 4.2,
    serviceRadiusKm: 6,
    codEnabled: false,
    distanceKm: 3.9,
    aisles: ['staples', 'snacks', 'frozen'],
  },
  {
    id: 'fx-store-frozen',
    slug: 'coldline-frozen',
    storeName: 'Coldline Frozen Foods',
    description: 'Insulated bag on every frozen order. No surcharge, no soggy handover.',
    logoUrl: null,
    bannerUrl: null,
    city: 'Bengaluru',
    location: { lat: 12.9047, lng: 77.6165 },
    isOpen: true,
    rating: 4.1,
    serviceRadiusKm: 8,
    codEnabled: true,
    distanceKm: 4.4,
    aisles: ['frozen', 'snacks', 'beverages'],
  },
];

const FIRST_STORE: FixtureStore = STORES[0] as FixtureStore;

/** `GET /stores` returns StoreRow — no `address`, no `aisles`, no `productCount`. */
function storeRow(store: FixtureStore) {
  const { aisles: _aisles, ...row } = store;
  return row;
}

/** `GET /stores/:slug` adds the address block, the hours and the money. */
function storeDetail(store: FixtureStore) {
  return {
    ...storeRow(store),
    address: {
      line1: `${store.storeName.split(' ')[0] ?? ''} Main Road`,
      line2: null,
      city: store.city,
      state: 'Karnataka',
      pincode: '560068',
    },
    openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      open: '07:00',
      close: '23:00',
    })),
    codMaxAmount: 200_000,
    deliveryFee: 2900,
    freeDeliveryThreshold: 49_900,
    productCount: PRODUCTS.filter((p) => p.vendorId === store.id).length,
  };
}

/* ───────────────────────────── the products ─────────────────────────────── */

interface FixtureProduct {
  id: string;
  /** Not part of ProductRow — used here only to filter by store. */
  vendorId: string;
  name: string;
  slug: string;
  brand: string;
  images: string[];
  unit: string;
  unitValue: number;
  mrp: number;
  price: number;
  discountPct: number;
  categoryId: string;
  aisleKey: AisleKey;
  inStock: boolean;
  availableQty: number;
  /** `ProductRow.ratingAvg` / `ratingCount` — the visible-review aggregate. */
  ratingAvg: number;
  ratingCount: number;
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
  return aisle.items.map((item, index) => {
    const mrp = Math.round(item.paise * (1.08 + (index % 5) * 0.025));
    const out = aisle.key === 'frozen' && index === 4;
    return {
      id: `fx-${aisle.key}-${index}`,
      vendorId: store.id,
      name: item.name,
      slug: item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      brand: aisle.name,
      images: [],
      unit: item.unit,
      unitValue: 1,
      mrp,
      price: item.paise,
      discountPct: Math.round(((mrp - item.paise) / mrp) * 100),
      categoryId: `fx-cat-${aisle.key}`,
      aisleKey: aisle.key,
      inStock: !out,
      availableQty: out ? 0 : 6 + index * 3,
      // Most sample products are unreviewed, which is the honest default.
      ratingAvg: index % 3 === 0 ? 4.2 : 0,
      ratingCount: index % 3 === 0 ? 12 + index : 0,
    };
  });
});

/** `GET /stores/:id/products` returns ProductRow — no `vendorId` on the row. */
function productRow(product: FixtureProduct) {
  const { vendorId: _vendorId, ...row } = product;
  return row;
}

/** `GET /products/:id` adds the description, the sku, the category and the store. */
function productDetail(product: FixtureProduct) {
  const store = STORES.find((s) => s.id === product.vendorId) ?? FIRST_STORE;
  const aisle = AISLES.find((a) => a.key === product.aisleKey);
  return {
    ...productRow(product),
    description: aisle?.blurb ?? null,
    sku: product.id.toUpperCase(),
    category: {
      id: product.categoryId,
      name: aisle?.name ?? 'Category',
      slug: product.aisleKey,
      aisleKey: product.aisleKey,
    },
    store: {
      id: store.id,
      slug: store.slug,
      storeName: store.storeName,
      isOpen: store.isOpen,
      rating: store.rating,
    },
  };
}

/** `GET /stores/:id/categories` → AisleGroup[], empty aisles omitted. */
function categoriesFor(vendorId: string) {
  const store = STORES.find((s) => s.id === vendorId || s.slug === vendorId);
  if (store === undefined) return [];
  return store.aisles.map((key) => {
    const aisle = AISLES.find((a) => a.key === key);
    const count = PRODUCTS.filter((p) => p.vendorId === store.id && p.aisleKey === key).length;
    return {
      aisleKey: key,
      categories: [
        {
          id: `fx-cat-${key}`,
          name: aisle?.name ?? key,
          slug: key,
          imageUrl: null,
          sortOrder: 0,
          productCount: count,
        },
      ],
      productCount: count,
    };
  });
}

/* ─────────────────────────────── the cart ───────────────────────────────── */

const CART_SOURCE = PRODUCTS.filter((p) => p.aisleKey === 'vegetables').slice(0, 3);
const CART_QTY = (index: number): number => (index === 0 ? 2 : 1);

/**
 * One line per flag branch, so the sample exercises every chip rather than the
 * happy path. `flags` is a flat array of codes — that is the API's shape, and
 * the detail behind a chip comes from `price` vs `currentPrice` and `qty` vs
 * `availableQty` on the line itself.
 */
const CART_ITEMS = CART_SOURCE.map((product, index) => {
  const qty = CART_QTY(index);
  const currentPrice = index === 0 ? product.price + 400 : product.price;
  const availableQty = index === 1 ? 1 : product.availableQty;
  return {
    productId: product.id,
    name: product.name,
    image: null,
    price: product.price,
    currentPrice,
    qty,
    lineTotal: currentPrice * qty,
    availableQty,
    flags: index === 0 ? ['price_changed'] : index === 1 ? ['reduced_qty'] : [],
  };
});

const CART_SUBTOTAL = CART_ITEMS.reduce((sum, line) => sum + line.lineTotal, 0);
const CART_TAXES = Math.round(CART_SUBTOTAL * 0.05);

const CART_PRICING = {
  itemsSubtotal: CART_SUBTOTAL,
  deliveryFee: 2900,
  taxes: CART_TAXES,
  grandTotal: CART_SUBTOTAL + 2900 + CART_TAXES,
};

const CART = {
  id: 'fx-cart-1',
  vendorId: FIRST_STORE.id,
  store: {
    id: FIRST_STORE.id,
    slug: FIRST_STORE.slug,
    storeName: FIRST_STORE.storeName,
    isOpen: FIRST_STORE.isOpen,
  },
  status: 'active',
  items: CART_ITEMS,
  itemCount: CART_ITEMS.reduce((sum, line) => sum + line.qty, 0),
  pricing: CART_PRICING,
  hasIssues: true,
  parkedCarts: [],
};

/* ───────────────────────────── the addresses ────────────────────────────── */

const ADDRESSES = [
  {
    id: 'fx-addr-home',
    label: 'Home',
    line1: '402, Sunrise Residency',
    line2: '8th Main, BTM Layout',
    city: 'Bengaluru',
    pincode: '560076',
    location: { lat: 12.9166, lng: 77.6101 },
    phone: '9845000000',
    isDefault: true,
  },
  {
    id: 'fx-addr-work',
    label: 'Work',
    line1: 'Tower B, Level 4',
    line2: 'Outer Ring Road, Bellandur',
    city: 'Bengaluru',
    pincode: '560103',
    location: { lat: 12.9304, lng: 77.6748 },
    phone: '9845000000',
    isDefault: false,
  },
];

/* ─────────────────────────────── the orders ─────────────────────────────── */

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

const ORDER_ITEMS = CART_SOURCE.map((product, index) => ({
  productId: product.id,
  name: product.name,
  image: null,
  unit: product.unit,
  price: product.price,
  qty: CART_QTY(index),
  lineTotal: product.price * CART_QTY(index),
  fulfilled: true,
}));

const ORDER_PRICING = {
  itemsSubtotal: ORDER_ITEMS.reduce((sum, item) => sum + item.lineTotal, 0),
  discount: 0,
  deliveryFee: 2900,
  taxes: CART_TAXES,
  grandTotal: ORDER_ITEMS.reduce((sum, item) => sum + item.lineTotal, 0) + 2900 + CART_TAXES,
};

interface FixtureStatusChange {
  from: string | null;
  to: string;
  at: string;
  byRole: string | null;
  reason: string | null;
}

interface FixtureOrder {
  id: string;
  orderNo: string;
  status: string;
  placedAt: string;
  itemCount: number;
  grandTotal: number;
  payment: { method: string; status: string };
  store: { id: string; storeName: string; slug: string };
  preview: string[];
  items: typeof ORDER_ITEMS;
  pricing: typeof ORDER_PRICING;
  address: {
    label: string;
    line1: string;
    line2: string;
    city: string;
    pincode: string;
    location: { lat: number; lng: number };
    phone: string;
  };
  statusHistory: FixtureStatusChange[];
  cancellation: { by: string; reason: string; at: string } | null;
  canCancel: boolean;
  acceptedAt: string | null;
  deliveredAt: string | null;
  rating: { storeRating: number; riderRating: number | null; comment: string | null; at: string } | null;
  canRate: boolean;
  rateUntil: string | null;
  hasRider: boolean;
}

const LIVE_ORDER: FixtureOrder = {
  id: 'fx-order-live',
  orderNo: 'MND-20260925-0042',
  status: 'OUT_FOR_DELIVERY',
  placedAt: minutesAgo(26),
  itemCount: ORDER_ITEMS.reduce((sum, item) => sum + item.qty, 0),
  grandTotal: ORDER_PRICING.grandTotal,
  payment: { method: 'cod', status: 'pending' },
  store: { id: FIRST_STORE.id, storeName: FIRST_STORE.storeName, slug: FIRST_STORE.slug },
  preview: ORDER_ITEMS.slice(0, 3).map((item) => item.name),
  items: ORDER_ITEMS,
  pricing: ORDER_PRICING,
  address: {
    label: 'Home',
    line1: '402, Sunrise Residency',
    line2: '8th Main, BTM Layout',
    city: 'Bengaluru',
    pincode: '560076',
    location: { lat: 12.9166, lng: 77.6101 },
    phone: '9845000000',
  },
  statusHistory: [
    { from: null, to: 'PLACED', at: minutesAgo(26), byRole: 'customer', reason: null },
    { from: 'PLACED', to: 'ACCEPTED', at: minutesAgo(24), byRole: 'vendor', reason: null },
    { from: 'ACCEPTED', to: 'PACKING', at: minutesAgo(21), byRole: 'vendor', reason: null },
    { from: 'PACKING', to: 'READY_FOR_PICKUP', at: minutesAgo(16), byRole: 'vendor', reason: null },
    { from: 'READY_FOR_PICKUP', to: 'ASSIGNED', at: minutesAgo(14), byRole: 'admin', reason: null },
    { from: 'ASSIGNED', to: 'PICKED_UP', at: minutesAgo(9), byRole: 'delivery', reason: null },
    { from: 'PICKED_UP', to: 'OUT_FOR_DELIVERY', at: minutesAgo(8), byRole: 'delivery', reason: null },
  ],
  cancellation: null,
  canCancel: false,
  acceptedAt: minutesAgo(24),
  deliveredAt: null,
  rating: null,
  canRate: false,
  rateUntil: null,
  hasRider: true,
};

const DELIVERED_ORDER: FixtureOrder = {
  ...LIVE_ORDER,
  id: 'fx-order-2',
  orderNo: 'MND-20260922-0018',
  status: 'DELIVERED',
  placedAt: minutesAgo(60 * 72),
  payment: { method: 'online', status: 'paid' },
  store: {
    id: STORES[1]?.id ?? FIRST_STORE.id,
    storeName: STORES[1]?.storeName ?? FIRST_STORE.storeName,
    slug: STORES[1]?.slug ?? FIRST_STORE.slug,
  },
  statusHistory: [
    { from: null, to: 'PLACED', at: minutesAgo(60 * 72), byRole: 'customer', reason: null },
    { from: 'PLACED', to: 'ACCEPTED', at: minutesAgo(60 * 72 - 3), byRole: 'vendor', reason: null },
    { from: 'PICKED_UP', to: 'OUT_FOR_DELIVERY', at: minutesAgo(60 * 72 - 20), byRole: 'delivery', reason: null },
    { from: 'OUT_FOR_DELIVERY', to: 'DELIVERED', at: minutesAgo(60 * 72 - 34), byRole: 'delivery', reason: null },
  ],
  canCancel: false,
  deliveredAt: minutesAgo(60 * 72 - 34),
  canRate: true,
  rateUntil: minutesAgo(60 * 72 - 34 - 14 * 24 * 60),
};

const CANCELLED_ORDER: FixtureOrder = {
  ...LIVE_ORDER,
  id: 'fx-order-3',
  orderNo: 'MND-20260919-0004',
  status: 'CANCELLED',
  placedAt: minutesAgo(60 * 144),
  payment: { method: 'cod', status: 'pending' },
  store: {
    id: STORES[2]?.id ?? FIRST_STORE.id,
    storeName: STORES[2]?.storeName ?? FIRST_STORE.storeName,
    slug: STORES[2]?.slug ?? FIRST_STORE.slug,
  },
  statusHistory: [
    { from: null, to: 'PLACED', at: minutesAgo(60 * 144), byRole: 'customer', reason: null },
    {
      from: 'PLACED',
      to: 'CANCELLED',
      at: minutesAgo(60 * 144 - 4),
      byRole: 'customer',
      reason: 'Ordered by mistake',
    },
  ],
  cancellation: {
    by: 'customer',
    reason: 'Ordered by mistake',
    at: minutesAgo(60 * 144 - 4),
  },
  canCancel: false,
  acceptedAt: null,
  deliveredAt: null,
  hasRider: false,
};

const ALL_ORDERS = [LIVE_ORDER, DELIVERED_ORDER, CANCELLED_ORDER];

/** `GET /orders` returns SUMMARIES — no `items`, no `pricing`, no `address`. */
function orderSummary(order: FixtureOrder) {
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    placedAt: order.placedAt,
    itemCount: order.itemCount,
    grandTotal: order.grandTotal,
    payment: order.payment,
    store: order.store,
    preview: order.preview,
  };
}

/** `GET /orders/:id/track` → TrackView. No items, no pricing, no route. */
const TRACK = {
  orderId: LIVE_ORDER.id,
  orderNo: LIVE_ORDER.orderNo,
  status: LIVE_ORDER.status,
  statusHistory: LIVE_ORDER.statusHistory,
  eta: { minutes: 11, at: new Date(Date.now() + 11 * 60_000).toISOString(), basis: 'sla' },
  vendor: {
    id: FIRST_STORE.id,
    name: FIRST_STORE.storeName,
    location: FIRST_STORE.location,
  },
  drop: {
    location: { lat: 12.9166, lng: 77.6101 },
    line1: '402, Sunrise Residency',
    city: 'Bengaluru',
    pincode: '560076',
  },
  rider: {
    name: 'Ravi K.',
    phone: '9845000041',
    location: { lat: 12.9137, lng: 77.6171 },
    // Deliberately ~40s old, so the "last seen" path is visible in the sample.
    lastSeenAt: new Date(Date.now() - 40_000).toISOString(),
    ageSeconds: 40,
  },
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
 *
 * The parameter names checked here are the REAL ones the API accepts (`q`,
 * `aisleKey`, `category`, `page`, `limit`). A fixture that answered to an
 * invented parameter is how the wrong parameter survived this long.
 */
export function resolveShopFixture(path: string, params: QueryParams = {}): unknown | null {
  const clean = path.split('?')[0] ?? path;
  const segments = clean.split('/').filter(Boolean);

  /* /stores … */
  if (segments[0] === 'stores') {
    if (segments.length === 1) {
      const q = params['q'];
      const rows =
        typeof q === 'string' && q.trim() !== ''
          ? STORES.filter((s) => s.storeName.toLowerCase().includes(q.trim().toLowerCase()))
          : STORES;
      return paged(rows.map(storeRow), params);
    }
    if (segments.length === 2) {
      const key = segments[1];
      const store = STORES.find((s) => s.slug === key || s.id === key);
      return store === undefined ? null : storeDetail(store);
    }
    if (segments.length === 3 && segments[2] === 'categories') {
      return categoriesFor(segments[1] ?? '');
    }
    if (segments.length === 3 && segments[2] === 'products') {
      const vendorId = segments[1] ?? '';
      const store = STORES.find((s) => s.id === vendorId || s.slug === vendorId);
      let rows = PRODUCTS.filter((p) => p.vendorId === (store?.id ?? vendorId));

      const aisleKey = params['aisleKey'];
      if (typeof aisleKey === 'string' && aisleKey !== '') {
        rows = rows.filter((p) => p.aisleKey === aisleKey);
      }
      const category = params['category'];
      if (typeof category === 'string' && category !== '') {
        rows = rows.filter((p) => p.categoryId === category || p.aisleKey === category);
      }
      const q = params['q'];
      if (typeof q === 'string' && q.trim() !== '') {
        rows = rows.filter((p) => matchesQuery(p, q.trim()));
      }
      return paged(rows.map(productRow), params);
    }
  }

  /* /products/:id — there is NO market-wide `GET /products` on the API, so
     there is deliberately no fixture for the bare collection either. */
  if (segments[0] === 'products' && segments.length === 2) {
    const id = segments[1];
    const product = PRODUCTS.find((p) => p.id === id || p.slug === id);
    return product === undefined ? null : productDetail(product);
  }

  if (clean === '/cart') return CART;
  /* `/addresses` answers with a BARE ARRAY, not an envelope. */
  if (clean === '/addresses') return ADDRESSES;

  if (segments[0] === 'orders') {
    if (segments.length === 1) return paged(ALL_ORDERS.map(orderSummary), params);
    if (segments.length === 2) {
      const id = segments[1];
      return ALL_ORDERS.find((o) => o.id === id) ?? LIVE_ORDER;
    }
    if (segments.length === 3 && segments[2] === 'track') return TRACK;
  }

  return null;
}

/** Ids that only exist in this file — used to keep sample links self-consistent. */
export const FIXTURE_LIVE_ORDER_ID = LIVE_ORDER.id;
