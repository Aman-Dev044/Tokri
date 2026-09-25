/**
 * The shapes the customer app reads, and the tolerant readers that produce them.
 *
 * ── WHY THERE ARE NORMALISERS AT ALL ────────────────────────────────────────
 * Workers B and C are building `/stores`, `/cart`, `/checkout` and `/orders` in
 * parallel with this surface. The contract is plan §6.2 and the data model is
 * §5.1, but until those endpoints land, every field is a promise rather than a
 * fact. Casting `await res.json()` straight to an interface would mean a
 * renamed field shows up as a blank page or a thrown render.
 *
 * So the boundary is explicit: every response passes through a reader that
 * takes `unknown`, accepts the handful of spellings the API might reasonably
 * use, and returns a fully-populated view model. A missing field degrades to a
 * known-empty value; it never produces `undefined.map is not a function`.
 *
 * ── MONEY ───────────────────────────────────────────────────────────────────
 * Integer paise everywhere (plan §5.2). Nothing in this app divides by 100
 * except `formatPaise` from the design system.
 */

import { isAisleKey, type AisleKey } from '@mandi/design-system';

/* ══════════════════════════════ primitives ══════════════════════════════ */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Paged<T> {
  data: T[];
  meta: PageMeta;
}

/* ─────────────────────────── unknown readers ────────────────────────────── */

type Dict = Record<string, unknown>;

export function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(source: Dict, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function num(source: Dict, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function bool(source: Dict, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function dict(source: Dict, ...keys: string[]): Dict | null {
  for (const key of keys) {
    const value = source[key];
    if (isDict(value)) return value;
  }
  return null;
}

function list(source: Dict, ...keys: string[]): unknown[] {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function strings(source: Dict, ...keys: string[]): string[] {
  return list(source, ...keys).filter((v): v is string => typeof v === 'string');
}

/** `{ type:'Point', coordinates:[lng,lat] }` (plan §5.1) or a plain `{lat,lng}`. */
function readLocation(value: unknown): LatLng | null {
  if (!isDict(value)) return null;
  const coords = value['coordinates'];
  if (Array.isArray(coords) && coords.length >= 2) {
    const lng = coords[0];
    const lat = coords[1];
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
  }
  const lat = num(value, 'lat', 'latitude');
  const lng = num(value, 'lng', 'lon', 'longitude');
  if (lat !== null && lng !== null) return { lat, lng };
  return null;
}

function readId(source: Dict): string {
  return str(source, 'id', '_id', 'productId', 'orderId') ?? '';
}

function readAisle(value: unknown): AisleKey | null {
  return typeof value === 'string' && isAisleKey(value) ? value : null;
}

/* ══════════════════════════════ store ══════════════════════════════════ */

export interface StoreAddress {
  line1: string;
  city: string;
  state: string;
  pincode: string;
}

export interface Store {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  address: StoreAddress;
  location: LatLng | null;
  /** straight-line km from the customer, when the API computed it */
  distanceKm: number | null;
  etaMinutes: number | null;
  isOpen: boolean;
  rating: number | null;
  codEnabled: boolean;
  /** which chromatic aisles this store actually stocks */
  aisles: AisleKey[];
  productCount: number | null;
}

export function readStore(value: unknown): Store | null {
  if (!isDict(value)) return null;
  const address = dict(value, 'address') ?? {};
  const id = readId(value) || (str(value, 'slug') ?? '');
  if (id === '') return null;

  return {
    id,
    slug: str(value, 'slug') ?? id,
    name: str(value, 'storeName', 'name', 'title') ?? 'Unnamed store',
    description: str(value, 'description', 'tagline'),
    logoUrl: str(value, 'logoUrl', 'logo'),
    bannerUrl: str(value, 'bannerUrl', 'banner'),
    address: {
      line1: str(address, 'line1', 'street') ?? '',
      city: str(address, 'city') ?? '',
      state: str(address, 'state') ?? '',
      pincode: str(address, 'pincode', 'zip') ?? '',
    },
    location: readLocation(value['location']),
    distanceKm: num(value, 'distanceKm', 'distance_km', 'distance'),
    etaMinutes: num(value, 'etaMinutes', 'eta', 'etaMins'),
    isOpen: bool(value, 'isOpen', 'open') ?? true,
    rating: num(value, 'rating'),
    codEnabled: bool(value, 'codEnabled', 'cod') ?? false,
    aisles: list(value, 'aisles', 'aisleKeys', 'categories')
      .map((entry) => (isDict(entry) ? readAisle(entry['aisleKey']) : readAisle(entry)))
      .filter((k): k is AisleKey => k !== null),
    productCount: num(value, 'productCount', 'products'),
  };
}

/* ══════════════════════════════ product ════════════════════════════════ */

export interface Product {
  id: string;
  vendorId: string;
  storeName: string | null;
  name: string;
  slug: string;
  brand: string | null;
  description: string | null;
  images: string[];
  unit: string;
  unitValue: number | null;
  pricePaise: number;
  mrpPaise: number | null;
  discountPct: number | null;
  aisleKey: AisleKey | null;
  inStock: boolean;
  /** null when the API does not expose an exact count publicly */
  stock: number | null;
}

export function readProduct(value: unknown): Product | null {
  if (!isDict(value)) return null;
  const id = readId(value);
  if (id === '') return null;

  const price = num(value, 'pricePaise', 'price') ?? 0;
  const mrp = num(value, 'mrpPaise', 'mrp');
  const stock = num(value, 'stock', 'available');
  const inStockFlag = bool(value, 'inStock', 'isAvailable', 'isActive');

  return {
    id,
    vendorId: str(value, 'vendorId', 'storeId') ?? '',
    storeName: str(value, 'storeName', 'vendorName'),
    name: str(value, 'name', 'title') ?? 'Unnamed item',
    slug: str(value, 'slug') ?? id,
    brand: str(value, 'brand'),
    description: str(value, 'description'),
    images: strings(value, 'images', 'photos'),
    unit: str(value, 'unit') ?? 'pack',
    unitValue: num(value, 'unitValue'),
    pricePaise: price,
    mrpPaise: mrp !== null && mrp > price ? mrp : null,
    discountPct: num(value, 'discountPct'),
    aisleKey: readAisle(value['aisleKey']) ?? readAisle(dict(value, 'category')?.['aisleKey']),
    inStock: inStockFlag ?? (stock === null ? true : stock > 0),
    stock,
  };
}

/* ═══════════════════════════════ cart ══════════════════════════════════ */

/**
 * The honest flags (plan decision #9 and §6.2 `/checkout/validate`).
 *
 * These are shown as inline chips ON the line they belong to — never as a modal.
 * A modal makes the customer dismiss the information before they can act on it,
 * and then the basket looks correct while it is not.
 */
export type StaleFlagCode = 'price_changed' | 'out_of_stock' | 'reduced_qty';

export interface StaleFlag {
  code: StaleFlagCode;
  /** previous / current, in the unit that makes sense for the code */
  fromPaise?: number;
  toPaise?: number;
  fromQty?: number;
  toQty?: number;
  message?: string;
}

const FLAG_CODES: readonly StaleFlagCode[] = ['price_changed', 'out_of_stock', 'reduced_qty'];

function isFlagCode(value: unknown): value is StaleFlagCode {
  return typeof value === 'string' && FLAG_CODES.includes(value as StaleFlagCode);
}

/** Accepts `['out_of_stock']`, `[{code,...}]`, or `{ price_changed: {...} }`. */
function readFlags(value: unknown): StaleFlag[] {
  const out: StaleFlag[] = [];

  const push = (code: StaleFlagCode, detail: Dict | null) => {
    out.push({
      code,
      fromPaise: detail ? (num(detail, 'fromPaise', 'from', 'previousPrice') ?? undefined) : undefined,
      toPaise: detail ? (num(detail, 'toPaise', 'to', 'currentPrice') ?? undefined) : undefined,
      fromQty: detail ? (num(detail, 'fromQty', 'requestedQty') ?? undefined) : undefined,
      toQty: detail ? (num(detail, 'toQty', 'availableQty') ?? undefined) : undefined,
      message: detail ? (str(detail, 'message', 'detail') ?? undefined) : undefined,
    });
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isFlagCode(entry)) push(entry, null);
      else if (isDict(entry) && isFlagCode(entry['code'])) push(entry['code'], entry);
    }
    return out;
  }
  if (isDict(value)) {
    for (const [key, detail] of Object.entries(value)) {
      if (!isFlagCode(key)) continue;
      if (detail === false || detail === null || detail === undefined) continue;
      push(key, isDict(detail) ? detail : null);
    }
  }
  return out;
}

export interface CartLine {
  productId: string;
  name: string;
  image: string | null;
  unit: string | null;
  pricePaise: number;
  qty: number;
  lineTotalPaise: number;
  /** null when the API does not say; used to cap the stepper */
  maxQty: number | null;
  flags: StaleFlag[];
}

export interface CartPricing {
  itemsSubtotalPaise: number;
  discountPaise: number;
  deliveryFeePaise: number;
  taxesPaise: number;
  grandTotalPaise: number;
}

export interface Cart {
  id: string | null;
  vendorId: string;
  storeName: string | null;
  storeSlug: string | null;
  lines: CartLine[];
  pricing: CartPricing;
  couponCode: string | null;
}

export function readCartLine(value: unknown): CartLine | null {
  if (!isDict(value)) return null;
  const productId = str(value, 'productId', 'id', '_id');
  if (productId === null) return null;

  const price = num(value, 'pricePaise', 'price') ?? 0;
  const qty = num(value, 'qty', 'quantity') ?? 1;

  return {
    productId,
    name: str(value, 'name', 'title') ?? 'Item',
    image: str(value, 'image', 'imageUrl') ?? strings(value, 'images')[0] ?? null,
    unit: str(value, 'unit'),
    pricePaise: price,
    qty,
    lineTotalPaise: num(value, 'lineTotalPaise', 'lineTotal') ?? price * qty,
    maxQty: num(value, 'maxQty', 'availableQty', 'stock'),
    flags: readFlags(value['flags'] ?? value['issues'] ?? value['warnings']),
  };
}

export function readCart(value: unknown): Cart | null {
  if (!isDict(value)) return null;
  const payload = dict(value, 'data') ?? value;
  const lines = list(payload, 'items', 'lines')
    .map(readCartLine)
    .filter((l): l is CartLine => l !== null);

  const pricing = dict(payload, 'pricing', 'totals');
  const subtotal =
    (pricing ? num(pricing, 'itemsSubtotal', 'itemsSubtotalPaise', 'subtotal') : null) ??
    lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);

  return {
    id: str(payload, 'id', '_id'),
    vendorId: str(payload, 'vendorId', 'storeId') ?? '',
    storeName: str(payload, 'storeName', 'vendorName'),
    storeSlug: str(payload, 'storeSlug', 'vendorSlug'),
    lines,
    pricing: {
      itemsSubtotalPaise: subtotal,
      discountPaise: pricing ? (num(pricing, 'discount', 'discountPaise') ?? 0) : 0,
      deliveryFeePaise: pricing ? (num(pricing, 'deliveryFee', 'deliveryFeePaise') ?? 0) : 0,
      taxesPaise: pricing ? (num(pricing, 'taxes', 'taxesPaise') ?? 0) : 0,
      grandTotalPaise:
        (pricing ? num(pricing, 'grandTotal', 'grandTotalPaise') : null) ??
        subtotal +
          (pricing ? (num(pricing, 'deliveryFee', 'deliveryFeePaise') ?? 0) : 0) -
          (pricing ? (num(pricing, 'discount', 'discountPaise') ?? 0) : 0),
    },
    couponCode: str(payload, 'couponCode', 'coupon'),
  };
}

/* ══════════════════════════════ address ════════════════════════════════ */

export interface Address {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  phone: string | null;
  location: LatLng | null;
  isDefault: boolean;
}

export function readAddress(value: unknown): Address | null {
  if (!isDict(value)) return null;
  const id = readId(value);
  if (id === '') return null;
  return {
    id,
    label: str(value, 'label') ?? 'Address',
    line1: str(value, 'line1') ?? '',
    line2: str(value, 'line2'),
    city: str(value, 'city') ?? '',
    pincode: str(value, 'pincode') ?? '',
    phone: str(value, 'phone'),
    location: readLocation(value['location']),
    isDefault: bool(value, 'isDefault') ?? false,
  };
}

/* ═══════════════════════════════ order ═════════════════════════════════ */

export const ORDER_STATUSES = [
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
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

export interface OrderItem {
  productId: string;
  name: string;
  image: string | null;
  unit: string | null;
  pricePaise: number;
  qty: number;
  lineTotalPaise: number;
  fulfilled: boolean;
}

export interface OrderStatusEvent {
  from: OrderStatus | null;
  to: OrderStatus;
  at: string;
  actorRole: string | null;
  reason: string | null;
}

export interface Order {
  id: string;
  orderNo: string;
  status: OrderStatus;
  statusHistory: OrderStatusEvent[];
  vendorId: string;
  storeName: string | null;
  storeSlug: string | null;
  storeLocation: LatLng | null;
  items: OrderItem[];
  pricing: CartPricing;
  address: Address | null;
  paymentMethod: 'cod' | 'online' | null;
  paymentStatus: string | null;
  placedAt: string | null;
  deliveredAt: string | null;
  etaMinutes: number | null;
  /** primary aisle of the basket — tints the whole tracking screen */
  aisleKey: AisleKey | null;
  rider: { name: string | null; phoneMasked: string | null } | null;
}

function readOrderItem(value: unknown): OrderItem | null {
  const line = readCartLine(value);
  if (line === null) return null;
  return {
    productId: line.productId,
    name: line.name,
    image: line.image,
    unit: line.unit,
    pricePaise: line.pricePaise,
    qty: line.qty,
    lineTotalPaise: line.lineTotalPaise,
    fulfilled: isDict(value) ? (bool(value, 'fulfilled') ?? true) : true,
  };
}

export function readOrder(value: unknown): Order | null {
  if (!isDict(value)) return null;
  const payload = dict(value, 'data', 'order') ?? value;
  const id = readId(payload);
  if (id === '') return null;

  const status = isOrderStatus(payload['status']) ? payload['status'] : 'PLACED';
  const pricing = dict(payload, 'pricing') ?? {};
  const payment = dict(payload, 'payment') ?? {};
  const method = str(payment, 'method');
  const rider = dict(payload, 'deliveryPartner', 'rider');

  const items = list(payload, 'items')
    .map(readOrderItem)
    .filter((i): i is OrderItem => i !== null);
  const subtotal =
    num(pricing, 'itemsSubtotal', 'itemsSubtotalPaise') ??
    items.reduce((sum, item) => sum + item.lineTotalPaise, 0);

  return {
    id,
    orderNo: str(payload, 'orderNo', 'number') ?? id,
    status,
    statusHistory: list(payload, 'statusHistory')
      .map((entry): OrderStatusEvent | null => {
        if (!isDict(entry) || !isOrderStatus(entry['to'])) return null;
        return {
          from: isOrderStatus(entry['from']) ? entry['from'] : null,
          to: entry['to'],
          at: str(entry, 'at', 'createdAt') ?? '',
          actorRole: str(entry, 'byRole', 'actorRole'),
          reason: str(entry, 'reason'),
        };
      })
      .filter((e): e is OrderStatusEvent => e !== null),
    vendorId: str(payload, 'vendorId') ?? '',
    storeName: str(payload, 'storeName', 'vendorName'),
    storeSlug: str(payload, 'storeSlug', 'vendorSlug'),
    storeLocation: readLocation(payload['storeLocation'] ?? dict(payload, 'store')?.['location']),
    items,
    pricing: {
      itemsSubtotalPaise: subtotal,
      discountPaise: num(pricing, 'discount', 'discountPaise') ?? 0,
      deliveryFeePaise: num(pricing, 'deliveryFee', 'deliveryFeePaise') ?? 0,
      taxesPaise: num(pricing, 'taxes', 'taxesPaise') ?? 0,
      grandTotalPaise: num(pricing, 'grandTotal', 'grandTotalPaise') ?? subtotal,
    },
    address: readAddress(payload['address']),
    paymentMethod: method === 'cod' || method === 'online' ? method : null,
    paymentStatus: str(payment, 'status'),
    placedAt: str(payload, 'placedAt', 'createdAt'),
    deliveredAt: str(payload, 'deliveredAt'),
    etaMinutes: num(payload, 'etaMinutes', 'eta'),
    aisleKey: readAisle(payload['aisleKey']),
    rider:
      rider === null
        ? null
        : { name: str(rider, 'name'), phoneMasked: str(rider, 'phoneMasked', 'phone') },
  };
}

/* ════════════════════════════ order tracking ═══════════════════════════ */

export interface TrackSnapshot {
  order: Order;
  /** last known rider position — `at` is what makes staleness honest */
  rider: { position: LatLng; at: string; etaMinutes: number | null } | null;
  route: LatLng[];
}

export function readTrack(value: unknown): TrackSnapshot | null {
  if (!isDict(value)) return null;
  const payload = dict(value, 'data') ?? value;
  const order = readOrder(payload['order'] ?? payload);
  if (order === null) return null;

  const riderRaw = dict(payload, 'rider', 'partner', 'location');
  const position = riderRaw === null ? null : (readLocation(riderRaw) ?? readLocation(riderRaw['location']));

  return {
    order,
    rider:
      riderRaw !== null && position !== null
        ? {
            position,
            at: str(riderRaw, 'at', 'locationAt', 'updatedAt') ?? new Date().toISOString(),
            etaMinutes: num(riderRaw, 'etaMinutes', 'eta'),
          }
        : null,
    route: list(payload, 'route', 'polyline')
      .map(readLocation)
      .filter((p): p is LatLng => p !== null),
  };
}

/* ═════════════════════════════ list envelope ═══════════════════════════ */

/** `{ data, meta }` (plan §6.1) — or a bare array, which some handlers return. */
export function readPaged<T>(value: unknown, reader: (item: unknown) => T | null): Paged<T> {
  const rows = Array.isArray(value) ? value : isDict(value) ? list(value, 'data', 'items') : [];
  const data = rows.map(reader).filter((row): row is T => row !== null);
  const metaRaw = isDict(value) ? dict(value, 'meta') : null;

  return {
    data,
    meta: {
      page: metaRaw ? (num(metaRaw, 'page') ?? 1) : 1,
      limit: metaRaw ? (num(metaRaw, 'limit') ?? data.length) : data.length,
      total: metaRaw ? (num(metaRaw, 'total') ?? data.length) : data.length,
      pages: metaRaw ? (num(metaRaw, 'pages') ?? 1) : 1,
    },
  };
}
