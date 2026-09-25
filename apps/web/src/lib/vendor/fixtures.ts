/**
 * ★ SAMPLE DATA — none of this is real, and the UI says so out loud.
 *
 * Worker A's `/vendor/*` endpoints are landing in parallel with this panel.
 * Without a fallback every screen here would be a 404 error state and none of
 * it would be reviewable. So when a request fails and this module recognises
 * the path, `useVendorQuery` returns a fixture and flips `isFixture` — which
 * forces the amber `<FixtureBanner/>` onto the page and stamps every KPI tile.
 *
 * ── THE RULES THAT MAKE THIS SAFE TO SHIP ───────────────────────────────────
 *   1. A fixture is ONLY ever returned after a real request has already
 *      failed. Nothing here is preferred over the API.
 *   2. `isFixture` is not advisory. The banner is not dismissible.
 *   3. An unknown path returns `null` so the real error surfaces. A missing
 *      fixture must look like a missing endpoint, not like an empty shop.
 *   4. Every number is INTEGER PAISE, same as the real contract — so the day
 *      the endpoint lands, nothing on screen changes shape.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────
 * A seeded LCG, not `Math.random`, so two renders of the same screen show the
 * same shop. Timestamps are the one thing derived from the clock: an order
 * board whose cards all say "waiting 0 min" teaches nobody anything about what
 * the screen looks like during a rush.
 */

import type {
  EarningsRange,
  EarningsSummary,
  InventoryLogEntry,
  InventoryRow,
  LedgerEntryRow,
  OrderStatus,
  Paged,
  SalesReport,
  SettlementRow,
  VendorCategory,
  VendorOrder,
  VendorOrderDetail,
  VendorPartner,
  VendorProduct,
  VendorProfile,
} from './types';
import type { AisleKey } from '@mandi/design-system';

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/* ------------------------------------------------------------------ */
/* Deterministic noise                                                 */
/* ------------------------------------------------------------------ */

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(list: readonly T[], r: number): T {
  const item = list[Math.min(list.length - 1, Math.floor(r * list.length))];
  // `noUncheckedIndexedAccess` is on; the clamp above makes this unreachable.
  if (item === undefined) throw new Error('fixture: empty list');
  return item;
}

const MIN = 60_000;

/* ------------------------------------------------------------------ */
/* The shop                                                            */
/* ------------------------------------------------------------------ */

const STORE_NAME = 'Sharma Fresh Mandi';
const COMMISSION_PCT = 12;

export const VENDOR_PROFILE_FIXTURE: VendorProfile = {
  id: 'ven_sample',
  storeName: STORE_NAME,
  slug: 'sharma-fresh-mandi',
  description:
    'Fruit, vegetables and daily staples from Sector 22. Family run since 1998.',
  logoUrl: null,
  bannerUrl: null,
  phone: '+919812345678',
  address: {
    line1: 'Shop 14, Sector 22-C Market',
    line2: 'Near the community centre',
    city: 'Chandigarh',
    state: 'Chandigarh',
    pincode: '160022',
  },
  location: { type: 'Point', coordinates: [76.7644, 30.7333] },
  serviceRadiusKm: 5,
  commissionPct: COMMISSION_PCT,
  codEnabled: true,
  codMaxAmount: 200000,
  isOpen: true,
  openingHours: [
    { day: 0, open: '08:00', close: '13:00' },
    { day: 1, open: '07:30', close: '21:30' },
    { day: 2, open: '07:30', close: '21:30' },
    { day: 3, open: '07:30', close: '21:30' },
    { day: 4, open: '07:30', close: '21:30' },
    { day: 5, open: '07:30', close: '22:00' },
    { day: 6, open: '07:30', close: '22:00' },
  ],
  status: 'approved',
  rating: 4.6,
  ratingCount: 1184,
};

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

const CATALOGUE: ReadonlyArray<{
  name: string;
  brand: string;
  aisleKey: AisleKey;
  category: string;
  unit: VendorProduct['unit'];
  unitValue: number;
  mrp: number;
  price: number;
}> = [
  { name: 'Alphonso mango', brand: 'Ratnagiri', aisleKey: 'fruits', category: 'Fruits', unit: 'kg', unitValue: 1, mrp: 46000, price: 39900 },
  { name: 'Nagpur orange', brand: 'Farm direct', aisleKey: 'fruits', category: 'Fruits', unit: 'kg', unitValue: 1, mrp: 12000, price: 9900 },
  { name: 'Banana robusta', brand: 'Farm direct', aisleKey: 'fruits', category: 'Fruits', unit: 'pack', unitValue: 6, mrp: 6000, price: 4900 },
  { name: 'Tomato hybrid', brand: 'Local', aisleKey: 'vegetables', category: 'Vegetables', unit: 'kg', unitValue: 1, mrp: 4500, price: 3200 },
  { name: 'Onion nashik', brand: 'Local', aisleKey: 'vegetables', category: 'Vegetables', unit: 'kg', unitValue: 1, mrp: 4000, price: 3500 },
  { name: 'Potato jyoti', brand: 'Local', aisleKey: 'vegetables', category: 'Vegetables', unit: 'kg', unitValue: 1, mrp: 3500, price: 2800 },
  { name: 'Spinach bunch', brand: 'Local', aisleKey: 'vegetables', category: 'Vegetables', unit: 'piece', unitValue: 1, mrp: 3000, price: 2000 },
  { name: 'Toned milk', brand: 'Verka', aisleKey: 'dairy', category: 'Dairy & Eggs', unit: 'ml', unitValue: 500, mrp: 2900, price: 2700 },
  { name: 'Paneer block', brand: 'Verka', aisleKey: 'dairy', category: 'Dairy & Eggs', unit: 'g', unitValue: 200, mrp: 9500, price: 8900 },
  { name: 'Farm eggs', brand: 'Suguna', aisleKey: 'dairy', category: 'Dairy & Eggs', unit: 'pack', unitValue: 6, mrp: 8400, price: 7800 },
  { name: 'Whole wheat bread', brand: 'Britannia', aisleKey: 'bakery', category: 'Bakery', unit: 'g', unitValue: 400, mrp: 5500, price: 5000 },
  { name: 'Atta chakki fresh', brand: 'Aashirvaad', aisleKey: 'staples', category: 'Staples & Grains', unit: 'kg', unitValue: 5, mrp: 29500, price: 26900 },
  { name: 'Basmati rice', brand: 'India Gate', aisleKey: 'staples', category: 'Staples & Grains', unit: 'kg', unitValue: 1, mrp: 18000, price: 15500 },
  { name: 'Toor dal', brand: 'Tata Sampann', aisleKey: 'staples', category: 'Staples & Grains', unit: 'kg', unitValue: 1, mrp: 19000, price: 17400 },
  { name: 'Masala chai', brand: 'Tata Tea', aisleKey: 'beverages', category: 'Beverages', unit: 'g', unitValue: 250, mrp: 15000, price: 13500 },
  { name: 'Cold coffee', brand: 'Amul', aisleKey: 'beverages', category: 'Beverages', unit: 'ml', unitValue: 200, mrp: 4000, price: 3500 },
  { name: 'Salted chips', brand: 'Lay’s', aisleKey: 'snacks', category: 'Snacks', unit: 'g', unitValue: 90, mrp: 3000, price: 2900 },
  { name: 'Roasted peanuts', brand: 'Haldiram', aisleKey: 'snacks', category: 'Snacks', unit: 'g', unitValue: 200, mrp: 6500, price: 5900 },
  { name: 'Frozen peas', brand: 'Safal', aisleKey: 'frozen', category: 'Frozen', unit: 'g', unitValue: 500, mrp: 9000, price: 8200 },
  { name: 'Frozen paratha', brand: 'ID Fresh', aisleKey: 'frozen', category: 'Frozen', unit: 'pack', unitValue: 5, mrp: 11000, price: 9900 },
];

const CATEGORY_IDS: Record<string, string> = {
  Fruits: 'cat_fruits',
  Vegetables: 'cat_vegetables',
  'Dairy & Eggs': 'cat_dairy',
  Bakery: 'cat_bakery',
  'Staples & Grains': 'cat_staples',
  Beverages: 'cat_beverages',
  Snacks: 'cat_snacks',
  Frozen: 'cat_frozen',
};

function categoryId(name: string): string {
  return CATEGORY_IDS[name] ?? 'cat_other';
}

export function productsFixture(): VendorProduct[] {
  const random = lcg(0x5eed01);
  const now = Date.now();
  return CATALOGUE.map((entry, i) => {
    const threshold = 10 + Math.floor(random() * 10);
    const stock = Math.floor(random() * 90);
    return {
      id: `prd_${String(i + 1).padStart(3, '0')}`,
      name: entry.name,
      slug: entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: `${entry.name} — graded and packed the morning it is listed.`,
      sku: `SKU-${String(1000 + i * 7)}`,
      brand: entry.brand,
      categoryId: categoryId(entry.category),
      categoryName: entry.category,
      aisleKey: entry.aisleKey,
      images: [],
      unit: entry.unit,
      unitValue: entry.unitValue,
      mrp: entry.mrp,
      price: entry.price,
      discountPct: Math.round(((entry.mrp - entry.price) / entry.mrp) * 100),
      isActive: i !== 6 && i !== 17,
      createdAt: new Date(now - (i + 4) * 86_400_000).toISOString(),
      stock,
      lowStockThreshold: threshold,
    };
  });
}

export function categoriesFixture(): VendorCategory[] {
  const products = productsFixture();
  const seen = new Map<string, VendorCategory>();
  for (const product of products) {
    const existing = seen.get(product.categoryId);
    if (existing) {
      existing.productCount += 1;
      continue;
    }
    seen.set(product.categoryId, {
      id: product.categoryId,
      name: product.categoryName,
      slug: product.categoryId.replace('cat_', ''),
      aisleKey: product.aisleKey,
      isActive: true,
      productCount: 1,
    });
  }
  return [...seen.values()];
}

export function inventoryFixture(): InventoryRow[] {
  const random = lcg(0x1f0a);
  const now = Date.now();
  return productsFixture().map((product) => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    aisleKey: product.aisleKey,
    categoryName: product.categoryName,
    stock: product.stock ?? 0,
    reserved: Math.floor(random() * 4),
    lowStockThreshold: product.lowStockThreshold ?? 12,
    unit: product.unit,
    unitValue: product.unitValue,
    price: product.price,
    isActive: product.isActive,
    updatedAt: new Date(now - Math.floor(random() * 600) * MIN).toISOString(),
  }));
}

export function inventoryLogFixture(productId: string): InventoryLogEntry[] {
  const random = lcg(productId.length * 7919 + 13);
  const now = Date.now();
  const reasons: ReadonlyArray<InventoryLogEntry['reason']> = [
    'restock',
    'order_commit',
    'order_reserve',
    'order_release',
    'manual',
  ];
  let balance = 40 + Math.floor(random() * 40);
  const rows: InventoryLogEntry[] = [];
  for (let i = 0; i < 14; i += 1) {
    const reason = pick(reasons, random());
    const delta =
      reason === 'restock'
        ? 20 + Math.floor(random() * 40)
        : reason === 'manual'
          ? Math.floor(random() * 11) - 5
          : -(1 + Math.floor(random() * 3));
    rows.push({
      id: `log_${productId}_${i}`,
      productId,
      delta,
      reason,
      refId: reason.startsWith('order') ? `MND-20260925-${String(1200 + i)}` : null,
      byName: reason === 'restock' || reason === 'manual' ? 'You' : 'System',
      at: new Date(now - (i * 97 + 11) * MIN).toISOString(),
      balance,
    });
    balance -= delta;
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

const CUSTOMERS: readonly string[] = [
  'Aarav Mehta',
  'Priya Nair',
  'Rohit Bansal',
  'Simran Kaur',
  'Imran Qureshi',
  'Devika Rao',
  'Kabir Sethi',
  'Ananya Ghosh',
  'Harpreet Singh',
  'Meera Iyer',
];

/**
 * The board's shape is the point of this fixture: a few unaccepted orders
 * ageing at the top of the New lane, a couple packing, a couple boxed and
 * waiting for a rider. A demo where every lane holds one card teaches nothing
 * about what the screen does under pressure.
 */
const BOARD_PLAN: ReadonlyArray<{ status: OrderStatus; ageMin: number }> = [
  { status: 'PLACED', ageMin: 11 },
  { status: 'PLACED', ageMin: 6 },
  { status: 'PLACED', ageMin: 2 },
  { status: 'ACCEPTED', ageMin: 14 },
  { status: 'PACKING', ageMin: 19 },
  { status: 'PACKING', ageMin: 9 },
  { status: 'READY_FOR_PICKUP', ageMin: 24 },
  { status: 'READY_FOR_PICKUP', ageMin: 16 },
  { status: 'ASSIGNED', ageMin: 31 },
  { status: 'OUT_FOR_DELIVERY', ageMin: 42 },
  { status: 'DELIVERED', ageMin: 96 },
  { status: 'DELIVERED', ageMin: 134 },
  { status: 'DELIVERED', ageMin: 188 },
  { status: 'DELIVERED', ageMin: 240 },
  { status: 'REJECTED', ageMin: 305 },
  { status: 'CANCELLED', ageMin: 372 },
];

function orderNo(index: number): string {
  return `MND-20260925-${String(1041 + index).padStart(4, '0')}`;
}

export function ordersFixture(): VendorOrder[] {
  const random = lcg(0xb0a2d);
  const now = Date.now();
  const products = productsFixture();

  return BOARD_PLAN.map((plan, index) => {
    const lineCount = 2 + Math.floor(random() * 4);
    const preview: Array<{ name: string; qty: number }> = [];
    let subtotal = 0;
    for (let i = 0; i < lineCount; i += 1) {
      const product = pick(products, random());
      const qty = 1 + Math.floor(random() * 3);
      preview.push({ name: product.name, qty });
      subtotal += product.price * qty;
    }
    const deliveryFee = subtotal > 50000 ? 0 : 2900;
    const total = subtotal + deliveryFee;
    const cod = random() > 0.55;

    return {
      id: `ord_${String(index + 1).padStart(3, '0')}`,
      orderNo: orderNo(index),
      status: plan.status,
      customerName: pick(CUSTOMERS, random()),
      customerPhone: `+9198${String(10000000 + Math.floor(random() * 89999999))}`,
      itemCount: preview.reduce((sum, line) => sum + line.qty, 0),
      total,
      paymentMethod: cod ? 'cod' : 'online',
      paymentStatus: cod ? 'pending' : 'paid',
      placedAt: new Date(now - plan.ageMin * MIN).toISOString(),
      acceptedAt:
        plan.status === 'PLACED'
          ? null
          : new Date(now - (plan.ageMin - 1) * MIN).toISOString(),
      etaMinutes: plan.status === 'PLACED' ? null : 20 + Math.floor(random() * 20),
      partnerName:
        plan.status === 'ASSIGNED' || plan.status === 'OUT_FOR_DELIVERY'
          ? 'Jaspreet Singh'
          : null,
      preview,
    };
  });
}

export function orderDetailFixture(id: string): VendorOrderDetail {
  const list = ordersFixture();
  const base = list.find((order) => order.id === id) ?? list[0];
  if (!base) throw new Error('fixture: no orders');

  const random = lcg(id.length * 104_729 + 7);
  const products = productsFixture();
  const items = base.preview.map((line, i) => {
    const product =
      products.find((candidate) => candidate.name === line.name) ?? pick(products, random());
    return {
      productId: product.id,
      name: product.name,
      image: null,
      unit: `${product.unitValue} ${product.unit}`,
      price: product.price,
      qty: line.qty,
      lineTotal: product.price * line.qty,
      fulfilled: true,
      key: i,
    };
  });

  const itemsSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const deliveryFee = itemsSubtotal > 50000 ? 0 : 2900;
  const taxes = 0;
  const discount = 0;
  const grandTotal = itemsSubtotal + deliveryFee + taxes - discount;
  const commissionAmount = Math.round((itemsSubtotal * COMMISSION_PCT) / 100);

  const history = buildHistory(base.status, base.placedAt);

  return {
    ...base,
    total: grandTotal,
    items: items.map(({ key: _key, ...item }) => item),
    pricing: {
      itemsSubtotal,
      discount,
      deliveryFee,
      taxes,
      grandTotal,
      commissionPct: COMMISSION_PCT,
      commissionAmount,
      vendorPayout: itemsSubtotal - commissionAmount,
    },
    address: {
      label: 'Home',
      line1: 'House 218, Sector 21-A',
      line2: 'Opposite the park',
      city: 'Chandigarh',
      pincode: '160022',
      phone: base.customerPhone,
    },
    statusHistory: history,
    deliveryPartnerId: base.partnerName ? 'dp_001' : null,
    note: id.endsWith('2') ? 'Please send ripe bananas, not green ones.' : null,
  };
}

const FLOW: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PACKING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

function buildHistory(status: OrderStatus, placedAt: string): VendorOrderDetail['statusHistory'] {
  const start = Date.parse(placedAt);
  const events: VendorOrderDetail['statusHistory'] = [
    { from: null, to: 'PLACED', byRole: 'customer', byName: 'Customer', at: placedAt },
  ];

  if (status === 'REJECTED' || status === 'CANCELLED') {
    events.push({
      from: 'PLACED',
      to: status,
      byRole: status === 'REJECTED' ? 'vendor' : 'customer',
      byName: status === 'REJECTED' ? 'You' : 'Customer',
      reason: status === 'REJECTED' ? 'Out of stock on two lines' : 'Changed my mind',
      at: new Date(start + 4 * MIN).toISOString(),
    });
    return events;
  }

  const target = FLOW.indexOf(status);
  for (let i = 1; i <= (target < 0 ? 0 : target); i += 1) {
    const to = FLOW[i];
    const from = FLOW[i - 1];
    if (!to || !from) continue;
    events.push({
      from,
      to,
      byRole: i <= 3 ? 'vendor' : 'delivery',
      byName: i <= 3 ? 'You' : 'Jaspreet Singh',
      at: new Date(start + i * 6 * MIN).toISOString(),
    });
  }
  return events;
}

/* ------------------------------------------------------------------ */
/* Partners                                                            */
/* ------------------------------------------------------------------ */

export function partnersFixture(): VendorPartner[] {
  const now = Date.now();
  return [
    {
      id: 'dp_001',
      name: 'Jaspreet Singh',
      phone: '+919876500011',
      vehicleType: 'bike',
      isOnline: true,
      isAvailable: false,
      completedCount: 428,
      rating: 4.8,
      activeOrderId: 'ord_009',
      activeOrderNo: orderNo(8),
      lastSeenAt: new Date(now - 40_000).toISOString(),
    },
    {
      id: 'dp_002',
      name: 'Rekha Devi',
      phone: '+919876500022',
      vehicleType: 'scooter',
      isOnline: true,
      isAvailable: true,
      completedCount: 191,
      rating: 4.9,
      activeOrderId: null,
      activeOrderNo: null,
      lastSeenAt: new Date(now - 3 * MIN).toISOString(),
    },
    {
      id: 'dp_003',
      name: 'Mohit Kumar',
      phone: '+919876500033',
      vehicleType: 'bicycle',
      isOnline: false,
      isAvailable: false,
      completedCount: 62,
      rating: 4.4,
      activeOrderId: null,
      activeOrderNo: null,
      lastSeenAt: new Date(now - 190 * MIN).toISOString(),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

const RANGE_DAYS: Record<EarningsRange, number> = { day: 1, week: 7, month: 30 };

export function salesFixture(range: EarningsRange): SalesReport {
  const random = lcg(0xf00d + RANGE_DAYS[range]);
  const now = new Date();
  const buckets = range === 'day' ? 12 : range === 'week' ? 7 : 30;
  const points = Array.from({ length: buckets }, (_, i) => {
    const back = buckets - 1 - i;
    const at =
      range === 'day'
        ? new Date(now.getTime() - back * 60 * MIN)
        : new Date(now.getTime() - back * 86_400_000);
    const orders = 4 + Math.floor(random() * 14);
    return {
      bucket: at.toISOString(),
      orders,
      revenue: orders * (28_000 + Math.floor(random() * 26_000)),
    };
  });

  return {
    granularity: range,
    points,
    total: points.reduce((sum, point) => sum + point.revenue, 0),
    orders: points.reduce((sum, point) => sum + point.orders, 0),
  };
}

export function earningsFixture(range: EarningsRange): EarningsSummary {
  const sales = salesFixture(range);
  const grossSales = sales.total;
  const totalCommission = Math.round((grossSales * COMMISSION_PCT) / 100);
  const refunds = Math.round(grossSales * 0.011);
  const netEarnings = grossSales - totalCommission - refunds;

  const random = lcg(0xcafe + RANGE_DAYS[range]);
  const now = Date.now();
  const orders = ordersFixture();

  const ledger: LedgerEntryRow[] = [];
  orders
    .filter((order) => order.status === 'DELIVERED')
    .forEach((order, i) => {
      const commission = Math.round((order.total * COMMISSION_PCT) / 100);
      ledger.push({
        id: `led_${i}_sale`,
        orderId: order.id,
        orderNo: order.orderNo,
        type: 'sale',
        amount: order.total,
        settlementId: i > 1 ? 'set_002' : null,
        createdAt: order.placedAt,
      });
      ledger.push({
        id: `led_${i}_comm`,
        orderId: order.id,
        orderNo: order.orderNo,
        type: 'commission',
        amount: -commission,
        settlementId: i > 1 ? 'set_002' : null,
        createdAt: order.placedAt,
      });
    });
  ledger.push({
    id: 'led_payout',
    orderId: null,
    orderNo: null,
    type: 'payout',
    amount: -Math.round(netEarnings * 0.6),
    settlementId: 'set_002',
    createdAt: new Date(now - 2 * 86_400_000).toISOString(),
  });

  const settlements: SettlementRow[] = [0, 1, 2].map((i) => {
    const gross = Math.round(grossSales * (0.8 + random() * 0.5));
    const commission = Math.round((gross * COMMISSION_PCT) / 100);
    const refundAmount = Math.round(gross * 0.01);
    return {
      id: `set_00${3 - i}`,
      periodStart: new Date(now - (i + 1) * 7 * 86_400_000).toISOString(),
      periodEnd: new Date(now - i * 7 * 86_400_000).toISOString(),
      grossSales: gross,
      totalCommission: commission,
      refunds: refundAmount,
      netPayable: gross - commission - refundAmount,
      status: i === 0 ? 'pending' : i === 1 ? 'processing' : 'paid',
      paidAt: i === 2 ? new Date(now - 12 * 86_400_000).toISOString() : null,
      reference: i === 2 ? 'UTR-2026-0918-88123' : null,
    };
  });

  const products = productsFixture();
  const topProducts = products.slice(0, 6).map((product, i) => {
    const units = 180 - i * 22 + Math.floor(random() * 18);
    return {
      productId: product.id,
      name: product.name,
      units,
      revenue: units * product.price,
    };
  });

  return {
    range,
    grossSales,
    commissionPct: COMMISSION_PCT,
    totalCommission,
    refunds,
    netEarnings,
    orderCount: sales.orders,
    averageOrderValue: sales.orders === 0 ? 0 : Math.round(grossSales / sales.orders),
    paidOut: Math.round(netEarnings * 0.6),
    pendingPayout: netEarnings - Math.round(netEarnings * 0.6),
    ledger,
    settlements,
    topProducts,
  };
}

/* ------------------------------------------------------------------ */
/* The resolver                                                        */
/* ------------------------------------------------------------------ */

function page<T>(rows: T[], params: QueryParams): Paged<T> {
  const limit = Number(params['limit'] ?? 20) || 20;
  const current = Number(params['page'] ?? 1) || 1;
  const start = (current - 1) * limit;
  return {
    data: rows.slice(start, start + limit),
    meta: {
      page: current,
      limit,
      total: rows.length,
      pages: Math.max(1, Math.ceil(rows.length / limit)),
    },
  };
}

function asRange(value: unknown): EarningsRange {
  return value === 'day' || value === 'week' || value === 'month' ? value : 'week';
}

/**
 * Path -> sample payload, or `null` when this module does not know the path.
 *
 * `null` is load-bearing: it is what lets a genuinely broken endpoint show up
 * as a broken endpoint instead of quietly rendering a plausible shop.
 */
export function resolveFixture(path: string, params: QueryParams = {}): unknown {
  /* ---- store ---- */
  if (path === '/vendor/profile') return VENDOR_PROFILE_FIXTURE;

  /* ---- orders ---- */
  if (path === '/vendor/orders') {
    const status = params['status'];
    let rows = ordersFixture();
    if (typeof status === 'string' && status !== '' && status !== 'all') {
      const wanted = new Set(status.split(','));
      rows = rows.filter((order) => wanted.has(order.status));
    }
    return page(rows, params);
  }

  const orderDetail = /^\/vendor\/orders\/([^/]+)$/.exec(path);
  if (orderDetail?.[1]) return orderDetailFixture(orderDetail[1]);

  /* ---- catalogue ---- */
  if (path === '/vendor/categories') return categoriesFixture();

  if (path === '/vendor/products') {
    let rows = productsFixture();
    const q = params['q'];
    if (typeof q === 'string' && q.trim() !== '') {
      const needle = q.trim().toLowerCase();
      rows = rows.filter(
        (product) =>
          product.name.toLowerCase().includes(needle) ||
          product.brand.toLowerCase().includes(needle) ||
          product.sku.toLowerCase().includes(needle),
      );
    }
    const category = params['categoryId'];
    if (typeof category === 'string' && category !== '' && category !== 'all') {
      rows = rows.filter((product) => product.categoryId === category);
    }
    const active = params['isActive'];
    if (active === 'true' || active === 'false') {
      rows = rows.filter((product) => String(product.isActive) === active);
    }
    if (params['lowStock'] === 'true' || params['lowStock'] === true) {
      rows = rows.filter(
        (product) => (product.stock ?? 0) <= (product.lowStockThreshold ?? 0),
      );
    }
    return page(rows, params);
  }

  const productDetail = /^\/vendor\/products\/([^/]+)$/.exec(path);
  if (productDetail?.[1]) {
    const found = productsFixture().find((product) => product.id === productDetail[1]);
    return found ?? null;
  }

  /* ---- inventory ---- */
  if (path === '/vendor/inventory') {
    let rows = inventoryFixture();
    const q = params['q'];
    if (typeof q === 'string' && q.trim() !== '') {
      const needle = q.trim().toLowerCase();
      rows = rows.filter(
        (row) =>
          row.name.toLowerCase().includes(needle) || row.sku.toLowerCase().includes(needle),
      );
    }
    if (params['lowStock'] === 'true' || params['lowStock'] === true) {
      rows = rows.filter((row) => row.stock <= row.lowStockThreshold);
    }
    return page(rows, params);
  }

  const logs = /^\/vendor\/inventory\/([^/]+)\/logs$/.exec(path);
  if (logs?.[1]) return inventoryLogFixture(logs[1]);

  /* ---- partners ---- */
  if (path === '/vendor/delivery-partners') return partnersFixture();

  /* ---- money ---- */
  if (path === '/vendor/earnings') return earningsFixture(asRange(params['range']));
  if (path === '/vendor/reports/sales') return salesFixture(asRange(params['range']));

  return null;
}
