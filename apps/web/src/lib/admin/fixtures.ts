/**
 * SAMPLE DATA — NOT REAL NUMBERS.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The `/admin/*` endpoints are being built in parallel with this console. Every
 * page here calls the real endpoint through `useAdminQuery`. When that call
 * fails — 404 because the route is not merged yet, or a network error because
 * the API is not running — the hook falls back to the fixture below **and sets
 * `isFixture`**, which every page renders as a loud amber banner.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A fixture number must NEVER be presentable as a real one. The banner is not
 * optional politeness, it is the contract that makes this file safe to ship:
 * the moment a screen could be screenshotted and mistaken for production data,
 * this stops being a development aid and starts being a lie told to whoever is
 * reading the screen.
 *
 * Delete this file the day every endpoint is live. Nothing outside
 * `useAdminQuery` may import it.
 *
 * Every value is produced by a SEEDED generator, so the same path always yields
 * the same numbers: a server render and the first client render agree (no
 * hydration mismatch) and a reviewer's screenshots do not shift between loads.
 */

import type {
  AnalyticsAisleRow,
  AnalyticsOverview,
  AnalyticsSeriesPoint,
  AnalyticsTopProduct,
  AnalyticsTopVendor,
} from './overview-adapter';
import type {
  AdminNotification,
  OrderDetail,
  OrderListRow,
  OrderStatus,
  OrdersByStatusSlice,
  OverviewResponse,
  Paginated,
  RecentOrder,
  TeamMember,
  VendorDetail,
  VendorListRow,
  VendorProductRow,
} from './types';
import type { AisleKey } from '@mandi/design-system';
import { resolveOpsFixture } from './ops-fixtures';

/* ------------------------------------------------------------------ */
/* Deterministic pseudo-randomness                                     */
/* ------------------------------------------------------------------ */

/** mulberry32 — tiny, fast, and identical on every machine. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  const item = list[Math.floor(rng() * list.length)];
  // noUncheckedIndexedAccess: the modulo guarantees a hit, but prove it.
  if (item === undefined) throw new Error('fixtures: empty pick list');
  return item;
}

/**
 * The clock is frozen. `Date.now()` would make every fixture render differ
 * between the server pass and the client pass, and "3 minutes ago" would creep
 * while you read the page. Offsets are computed from this instant instead.
 */
const NOW = Date.parse('2026-09-24T18:40:00+05:30');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const STORE_NAMES = [
  'Ganesh Kirana Stores',
  'Sri Lakshmi Fresh',
  'Nashik Daily Mandi',
  'Bandra Bread Co.',
  'Koramangala Dairy',
  'Anand Provision Mart',
  'Chembur Farm Basket',
  'Pune Pantry',
  'Indiranagar Greens',
  'Malleswaram Supermart',
  'Adyar Organics',
  'Saket Super Bazaar',
] as const;

const CITIES = [
  'Bengaluru',
  'Mumbai',
  'Pune',
  'Chennai',
  'Hyderabad',
  'Delhi',
  'Nashik',
  'Kochi',
] as const;

const OWNERS = [
  'Ramesh Iyer',
  'Sunita Kulkarni',
  'Abdul Rahman',
  'Priya Nair',
  'Vikram Shetty',
  'Meera Joshi',
  'Harpreet Singh',
  'Lakshmi Menon',
  'Farhan Qureshi',
  'Ananya Bose',
  'Rajat Malhotra',
  'Divya Krishnan',
] as const;

const CUSTOMERS = [
  'Arjun Desai',
  'Kavya Reddy',
  'Imran Shaikh',
  'Nandita Rao',
  'Siddharth Jain',
  'Rhea Fernandes',
  'Manish Gupta',
  'Tara Pillai',
  'Yash Chauhan',
  'Zoya Ansari',
] as const;

const RIDERS = [
  'Sanjay Kamble',
  'Irfan Ali',
  'Deepak Yadav',
  'Rakesh Pawar',
  'Naveen Kumar',
] as const;

const AISLE_KEYS_LOCAL: readonly AisleKey[] = [
  'fruits',
  'vegetables',
  'dairy',
  'bakery',
  'beverages',
  'snacks',
  'staples',
  'frozen',
];


const PRODUCTS: ReadonlyArray<{ name: string; aisleKey: AisleKey; pricePaise: number }> = [
  { name: 'Tomato Hybrid · 1 kg', aisleKey: 'vegetables', pricePaise: 3400 },
  { name: 'Onion Nashik · 1 kg', aisleKey: 'vegetables', pricePaise: 3800 },
  { name: 'Amul Taaza Milk · 500 ml', aisleKey: 'dairy', pricePaise: 2800 },
  { name: 'Farm Eggs · 6 pc', aisleKey: 'dairy', pricePaise: 5400 },
  { name: 'Atta Bread · 400 g', aisleKey: 'bakery', pricePaise: 4500 },
  { name: 'Sona Masoori Rice · 5 kg', aisleKey: 'staples', pricePaise: 42000 },
  { name: 'Chakki Atta · 5 kg', aisleKey: 'staples', pricePaise: 26500 },
  { name: 'Alphonso Mango · 1 kg', aisleKey: 'fruits', pricePaise: 42900 },
  { name: 'Shimla Apple · 4 pc', aisleKey: 'fruits', pricePaise: 19900 },
  { name: 'Tender Coconut · 1 pc', aisleKey: 'beverages', pricePaise: 5500 },
  { name: 'Ratlami Sev · 200 g', aisleKey: 'snacks', pricePaise: 7500 },
  { name: 'Green Peas · 500 g', aisleKey: 'frozen', pricePaise: 9500 },
  { name: 'Paneer Fresh · 200 g', aisleKey: 'dairy', pricePaise: 9500 },
  { name: 'Coriander Bunch · 100 g', aisleKey: 'vegetables', pricePaise: 1500 },
  { name: 'Banana Chips · 200 g', aisleKey: 'snacks', pricePaise: 9000 },
];

const ORDER_STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PACKING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'REJECTED',
  'CANCELLED',
];

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */


function buildOverview(): AnalyticsOverview {
  const rng = seeded(7);

  const needsAttention: OverviewResponse['needsAttention'] = [
    {
      id: 'na-1',
      kind: 'vendor_approval',
      title: 'Vendors awaiting approval',
      detail: 'Oldest has been pending 4 days',
      tone: 'warn',
      count: 6,
      href: '/admin/vendors?status=pending',
      at: ago(4 * DAY),
    },
    {
      id: 'na-2',
      kind: 'failed_delivery',
      title: 'Failed deliveries today',
      detail: 'Each needs a retry or a refund decision',
      tone: 'crit',
      count: 3,
      href: '/admin/orders?status=DELIVERY_FAILED',
      at: ago(2 * HOUR),
    },
    {
      id: 'na-3',
      kind: 'low_stock',
      title: 'Products below low-stock threshold',
      detail: 'Across 11 vendors — staples worst hit',
      tone: 'warn',
      count: 42,
      href: '/admin/catalog?filter=low-stock',
      at: ago(40 * MINUTE),
    },
    {
      id: 'na-4',
      kind: 'unpaid_settlement',
      title: 'Settlements unpaid past cycle',
      detail: 'Monday cycle closed; 2 payouts did not clear',
      tone: 'crit',
      count: 2,
      href: '/admin/settlements?status=failed',
      at: ago(1 * DAY),
    },
  ];

  const recentOrders: RecentOrder[] = Array.from({ length: 8 }, (_, i) => ({
    id: `ord-r-${i}`,
    orderNo: `MND-20260924-${String(1841 - i).padStart(4, '0')}`,
    vendorName: pick(rng, STORE_NAMES),
    customerName: pick(rng, CUSTOMERS),
    status: pick(rng, ORDER_STATUSES),
    totalPaise: Math.round((240 + rng() * 2600) * 100),
    placedAt: ago(i * 11 * MINUTE + 3 * MINUTE),
  }));

  // Shaped like the ENDPOINT, not like the screen. `overview-adapter.ts`
  // composes the screen out of three responses, and a fixture that skipped
  // that step would be testing a shape the API never sends — which is
  // precisely how this page came to be written against data that did not
  // exist. `needsAttention` and `recentOrders` are served by the fixtures
  // for /admin/ops/summary and /admin/orders instead.
  void needsAttention;
  void recentOrders;

  const metric = (value: number, deltaPct: number | null) => ({
    value,
    previous: deltaPct === null ? 0 : Math.round(value / (1 + deltaPct / 100)),
    deltaPct,
  });

  return {
    range: { from: new Date(NOW - 30 * DAY).toISOString(), to: new Date(NOW).toISOString() },
    previousRange: {
      from: new Date(NOW - 60 * DAY).toISOString(),
      to: new Date(NOW - 30 * DAY).toISOString(),
    },
    gmv: metric(184_250_00 * 7, 12.4),
    orderCount: metric(8_412, 9.1),
    aov: metric(153_400, 3.2),
    activeVendors: metric(214, 4.7),
    pendingVendors: metric(6, -18.0),
    customerCount: metric(12_904, 6.3),
    riderCount: metric(311, 2.1),
    onlineRiders: metric(87, -2.4),
    cancellationRate: metric(3.8, -0.6),
    codShare: metric(41.2, 1.9),
  };
}

/** `{ date, value }`, one metric per call — exactly what the API returns. */
function buildTimeseries(days: number): AnalyticsSeriesPoint[] {
  const rng = seeded(days === 7 ? 101 : days === 90 ? 103 : 102);
  const out: AnalyticsSeriesPoint[] = [];
  let gmv = 1_150_000;
  let orders = 268;

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(NOW - i * DAY);
    // A weekend lift, because a flat synthetic line reads as fake immediately.
    const weekendLift = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 1.18 : 1;
    gmv = Math.max(600_000, gmv * (0.985 + rng() * 0.035));
    orders = Math.max(120, orders * (0.985 + rng() * 0.035));

    const iso = date.toISOString().slice(0, 10);
    // One metric per point, like the endpoint. `orders` is still walked so
    // the GMV curve keeps the shape a real marketplace has.
    void orders;
    out.push({ date: iso, value: Math.round(gmv * weekendLift) });
  }
  return out;
}

function buildOrdersByStatus(): OrdersByStatusSlice[] {
  return [
    { status: 'DELIVERED', count: 6421 },
    { status: 'OUT_FOR_DELIVERY', count: 412 },
    { status: 'PACKING', count: 286 },
    { status: 'PLACED', count: 198 },
    { status: 'ACCEPTED', count: 174 },
    { status: 'READY_FOR_PICKUP', count: 121 },
    { status: 'CANCELLED', count: 318 },
    { status: 'DELIVERY_FAILED', count: 62 },
  ];
}

function buildSalesByAisle(): AnalyticsAisleRow[] {
  const rng = seeded(31);
  return AISLE_KEYS_LOCAL.map((key, i) => ({
    aisleKey: key,
    gmv: Math.round((2_400_000 - i * 180_000) * (0.75 + rng() * 0.6)),
    orderCount: Math.round((1400 - i * 90) * (0.7 + rng() * 0.7)),
  }));
}

/** The endpoint's shape — `overview-adapter.ts` turns it into table rows. */
function buildTopVendors(): AnalyticsTopVendor[] {
  const rng = seeded(41);
  return STORE_NAMES.slice(0, 8).map((storeName, i) => ({
    vendorId: `ven-${i + 1}`,
    storeName,
    city: pick(rng, CITIES),
    status: 'approved',
    orderCount: Math.round((820 - i * 62) * (0.85 + rng() * 0.3)),
    gmv: Math.round((3_100_000 - i * 260_000) * (0.85 + rng() * 0.3)),
  }));
}

function buildTopProducts(): AnalyticsTopProduct[] {
  const rng = seeded(43);
  return PRODUCTS.slice(0, 8).map((p, i) => ({
    productId: `prd-${i + 1}`,
    name: p.name,
    image: null,
    // Points INTO the vendor fixture above, so the join the adapter does
    // against the real API has something to find here too.
    vendorId: `ven-${(i % 8) + 1}`,
    unitsSold: Math.round((2400 - i * 180) * (0.8 + rng() * 0.4)),
    gmv: Math.round(p.pricePaise * (2400 - i * 180) * (0.8 + rng() * 0.4)),
  }));
}

function buildVendors(): VendorListRow[] {
  const rng = seeded(53);
  return Array.from({ length: 24 }, (_, i) => {
    const storeName = STORE_NAMES[i % STORE_NAMES.length] ?? 'Mandi Store';
    const suffix = i >= STORE_NAMES.length ? ` ${Math.floor(i / STORE_NAMES.length) + 1}` : '';
    const status: VendorListRow['status'] =
      i % 9 === 0 ? 'pending' : i % 13 === 0 ? 'suspended' : 'approved';
    return {
      id: `ven-${i + 1}`,
      storeName: `${storeName}${suffix}`,
      slug: `${storeName.toLowerCase().replace(/[^a-z]+/g, '-')}${suffix.trim() && `-${suffix.trim()}`}`,
      ownerName: OWNERS[i % OWNERS.length] ?? 'Owner',
      phone: `+91 9${String(800000000 + i * 137731).slice(0, 9)}`,
      city: pick(rng, CITIES),
      status,
      isOpen: status === 'approved' && rng() > 0.25,
      commissionPct: Math.round((8 + rng() * 9) * 10) / 10,
      orders: status === 'pending' ? 0 : Math.round(80 + rng() * 780),
      gmvPaise: status === 'pending' ? 0 : Math.round((90_000 + rng() * 3_000_000) / 100) * 100,
      rating: Math.round((3.6 + rng() * 1.3) * 10) / 10,
      createdAt: ago(Math.round(rng() * 420) * DAY),
    };
  });
}

const VENDORS = buildVendors();

function buildVendorProducts(seed: number): VendorProductRow[] {
  const rng = seeded(seed);
  return PRODUCTS.slice(0, 10).map((p, i) => {
    const stock = Math.round(rng() * 90);
    return {
      id: `prd-${seed}-${i}`,
      name: p.name,
      aisleKey: p.aisleKey,
      sku: `SKU-${String(seed * 100 + i).padStart(6, '0')}`,
      pricePaise: p.pricePaise,
      mrpPaise: Math.round(p.pricePaise * 1.18),
      stock,
      lowStockThreshold: 12,
      isActive: rng() > 0.12,
    };
  });
}

function buildVendorDetail(id: string): VendorDetail {
  const base = VENDORS.find((v) => v.id === id) ?? VENDORS[0];
  if (!base) throw new Error('fixtures: no vendors');
  const numeric = Number.parseInt(id.replace(/\D+/g, ''), 10) || 1;
  const rng = seeded(numeric * 17);

  const gross = base.gmvPaise;
  const commission = Math.round((gross * base.commissionPct) / 100);
  const refunds = Math.round(gross * 0.017);

  return {
    ...base,
    description:
      'Family-run provision store, three generations on the same corner. Stocks a full staples range, daily vegetables from the local mandi, and a small cold case.',
    address: {
      line1: `${12 + (numeric % 60)}, 4th Cross, ${base.city} East`,
      city: base.city,
      state: base.city === 'Mumbai' || base.city === 'Pune' || base.city === 'Nashik'
        ? 'Maharashtra'
        : 'Karnataka',
      pincode: String(560000 + (numeric * 7) % 900),
    },
    location: {
      coordinates: [
        Math.round((77.5 + rng() * 0.35) * 1e6) / 1e6,
        Math.round((12.9 + rng() * 0.3) * 1e6) / 1e6,
      ],
    },
    serviceRadiusKm: 5,
    codEnabled: rng() > 0.2,
    codMaxAmountPaise: 200_000,
    openingHours: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ].map((day) => ({
      day,
      open: day === 'Sunday' ? '08:00' : '07:00',
      close: day === 'Sunday' ? '13:00' : '22:00',
    })),
    earnings: {
      grossPaise: gross,
      commissionPaise: commission,
      refundsPaise: refunds,
      netPayablePaise: gross - commission - refunds,
      lastSettledAt: base.status === 'approved' ? ago(3 * DAY) : null,
    },
    recentOrders: Array.from({ length: 6 }, (_, i) => ({
      id: `ord-${id}-${i}`,
      orderNo: `MND-20260924-${String(1720 + numeric * 3 + i).padStart(4, '0')}`,
      vendorName: base.storeName,
      customerName: pick(rng, CUSTOMERS),
      status: pick(rng, ORDER_STATUSES),
      totalPaise: Math.round((260 + rng() * 2200) * 100),
      placedAt: ago(i * 3 * HOUR + HOUR),
    })),
    products: buildVendorProducts(numeric),
  };
}

function buildOrders(): OrderListRow[] {
  const rng = seeded(61);
  return Array.from({ length: 40 }, (_, i) => {
    const vendor = VENDORS[i % VENDORS.length];
    const status = pick(rng, ORDER_STATUSES);
    const method: 'online' | 'cod' = rng() > 0.55 ? 'cod' : 'online';
    return {
      id: `ord-${i + 1}`,
      orderNo: `MND-20260924-${String(1841 - i).padStart(4, '0')}`,
      vendorId: vendor?.id ?? 'ven-1',
      vendorName: vendor?.storeName ?? 'Mandi Store',
      customerName: pick(rng, CUSTOMERS),
      city: vendor?.city ?? 'Bengaluru',
      status,
      paymentMethod: method,
      paymentStatus:
        status === 'DELIVERED'
          ? method === 'cod'
            ? 'paid'
            : 'paid'
          : status === 'CANCELLED' || status === 'REJECTED'
            ? 'refunded'
            : method === 'cod'
              ? 'pending'
              : 'authorized',
      itemCount: 2 + Math.floor(rng() * 12),
      totalPaise: Math.round((240 + rng() * 2800) * 100),
      placedAt: ago(i * 17 * MINUTE + 4 * MINUTE),
    };
  });
}

const ORDERS = buildOrders();

/** The happy path, trimmed to wherever the order actually got to. */
const STATUS_CHAIN: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PACKING',
  'READY_FOR_PICKUP',
  'ASSIGNED',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

function buildOrderDetail(id: string): OrderDetail {
  const base = ORDERS.find((o) => o.id === id) ?? ORDERS[0];
  if (!base) throw new Error('fixtures: no orders');
  const numeric = Number.parseInt(id.replace(/\D+/g, ''), 10) || 1;
  const rng = seeded(numeric * 29);

  const terminalIndex = STATUS_CHAIN.indexOf(base.status);
  const chain: OrderStatus[] =
    terminalIndex >= 0
      ? STATUS_CHAIN.slice(0, terminalIndex + 1)
      : base.status === 'REJECTED'
        ? ['PLACED', 'REJECTED']
        : base.status === 'CANCELLED'
          ? ['PLACED', 'ACCEPTED', 'CANCELLED']
          : ['PLACED', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'];

  const actorFor = (status: OrderStatus): { byName: string; byRole: OrderDetail['statusHistory'][number]['byRole'] } => {
    switch (status) {
      case 'PLACED':
        return { byName: base.customerName, byRole: 'customer' };
      case 'ACCEPTED':
      case 'PACKING':
      case 'READY_FOR_PICKUP':
      case 'REJECTED':
        return { byName: base.vendorName, byRole: 'vendor' };
      case 'ASSIGNED':
        return { byName: 'Assignment worker', byRole: 'system' };
      case 'CANCELLED':
        return { byName: 'Priya Nair (ops)', byRole: 'admin' };
      default:
        return { byName: pick(rng, RIDERS), byRole: 'delivery' };
    }
  };

  const placedAtMs = Date.parse(base.placedAt);
  const statusHistory = chain.map((to, i) => {
    const actor = actorFor(to);
    return {
      from: i === 0 ? null : (chain[i - 1] ?? null),
      to,
      byName: actor.byName,
      byRole: actor.byRole,
      reason:
        to === 'CANCELLED'
          ? 'Customer called — wrong delivery window'
          : to === 'REJECTED'
            ? 'Two staple lines out of stock'
            : to === 'DELIVERY_FAILED'
              ? 'Nobody at the door after 3 attempts'
              : undefined,
      at: new Date(placedAtMs + i * (4 + Math.floor(rng() * 9)) * MINUTE).toISOString(),
    };
  });

  const lineCount = Math.max(2, Math.min(base.itemCount, 7));
  const items = Array.from({ length: lineCount }, (_, i) => {
    const p = PRODUCTS[(numeric * 3 + i) % PRODUCTS.length];
    if (!p) throw new Error('fixtures: product table empty');
    const qty = 1 + Math.floor(rng() * 3);
    return {
      productId: `prd-${numeric}-${i}`,
      name: p.name,
      aisleKey: p.aisleKey,
      unit: p.name.split('·')[1]?.trim() ?? '1 pc',
      qty,
      pricePaise: p.pricePaise,
      lineTotalPaise: p.pricePaise * qty,
      fulfilled: rng() > 0.08,
    };
  });

  const itemsSubtotalPaise = items.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const discountPaise = rng() > 0.6 ? Math.round(itemsSubtotalPaise * 0.08) : 0;
  const deliveryFeePaise = 2900;
  const taxesPaise = Math.round((itemsSubtotalPaise - discountPaise) * 0.05);
  const grandTotalPaise = itemsSubtotalPaise - discountPaise + deliveryFeePaise + taxesPaise;
  const commissionPct = 12;
  const commissionAmountPaise = Math.round((itemsSubtotalPaise * commissionPct) / 100);

  const hasRider = chain.includes('ASSIGNED');

  return {
    ...base,
    totalPaise: grandTotalPaise,
    itemCount: items.length,
    statusHistory,
    items,
    pricing: {
      itemsSubtotalPaise,
      discountPaise,
      deliveryFeePaise,
      taxesPaise,
      grandTotalPaise,
      commissionPct,
      commissionAmountPaise,
      // Delivery fee is platform revenue, not the vendor's (plan §1, decision 5).
      vendorPayoutPaise: itemsSubtotalPaise - commissionAmountPaise,
    },
    payment: {
      method: base.paymentMethod,
      status: base.paymentStatus,
      provider: 'razorpay',
      providerOrderId: base.paymentMethod === 'online' ? `order_QxK${numeric}9fJ2aLm` : null,
      providerPaymentId:
        base.paymentMethod === 'online' && base.paymentStatus === 'paid'
          ? `pay_QxK${numeric}0bT7uYz`
          : null,
      paidAt: base.paymentStatus === 'paid' ? ago(numeric * 13 * MINUTE) : null,
      refundedAmountPaise: base.paymentStatus === 'refunded' ? grandTotalPaise : 0,
    },
    address: {
      label: pick(rng, ['Home', 'Work', 'Mum'] as const),
      line1: `${201 + (numeric % 40)}, Sanjeevini Apartments`,
      line2: '14th Main, HSR Layout Sector 3',
      city: base.city,
      pincode: String(560000 + (numeric * 11) % 900),
      phone: `+91 9${String(700000000 + numeric * 913571).slice(0, 9)}`,
    },
    rider: hasRider
      ? {
          id: `rid-${numeric}`,
          name: pick(rng, RIDERS),
          phone: `+91 8${String(600000000 + numeric * 771).slice(0, 9)}`,
          vehicleType: pick(rng, ['Scooter', 'Motorcycle', 'Bicycle'] as const),
          assignedAt: ago(numeric * 9 * MINUTE),
          completedCount: 120 + Math.floor(rng() * 900),
          rating: Math.round((4.2 + rng() * 0.7) * 10) / 10,
        }
      : null,
    cancellation:
      base.status === 'CANCELLED'
        ? { by: 'Priya Nair (ops)', reason: 'Customer called — wrong delivery window', at: ago(numeric * 7 * MINUTE) }
        : null,
  };
}

function buildTeam(): TeamMember[] {
  return [
    {
      id: 'adm-system',
      name: 'Mandi System',
      email: 'system@mandi.internal',
      phone: '—',
      level: 'SUPER_ADMIN',
      status: 'active',
      isSystem: true,
      lastLoginAt: null,
      createdAt: ago(720 * DAY),
    },
    {
      id: 'adm-jobs',
      name: 'Settlement Worker',
      email: 'jobs@mandi.internal',
      phone: '—',
      level: 'ADMIN',
      status: 'active',
      isSystem: true,
      lastLoginAt: ago(20 * MINUTE),
      createdAt: ago(720 * DAY),
    },
    {
      id: 'adm-1',
      name: 'Priya Nair',
      email: 'priya.nair@mandi.app',
      phone: '+91 98450 11234',
      level: 'SUPER_ADMIN',
      status: 'active',
      isSystem: false,
      lastLoginAt: ago(35 * MINUTE),
      createdAt: ago(410 * DAY),
    },
    {
      id: 'adm-2',
      name: 'Vikram Shetty',
      email: 'vikram.shetty@mandi.app',
      phone: '+91 99001 44872',
      level: 'ADMIN',
      status: 'active',
      isSystem: false,
      lastLoginAt: ago(3 * HOUR),
      createdAt: ago(290 * DAY),
    },
    {
      id: 'adm-3',
      name: 'Meera Joshi',
      email: 'meera.joshi@mandi.app',
      phone: '+91 97400 20991',
      level: 'ADMIN',
      status: 'active',
      isSystem: false,
      lastLoginAt: ago(2 * DAY),
      createdAt: ago(150 * DAY),
    },
    {
      id: 'adm-4',
      name: 'Harpreet Singh',
      email: 'harpreet.singh@mandi.app',
      phone: '+91 98110 77351',
      level: 'ADMIN',
      status: 'suspended',
      isSystem: false,
      lastLoginAt: ago(46 * DAY),
      createdAt: ago(320 * DAY),
    },
  ];
}

function buildNotifications(): AdminNotification[] {
  return [
    {
      id: 'ntf-1',
      type: 'vendor_pending',
      title: '6 vendors awaiting approval',
      body: 'Sri Lakshmi Fresh has been pending 4 days.',
      href: '/admin/vendors?status=pending',
      readAt: null,
      createdAt: ago(25 * MINUTE),
    },
    {
      id: 'ntf-2',
      type: 'delivery_failed',
      title: 'Delivery failed · MND-20260924-1836',
      body: 'Third attempt. Needs a refund decision.',
      href: '/admin/orders/ord-6',
      readAt: null,
      createdAt: ago(2 * HOUR),
    },
    {
      id: 'ntf-3',
      type: 'settlement_failed',
      title: '2 settlement payouts did not clear',
      body: 'Monday cycle · bank rejected the beneficiary.',
      href: '/admin/settlements?status=failed',
      readAt: null,
      createdAt: ago(20 * HOUR),
    },
    {
      id: 'ntf-4',
      type: 'catalog',
      title: '42 products below low-stock threshold',
      body: 'Staples worst hit across 11 vendors.',
      href: '/admin/catalog?filter=low-stock',
      readAt: ago(30 * HOUR),
      createdAt: ago(31 * HOUR),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Pagination + filtering, so a fixture behaves like a real endpoint   */
/* ------------------------------------------------------------------ */

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

function paginate<T>(rows: T[], params: QueryParams): Paginated<T> {
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const limit = Math.max(1, Number(params.limit ?? 20) || 20);
  const start = (page - 1) * limit;
  return {
    data: rows.slice(start, start + limit),
    meta: {
      page,
      limit,
      total: rows.length,
      pages: Math.max(1, Math.ceil(rows.length / limit)),
    },
  };
}

function sortRows<T>(rows: T[], sort: string | undefined): T[] {
  if (!sort) return rows;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  return [...rows].sort((a, b) => {
    // `T` is an interface here, which has no index signature under strict mode.
    const left = (a as Record<string, unknown>)[key];
    const right = (b as Record<string, unknown>)[key];
    let cmp = 0;
    if (typeof left === 'number' && typeof right === 'number') cmp = left - right;
    else cmp = String(left ?? '').localeCompare(String(right ?? ''));
    return desc ? -cmp : cmp;
  });
}

function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/* ------------------------------------------------------------------ */
/* The resolver                                                        */
/* ------------------------------------------------------------------ */

/**
 * Maps an API path to sample data, or returns `null` when there is no fixture
 * for it — in which case `useAdminQuery` surfaces the real error rather than
 * inventing something. A missing fixture must look like a missing endpoint.
 */
/** Read the fixture's span back out of the ISO window the caller sent. */
function daysBetween(from: unknown, to: unknown): number {
  const start = Date.parse(String(from ?? ''));
  const end = Date.parse(String(to ?? ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 30;
  const days = Math.round((end - start) / (24 * 60 * 60 * 1000));
  return days === 7 || days === 90 ? days : 30;
}

export function resolveFixture(path: string, params: QueryParams = {}): unknown | null {
  const clean = path.split('?')[0] ?? path;

  /* ---- analytics ---- */
  if (clean === '/admin/analytics/overview') return buildOverview();

  if (clean === '/admin/analytics/timeseries') {
    // The window arrives as `from`/`to`, which is what the API takes. This
    // used to read `params.days`, and when the caller switched to a real
    // window it quietly fell back to 30 for every range — the 7d and 90d
    // buttons would have moved the label and not the chart.
    return buildTimeseries(daysBetween(params.from, params.to));
  }

  if (clean === '/admin/analytics/orders-by-status') return buildOrdersByStatus();
  if (clean === '/admin/analytics/sales-by-aisle') return buildSalesByAisle();
  if (clean === '/admin/analytics/top-vendors') return buildTopVendors();
  if (clean === '/admin/analytics/top-products') return buildTopProducts();

  /* ---- notifications ---- */
  if (clean === '/notifications' || clean === '/admin/notifications') {
    return buildNotifications();
  }

  /* ---- vendors ---- */
  if (clean === '/admin/vendors') {
    const q = String(params.q ?? '').trim();
    const status = String(params.status ?? '').trim();
    let rows = VENDORS;
    if (q) {
      rows = rows.filter(
        (v) => matches(v.storeName, q) || matches(v.ownerName, q) || matches(v.city, q),
      );
    }
    if (status && status !== 'all') rows = rows.filter((v) => v.status === status);
    return paginate(sortRows(rows, params.sort === undefined ? undefined : String(params.sort)), params);
  }

  const vendorDetail = /^\/admin\/vendors\/([^/]+)$/.exec(clean);
  if (vendorDetail?.[1]) return buildVendorDetail(vendorDetail[1]);

  /* ---- orders ---- */
  if (clean === '/admin/orders') {
    const q = String(params.q ?? '').trim();
    const status = String(params.status ?? '').trim();
    const vendorId = String(params.vendorId ?? '').trim();
    let rows = ORDERS;
    if (q) {
      rows = rows.filter(
        (o) => matches(o.orderNo, q) || matches(o.customerName, q) || matches(o.vendorName, q),
      );
    }
    if (status && status !== 'all') rows = rows.filter((o) => o.status === status);
    if (vendorId && vendorId !== 'all') rows = rows.filter((o) => o.vendorId === vendorId);
    return paginate(sortRows(rows, params.sort === undefined ? undefined : String(params.sort)), params);
  }

  const orderDetail = /^\/admin\/orders\/([^/]+)$/.exec(clean);
  if (orderDetail?.[1]) return buildOrderDetail(orderDetail[1]);

  /* ---- team ---- */
  if (clean === '/admin/team') return paginate(buildTeam(), { ...params, limit: 50 });

  /* ---- operations (the ADMIN role's surface) ----
     Kept in its own file: it is the largest fixture set here, it belongs to a
     different set of screens, and it has to be deletable on its own the day
     the ops endpoints land. */
  const ops = resolveOpsFixture(clean, params);
  if (ops !== null) return ops;

  return null;
}

/** For the vendor filter dropdown on the orders page. */
export function fixtureVendorOptions(): Array<{ label: string; value: string }> {
  return VENDORS.slice(0, 12).map((v) => ({ label: v.storeName, value: v.id }));
}
