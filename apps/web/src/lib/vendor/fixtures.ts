/**
 * ★ SAMPLE DATA — none of this is real, and the UI says so out loud.
 *
 * ── WHEN THIS IS ALLOWED TO APPEAR ──────────────────────────────────────────
 * ONLY after a genuine NETWORK failure — the API process is down, DNS fails,
 * CORS blocks the request. `useVendorQuery` checks `ApiError.isNetworkError`
 * before it ever asks this module for anything.
 *
 * A 400, a 403 or a 404 is a CONTRACT bug, and a contract bug that silently
 * renders a plausible shop is the worst possible outcome: the panel looks
 * fine, the vendor reads numbers that are not theirs, and nobody finds the
 * wrong query parameter for a week. Those statuses surface as error states.
 *
 * ── THE OTHER RULES ─────────────────────────────────────────────────────────
 *   1. A fixture is only ever returned after a real request has failed.
 *   2. `isFixture` is not advisory. The banner is not dismissible.
 *   3. An unknown path returns `null` so the real error surfaces.
 *   4. Every shape here is the REAL API shape and every amount is INTEGER
 *      PAISE — so the day the network comes back, nothing changes shape.
 *
 * ── DETERMINISM ─────────────────────────────────────────────────────────────
 * A seeded LCG, not `Math.random`, so two renders of the same screen show the
 * same shop. Timestamps are the one thing derived from the clock: a board
 * whose cards all say "waiting 0 min" teaches nobody what a rush looks like.
 */

import type { AisleKey } from '@mandi/design-system';
import { startOfLocalDay } from './range';
import type {
  DashboardSparkPoint,
  EarningsSummary,
  InventoryRow,
  LedgerEntryRow,
  OrderStatus,
  Paged,
  SalesBucket,
  SalesGroupBy,
  SalesReport,
  SettlementRow,
  TopProductsReport,
  VendorCategory,
  VendorDashboard,
  VendorOrder,
  VendorOrderDetail,
  VendorPartner,
  VendorProduct,
  VendorProfile,
} from './types';

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
const DAY = 86_400_000;

const VENDOR_ID = 'ven_sample';
const STORE_NAME = 'Sharma Fresh Mandi';
const COMMISSION_PCT = 12;

/* ------------------------------------------------------------------ */
/* The shop                                                            */
/* ------------------------------------------------------------------ */

export const VENDOR_PROFILE_FIXTURE: VendorProfile = {
  id: VENDOR_ID,
  storeName: STORE_NAME,
  slug: 'sharma-fresh-mandi',
  description: 'Fruit, vegetables and daily staples from Sector 22. Family run since 1998.',
  logoUrl: null,
  bannerUrl: null,
  address: {
    line1: 'Shop 14, Sector 22-C Market',
    line2: 'Near the community centre',
    city: 'Chandigarh',
    state: 'Chandigarh',
    pincode: '160022',
  },
  location: { lat: 30.7333, lng: 76.7644 },
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
  createdAt: new Date(Date.now() - 400 * DAY).toISOString(),
  updatedAt: new Date(Date.now() - 3 * DAY).toISOString(),
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
    const lowStockThreshold = 10 + Math.floor(random() * 10);
    const stock = Math.floor(random() * 90);
    const reserved = Math.floor(random() * 4);
    return {
      id: `prd_${String(i + 1).padStart(3, '0')}`,
      vendorId: VENDOR_ID,
      categoryId: categoryId(entry.category),
      categoryName: entry.category,
      aisleKey: entry.aisleKey,
      name: entry.name,
      slug: entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: `${entry.name} — graded and packed the morning it is listed.`,
      images: [],
      brand: entry.brand,
      unit: entry.unit,
      unitValue: entry.unitValue,
      sku: `SKU-${String(1000 + i * 7)}`,
      mrp: entry.mrp,
      price: entry.price,
      discountPct: Math.round(((entry.mrp - entry.price) / entry.mrp) * 100),
      isActive: i !== 6 && i !== 17,
      stock,
      reserved,
      lowStockThreshold,
      isLowStock: stock <= lowStockThreshold,
      createdAt: new Date(now - (i + 4) * DAY).toISOString(),
      updatedAt: new Date(now - i * 3 * MIN).toISOString(),
    };
  });
}

export function categoriesFixture(): VendorCategory[] {
  const products = productsFixture();
  const seen = new Map<string, VendorCategory>();
  let order = 0;
  for (const product of products) {
    const existing = seen.get(product.categoryId);
    if (existing) {
      existing.productCount += 1;
      continue;
    }
    order += 1;
    seen.set(product.categoryId, {
      id: product.categoryId,
      vendorId: null,
      isGlobal: true,
      name: product.categoryName ?? 'Other',
      slug: product.categoryId.replace('cat_', ''),
      aisleKey: product.aisleKey ?? 'staples',
      parentId: null,
      imageUrl: null,
      sortOrder: order,
      isActive: true,
      productCount: 1,
      createdAt: new Date(Date.now() - 400 * DAY).toISOString(),
    });
  }
  return [...seen.values()];
}

export function inventoryFixture(): InventoryRow[] {
  const now = Date.now();
  const random = lcg(0x1f0a);
  return productsFixture().map((product) => ({
    productId: product.id,
    vendorId: VENDOR_ID,
    name: product.name,
    sku: product.sku,
    brand: product.brand,
    categoryId: product.categoryId,
    aisleKey: product.aisleKey,
    price: product.price,
    isActive: product.isActive,
    stock: product.stock,
    reserved: product.reserved,
    available: Math.max(0, product.stock - product.reserved),
    lowStockThreshold: product.lowStockThreshold,
    isLowStock: product.stock <= product.lowStockThreshold,
    isOutOfStock: product.stock <= 0,
    updatedAt: new Date(now - Math.floor(random() * 600) * MIN).toISOString(),
  }));
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
 * The board's shape is the point: a few unaccepted orders ageing at the top of
 * the New lane, a couple packing, a couple boxed and waiting for a rider. A
 * demo where every lane holds one card teaches nothing about pressure.
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

interface FixtureLine {
  productId: string;
  name: string;
  unit: string;
  price: number;
  qty: number;
  lineTotal: number;
}

function linesFor(index: number): FixtureLine[] {
  const random = lcg(0xb0a2d + index * 7919);
  const products = productsFixture();
  const lineCount = 2 + Math.floor(random() * 4);
  const lines: FixtureLine[] = [];
  for (let i = 0; i < lineCount; i += 1) {
    const product = pick(products, random());
    const qty = 1 + Math.floor(random() * 3);
    lines.push({
      productId: product.id,
      name: product.name,
      unit: `${product.unitValue} ${product.unit}`,
      price: product.price,
      qty,
      lineTotal: product.price * qty,
    });
  }
  return lines;
}

function orderRow(plan: { status: OrderStatus; ageMin: number }, index: number): VendorOrder {
  const random = lcg(0xd0d0 + index * 104_729);
  const lines = linesFor(index);
  const itemsSubtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const deliveryFee = itemsSubtotal > 50000 ? 0 : 2900;
  const grandTotal = itemsSubtotal + deliveryFee;
  const commissionAmount = Math.round((itemsSubtotal * COMMISSION_PCT) / 100);
  const cod = random() > 0.55;
  const now = Date.now();
  const placed = now - plan.ageMin * MIN;

  const at = (offsetMin: number, when: boolean): string | null =>
    when ? new Date(placed + offsetMin * MIN).toISOString() : null;

  const reached = (target: OrderStatus): boolean => {
    const order: readonly OrderStatus[] = [
      'PLACED',
      'ACCEPTED',
      'PACKING',
      'READY_FOR_PICKUP',
      'ASSIGNED',
      'PICKED_UP',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ];
    const here = order.indexOf(plan.status);
    const want = order.indexOf(target);
    return here >= 0 && want >= 0 && here >= want;
  };

  const hasRider = reached('ASSIGNED');

  return {
    id: `ord_${String(index + 1).padStart(3, '0')}`,
    orderNo: orderNo(index),
    status: plan.status,
    itemCount: lines.reduce((sum, line) => sum + line.qty, 0),
    itemsSubtotal,
    grandTotal,
    commissionAmount,
    vendorPayout: itemsSubtotal - commissionAmount,
    payment: {
      method: cod ? 'cod' : 'online',
      status: cod ? 'pending' : 'paid',
      refundedAmount: 0,
    },
    customer: {
      id: `usr_${index}`,
      name: pick(CUSTOMERS, random()),
      phone: `98${String(10000000 + Math.floor(random() * 89_999_999))}`,
    },
    deliveryPartner: hasRider
      ? { id: 'dp_001', name: 'Jaspreet Singh', phone: '9876500011' }
      : null,
    placedAt: new Date(placed).toISOString(),
    acceptedAt: at(1, reached('ACCEPTED')),
    readyAt: at(8, reached('READY_FOR_PICKUP')),
    pickedUpAt: at(14, reached('PICKED_UP')),
    deliveredAt: at(28, reached('DELIVERED')),
  };
}

export function ordersFixture(): VendorOrder[] {
  return BOARD_PLAN.map(orderRow);
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

function buildHistory(
  status: OrderStatus,
  placedAt: string | null,
): VendorOrderDetail['statusHistory'] {
  const start = placedAt === null ? Date.now() : Date.parse(placedAt);
  const events: VendorOrderDetail['statusHistory'] = [
    {
      from: null,
      to: 'PLACED',
      byUserId: 'usr_customer',
      byRole: 'customer',
      reason: null,
      at: placedAt,
    },
  ];

  if (status === 'REJECTED' || status === 'CANCELLED') {
    events.push({
      from: 'PLACED',
      to: status,
      byUserId: status === 'REJECTED' ? 'usr_vendor' : 'usr_customer',
      byRole: status === 'REJECTED' ? 'vendor' : 'customer',
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
      byUserId: i <= 3 ? 'usr_vendor' : 'usr_rider',
      byRole: i <= 3 ? 'vendor' : 'delivery',
      reason: null,
      at: new Date(start + i * 6 * MIN).toISOString(),
    });
  }
  return events;
}

export function orderDetailFixture(id: string): VendorOrderDetail {
  const list = ordersFixture();
  const index = Math.max(0, list.findIndex((order) => order.id === id));
  const base = list[index];
  if (!base) throw new Error('fixture: no orders');

  const lines = linesFor(index);
  const itemsSubtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const deliveryFee = itemsSubtotal > 50000 ? 0 : 2900;
  const taxes = 0;
  const discount = 0;
  const grandTotal = itemsSubtotal + deliveryFee + taxes - discount;
  const commissionAmount = Math.round((itemsSubtotal * COMMISSION_PCT) / 100);

  return {
    ...base,
    items: lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      image: null,
      unit: line.unit,
      price: line.price,
      qty: line.qty,
      lineTotal: line.lineTotal,
      fulfilled: true,
    })),
    pricing: {
      itemsSubtotal,
      discount,
      deliveryFee,
      taxes,
      grandTotal,
      commissionPct: COMMISSION_PCT,
      commissionAmount,
      vendorPayout: itemsSubtotal - commissionAmount,
      customerTotal: grandTotal,
    },
    address: {
      label: 'Home',
      line1: 'House 218, Sector 21-A',
      line2: 'Opposite the park',
      city: 'Chandigarh',
      pincode: '160022',
      location: { lat: 30.7281, lng: 76.7794 },
      phone: base.customer.phone ?? '9800000000',
    },
    statusHistory: buildHistory(base.status, base.placedAt),
    cancellation:
      base.status === 'CANCELLED' || base.status === 'REJECTED'
        ? {
            by: base.status === 'REJECTED' ? 'vendor' : 'customer',
            reason: base.status === 'REJECTED' ? 'Out of stock on two lines' : 'Changed my mind',
            at: base.placedAt,
          }
        : null,
    proof: { otpVerifiedAt: base.deliveredAt, photoUrl: null },
  };
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

const EMPTY_STATUS_COUNTS = (): Record<OrderStatus, number> => ({
  PLACED: 0,
  ACCEPTED: 0,
  PACKING: 0,
  READY_FOR_PICKUP: 0,
  ASSIGNED: 0,
  PICKED_UP: 0,
  OUT_FOR_DELIVERY: 0,
  DELIVERED: 0,
  DELIVERY_FAILED: 0,
  REJECTED: 0,
  CANCELLED: 0,
});

export function dashboardFixture(): VendorDashboard {
  const orders = ordersFixture();
  const byStatus = EMPTY_STATUS_COUNTS();
  for (const order of orders) byStatus[order.status] += 1;

  const earning = orders.filter(
    (order) => order.status !== 'CANCELLED' && order.status !== 'REJECTED',
  );
  const gross = earning.reduce((sum, order) => sum + order.grandTotal, 0);
  const itemsSubtotal = earning.reduce((sum, order) => sum + order.itemsSubtotal, 0);
  const commission = earning.reduce((sum, order) => sum + order.commissionAmount, 0);

  const inventory = inventoryFixture();
  const random = lcg(0xdabb1e);
  const now = Date.now();

  const sparkline: DashboardSparkPoint[] = Array.from({ length: 7 }, (_, i) => {
    const at = new Date(now - (6 - i) * DAY);
    const count = 6 + Math.floor(random() * 14);
    return {
      date: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`,
      orders: count,
      revenue: count * (28_000 + Math.floor(random() * 26_000)),
    };
  });

  return {
    vendorId: VENDOR_ID,
    storeName: STORE_NAME,
    isOpen: true,
    status: 'approved',
    rating: 4.6,
    today: startOfLocalDay(new Date()).toISOString(),
    ordersToday: { total: orders.length, byStatus },
    revenueToday: {
      gross,
      itemsSubtotal,
      commission,
      net: itemsSubtotal - commission,
      orderCount: earning.length,
    },
    pendingCount: byStatus.PLACED,
    inFlightCount:
      byStatus.PLACED +
      byStatus.ACCEPTED +
      byStatus.PACKING +
      byStatus.READY_FOR_PICKUP +
      byStatus.ASSIGNED +
      byStatus.PICKED_UP +
      byStatus.OUT_FOR_DELIVERY,
    lowStockCount: inventory.filter((row) => row.isLowStock).length,
    outOfStockCount: inventory.filter((row) => row.isOutOfStock).length,
    sparkline,
  };
}

/* ------------------------------------------------------------------ */
/* Partners                                                            */
/* ------------------------------------------------------------------ */

export function partnersFixture(): VendorPartner[] {
  const now = Date.now();
  return [
    {
      id: 'dp_001',
      userId: 'usr_dp_001',
      vendorId: VENDOR_ID,
      name: 'Jaspreet Singh',
      phone: '9876500011',
      email: null,
      vehicleType: 'motorcycle',
      status: 'active',
      statusReason: null,
      isOnline: true,
      isAvailable: false,
      activeOrderId: 'ord_009',
      completedCount: 428,
      rating: 4.8,
      location: { lat: 30.7331, lng: 76.7649 },
      locationAt: new Date(now - 40_000).toISOString(),
      createdAt: new Date(now - 300 * DAY).toISOString(),
    },
    {
      id: 'dp_002',
      userId: 'usr_dp_002',
      vendorId: VENDOR_ID,
      name: 'Rekha Devi',
      phone: '9876500022',
      email: null,
      vehicleType: 'scooter',
      status: 'active',
      statusReason: null,
      isOnline: true,
      isAvailable: true,
      activeOrderId: null,
      completedCount: 191,
      rating: 4.9,
      location: null,
      locationAt: new Date(now - 3 * MIN).toISOString(),
      createdAt: new Date(now - 120 * DAY).toISOString(),
    },
    {
      id: 'dp_003',
      userId: 'usr_dp_003',
      vendorId: VENDOR_ID,
      name: 'Mohit Kumar',
      phone: '9876500033',
      email: null,
      vehicleType: 'bicycle',
      status: 'pending',
      statusReason: 'Awaiting document check',
      isOnline: false,
      isAvailable: false,
      activeOrderId: null,
      completedCount: 62,
      rating: 4.4,
      location: null,
      locationAt: new Date(now - 190 * MIN).toISOString(),
      createdAt: new Date(now - 20 * DAY).toISOString(),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

function rangeOf(params: QueryParams): { from: string; to: string } {
  const from = params['from'];
  const to = params['to'];
  const now = Date.now();
  return {
    from: typeof from === 'string' ? from : new Date(now - 30 * DAY).toISOString(),
    to: typeof to === 'string' ? to : new Date(now).toISOString(),
  };
}

function groupByOf(params: QueryParams): SalesGroupBy {
  const value = params['groupBy'];
  return value === 'week' || value === 'month' ? value : 'day';
}

export function salesFixture(params: QueryParams): SalesReport {
  const range = rangeOf(params);
  const groupBy = groupByOf(params);
  const random = lcg(0xf00d);

  const spanDays = Math.max(
    1,
    Math.min(90, Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY) + 1),
  );
  const count = groupBy === 'day' ? spanDays : groupBy === 'week' ? Math.ceil(spanDays / 7) : 1;
  const stepMs = groupBy === 'day' ? DAY : groupBy === 'week' ? 7 * DAY : 30 * DAY;

  const buckets: SalesBucket[] = Array.from({ length: count }, (_, i) => {
    const start = new Date(Date.parse(range.from) + i * stepMs);
    const orders = 4 + Math.floor(random() * 14);
    const gross = orders * (28_000 + Math.floor(random() * 26_000));
    const commission = Math.round((gross * COMMISSION_PCT) / 100);
    return {
      period: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      periodStart: start.toISOString(),
      orders,
      itemsSold: orders * (2 + Math.floor(random() * 4)),
      gross,
      commission,
      net: gross - commission,
      aov: Math.round(gross / orders),
    };
  });

  const totals = buckets.reduce(
    (acc, bucket) => ({
      orders: acc.orders + bucket.orders,
      itemsSold: acc.itemsSold + bucket.itemsSold,
      gross: acc.gross + bucket.gross,
      commission: acc.commission + bucket.commission,
      net: acc.net + bucket.net,
      aov: 0,
    }),
    { orders: 0, itemsSold: 0, gross: 0, commission: 0, net: 0, aov: 0 },
  );

  return {
    range,
    groupBy,
    buckets,
    totals: {
      ...totals,
      aov: totals.orders === 0 ? 0 : Math.round(totals.gross / totals.orders),
    },
  };
}

export function earningsFixture(params: QueryParams): EarningsSummary {
  const sales = salesFixture(params);
  const gross = sales.totals.gross;
  const commission = sales.totals.commission;
  const refunds = Math.round(gross * 0.011);

  return {
    range: sales.range,
    gross,
    commission,
    refunds,
    net: gross - commission - refunds,
    orderCount: sales.totals.orders,
    payoutPending: Math.round((gross - commission - refunds) * 0.4),
    lastSettlement: {
      id: 'set_003',
      periodStart: new Date(Date.now() - 14 * DAY).toISOString(),
      periodEnd: new Date(Date.now() - 7 * DAY).toISOString(),
      netPayable: Math.round((gross - commission - refunds) * 0.6),
      status: 'paid',
      paidAt: new Date(Date.now() - 6 * DAY).toISOString(),
    },
  };
}

export function ledgerFixture(): LedgerEntryRow[] {
  const rows: LedgerEntryRow[] = [];
  ordersFixture()
    .filter((order) => order.status === 'DELIVERED')
    .forEach((order, i) => {
      rows.push({
        id: `led_${i}_sale`,
        orderId: order.id,
        type: 'sale',
        amount: order.itemsSubtotal,
        note: null,
        settlementId: i > 1 ? 'set_002' : null,
        at: order.deliveredAt,
      });
      rows.push({
        id: `led_${i}_comm`,
        orderId: order.id,
        type: 'commission',
        amount: -order.commissionAmount,
        note: `${COMMISSION_PCT}% platform commission`,
        settlementId: i > 1 ? 'set_002' : null,
        at: order.deliveredAt,
      });
    });
  rows.push({
    id: 'led_payout',
    orderId: null,
    type: 'payout',
    amount: -120_000,
    note: 'Weekly settlement',
    settlementId: 'set_002',
    at: new Date(Date.now() - 2 * DAY).toISOString(),
  });
  return rows;
}

export function settlementsFixture(): SettlementRow[] {
  const random = lcg(0x5e771e);
  const now = Date.now();
  return [0, 1, 2].map((i) => {
    const grossSales = 400_000 + Math.floor(random() * 400_000);
    const totalCommission = Math.round((grossSales * COMMISSION_PCT) / 100);
    const refunds = Math.round(grossSales * 0.01);
    return {
      id: `set_00${3 - i}`,
      periodStart: new Date(now - (i + 1) * 7 * DAY).toISOString(),
      periodEnd: new Date(now - i * 7 * DAY).toISOString(),
      grossSales,
      totalCommission,
      refunds,
      netPayable: grossSales - totalCommission - refunds,
      orderCount: 30 + Math.floor(random() * 40),
      status: i === 0 ? 'pending' : i === 1 ? 'processing' : 'paid',
      paidAt: i === 2 ? new Date(now - 12 * DAY).toISOString() : null,
      reference: i === 2 ? 'UTR-2026-0918-88123' : null,
      failureReason: null,
    };
  });
}

export function topProductsFixture(params: QueryParams): TopProductsReport {
  const random = lcg(0x70b);
  const limitRaw = Number(params['limit'] ?? 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, limitRaw) : 10;

  return {
    range: rangeOf(params),
    products: productsFixture()
      .slice(0, limit)
      .map((product, i) => {
        const unitsSold = 180 - i * 22 + Math.floor(random() * 18);
        return {
          productId: product.id,
          name: product.name,
          unitsSold,
          revenue: unitsSold * product.price,
          orders: Math.max(1, Math.round(unitsSold / 3)),
        };
      }),
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

function matches(haystack: Array<string | null>, needle: string): boolean {
  const term = needle.trim().toLowerCase();
  if (term === '') return true;
  return haystack.some((value) => (value ?? '').toLowerCase().includes(term));
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
  if (path === '/vendor/dashboard') return dashboardFixture();

  /* ---- orders ---- */
  if (path === '/vendor/orders') {
    let rows = ordersFixture();
    const status = params['status'];
    if (typeof status === 'string' && status !== '') {
      rows = rows.filter((order) => order.status === status);
    }
    const q = params['q'];
    if (typeof q === 'string' && q.trim() !== '') {
      rows = rows.filter((order) => matches([order.orderNo, order.customer.name], q));
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
      rows = rows.filter((product) => matches([product.name, product.brand, product.sku], q));
    }
    const category = params['categoryId'];
    if (typeof category === 'string' && category !== '') {
      rows = rows.filter((product) => product.categoryId === category);
    }
    const active = params['isActive'];
    if (active === 'true' || active === true) rows = rows.filter((product) => product.isActive);
    if (active === 'false' || active === false) rows = rows.filter((product) => !product.isActive);
    if (params['lowStock'] === 'true' || params['lowStock'] === true) {
      rows = rows.filter((product) => product.isLowStock);
    }
    return page(rows, params);
  }

  const productDetail = /^\/vendor\/products\/([^/]+)$/.exec(path);
  if (productDetail?.[1]) {
    return productsFixture().find((product) => product.id === productDetail[1]) ?? null;
  }

  /* ---- inventory ---- */
  if (path === '/vendor/inventory') {
    let rows = inventoryFixture();
    const q = params['q'];
    if (typeof q === 'string' && q.trim() !== '') {
      rows = rows.filter((row) => matches([row.name, row.sku, row.brand], q));
    }
    if (params['lowStock'] === 'true' || params['lowStock'] === true) {
      rows = rows.filter((row) => row.isLowStock);
    }
    if (params['outOfStock'] === 'true' || params['outOfStock'] === true) {
      rows = rows.filter((row) => row.isOutOfStock);
    }
    return page(rows, params);
  }

  const inventoryDetail = /^\/vendor\/inventory\/([^/]+)$/.exec(path);
  if (inventoryDetail?.[1]) {
    return inventoryFixture().find((row) => row.productId === inventoryDetail[1]) ?? null;
  }

  /* ---- partners ---- */
  if (path === '/vendor/delivery-partners') return page(partnersFixture(), params);

  /* ---- money ---- */
  if (path === '/vendor/earnings') return earningsFixture(params);
  if (path === '/vendor/earnings/ledger') return page(ledgerFixture(), params);
  if (path === '/vendor/settlements') return page(settlementsFixture(), params);
  if (path === '/vendor/reports/sales') return salesFixture(params);
  if (path === '/vendor/reports/top-products') return topProductsFixture(params);

  return null;
}
