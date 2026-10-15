/**
 * The shapes the customer app reads — mirrored from the RUNNING API.
 *
 * ── WHY THIS FILE IS NOW A MIRROR, NOT A GUESS ──────────────────────────────
 * The first version of this file was written while `apps/api/src/modules/shop`
 * was still being built, so it accepted "the handful of spellings the API might
 * reasonably use" and invented a few fields outright (`etaMinutes` on a store,
 * `aisles` on a store row, `couponCode` on a cart, a `route` on tracking). The
 * API has landed and none of those exist. Worse, the API runs
 * `forbidNonWhitelisted: true`, so an invented QUERY PARAM is a hard 400 rather
 * than an ignored extra.
 *
 * So every interface below is the exact response shape of a real endpoint, with
 * the API's own field names, nesting and nullability:
 *
 *   Store          GET /stores                        → StoreRow
 *   StoreDetail    GET /stores/:slug                  → StoreDetail
 *   AisleGroup     GET /stores/:id/categories         → AisleGroup[]
 *   Product        GET /stores/:id/products           → ProductRow
 *   ProductDetail  GET /products/:id                  → ProductDetail
 *   Cart           GET /cart                          → CartView
 *   Address        GET /addresses                     → AddressView[]
 *   OrderSummary   GET /orders                        → Paginated<OrderSummary>
 *   OrderDetail    GET /orders/:id                    → OrderDetail
 *   Track          GET /orders/:id/track              → TrackView
 *   CheckoutQuote  POST /checkout/validate            → CheckoutQuote
 *   PlacedOrder    POST /checkout                     → PlacedOrder
 *
 * The readers stay — but they are now NARROWING, not translating. They accept
 * `unknown`, check the one spelling the API actually uses, and fall back to a
 * safe empty value so a partial payload degrades instead of throwing inside a
 * render. What they no longer do is guess at alternative names, because a name
 * that does not match is now a bug to fix here rather than a shape to tolerate.
 *
 * ── MONEY ───────────────────────────────────────────────────────────────────
 * INTEGER PAISE everywhere, under the API's own field names (`price`, `mrp`,
 * `lineTotal`, `grandTotal`…). Nothing in this app divides by 100 except
 * `formatPaise` from the design system.
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

function str(source: Dict, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function num(source: Dict, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** For the money and count fields the API always sends. Absent ⇒ 0, never NaN. */
function int(source: Dict, key: string): number {
  return num(source, key) ?? 0;
}

function bool(source: Dict, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

function dict(source: Dict, key: string): Dict | null {
  const value = source[key];
  return isDict(value) ? value : null;
}

function list(source: Dict, key: string): unknown[] {
  const value = source[key];
  return Array.isArray(value) ? value : [];
}

function strings(source: Dict, key: string): string[] {
  return list(source, key).filter((v): v is string => typeof v === 'string');
}

/**
 * Every location the customer API returns is already `{ lat, lng }`.
 *
 * Exported because `GET /pincodes/:pincode` returns a bare point of exactly
 * this shape at the top level, and the checkout address form reads it to set
 * a delivery pin without a map.
 */
export function readLatLng(value: unknown): LatLng | null {
  if (!isDict(value)) return null;
  const lat = num(value, 'lat');
  const lng = num(value, 'lng');
  return lat !== null && lng !== null ? { lat, lng } : null;
}

function readAisleKey(value: unknown): AisleKey | null {
  return typeof value === 'string' && isAisleKey(value) ? value : null;
}

/** Turns `T | null` rows into a dense array, dropping anything unreadable. */
function compact<T>(rows: readonly unknown[], reader: (row: unknown) => T | null): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const parsed = reader(row);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

/* ══════════════════════════════ store ══════════════════════════════════ */

/** `GET /stores` → `StoreRow`. Note: `city` is flat; there is no `address` here. */
export interface Store {
  id: string;
  slug: string;
  storeName: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  city: string;
  location: LatLng | null;
  isOpen: boolean;
  rating: number;
  serviceRadiusKm: number;
  codEnabled: boolean;
  /** Null when the caller sent no `lat`/`lng`. The API never guesses one. */
  distanceKm: number | null;
}

export interface StoreAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface OpeningHour {
  /** 0 = Sunday. */
  day: number;
  open: string;
  close: string;
}

/** `GET /stores/:slug` → `StoreDetail`. */
export interface StoreDetail extends Store {
  address: StoreAddress;
  openingHours: OpeningHour[];
  /** INTEGER PAISE. */
  codMaxAmount: number;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  productCount: number;
}

export function readStore(value: unknown): Store | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;

  return {
    id,
    slug: str(value, 'slug') ?? id,
    storeName: str(value, 'storeName') ?? 'Unnamed store',
    description: str(value, 'description'),
    logoUrl: str(value, 'logoUrl'),
    bannerUrl: str(value, 'bannerUrl'),
    city: str(value, 'city') ?? '',
    location: readLatLng(value['location']),
    isOpen: bool(value, 'isOpen') ?? false,
    rating: int(value, 'rating'),
    serviceRadiusKm: int(value, 'serviceRadiusKm'),
    codEnabled: bool(value, 'codEnabled') ?? false,
    distanceKm: num(value, 'distanceKm'),
  };
}

export function readStoreDetail(value: unknown): StoreDetail | null {
  const base = readStore(value);
  if (base === null || !isDict(value)) return null;
  const address = dict(value, 'address');

  return {
    ...base,
    address: {
      line1: address === null ? '' : (str(address, 'line1') ?? ''),
      line2: address === null ? null : str(address, 'line2'),
      city: address === null ? base.city : (str(address, 'city') ?? base.city),
      state: address === null ? '' : (str(address, 'state') ?? ''),
      pincode: address === null ? '' : (str(address, 'pincode') ?? ''),
    },
    openingHours: compact(list(value, 'openingHours'), (row): OpeningHour | null => {
      if (!isDict(row)) return null;
      const day = num(row, 'day');
      const open = str(row, 'open');
      const close = str(row, 'close');
      return day === null || open === null || close === null ? null : { day, open, close };
    }),
    codMaxAmount: int(value, 'codMaxAmount'),
    deliveryFee: int(value, 'deliveryFee'),
    freeDeliveryThreshold: int(value, 'freeDeliveryThreshold'),
    productCount: int(value, 'productCount'),
  };
}

/* ═════════════════════════ categories / aisles ═════════════════════════ */

/** A row of `GET /stores/:id/categories` → `CategoryRow`. */
export interface Category {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  sortOrder: number;
  productCount: number;
}

/** `GET /stores/:id/categories` → `AisleGroup[]`. Empty aisles are omitted. */
export interface AisleGroup {
  aisleKey: AisleKey;
  categories: Category[];
  productCount: number;
}

function readCategory(value: unknown): Category | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;
  return {
    id,
    name: str(value, 'name') ?? 'Category',
    slug: str(value, 'slug') ?? id,
    imageUrl: str(value, 'imageUrl'),
    sortOrder: int(value, 'sortOrder'),
    productCount: int(value, 'productCount'),
  };
}

export function readAisleGroup(value: unknown): AisleGroup | null {
  if (!isDict(value)) return null;
  const aisleKey = readAisleKey(value['aisleKey']);
  if (aisleKey === null) return null;
  return {
    aisleKey,
    categories: compact(list(value, 'categories'), readCategory),
    productCount: int(value, 'productCount'),
  };
}

/** The endpoint returns a bare array, not a `{ data, meta }` envelope. */
export function readAisleGroups(value: unknown): AisleGroup[] {
  return compact(Array.isArray(value) ? value : [], readAisleGroup);
}

/* ══════════════════════════════ product ════════════════════════════════ */

/**
 * `GET /stores/:id/products` → `ProductRow`.
 *
 * There is NO `vendorId` on a row — the caller already knows which store it
 * asked. Anything that needs the vendor (the basket) is handed it explicitly
 * rather than reading a field that does not exist.
 */
export interface Product {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  images: string[];
  unit: string;
  unitValue: number;
  /** INTEGER PAISE. */
  mrp: number;
  /** INTEGER PAISE. */
  price: number;
  discountPct: number;
  categoryId: string;
  aisleKey: AisleKey | null;
  inStock: boolean;
  /** Live available stock, clamped for display by the API. */
  availableQty: number;
}

/** `GET /products/:id` → `ProductDetail`. This one DOES carry its store. */
export interface ProductDetail extends Product {
  description: string | null;
  sku: string;
  category: { id: string; name: string; slug: string; aisleKey: AisleKey } | null;
  store: {
    id: string;
    slug: string;
    storeName: string;
    isOpen: boolean;
    rating: number;
  };
}

export function readProduct(value: unknown): Product | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;

  return {
    id,
    name: str(value, 'name') ?? 'Unnamed item',
    slug: str(value, 'slug') ?? id,
    brand: str(value, 'brand'),
    images: strings(value, 'images'),
    unit: str(value, 'unit') ?? 'pack',
    unitValue: int(value, 'unitValue'),
    mrp: int(value, 'mrp'),
    price: int(value, 'price'),
    discountPct: int(value, 'discountPct'),
    categoryId: str(value, 'categoryId') ?? '',
    aisleKey: readAisleKey(value['aisleKey']),
    inStock: bool(value, 'inStock') ?? false,
    availableQty: int(value, 'availableQty'),
  };
}

/**
 * `GET /products` → `ProductRow` with `store`. Market-wide search and the
 * market-wide aisle both use this endpoint; every row carries which store it
 * belongs to (`store.id` is the vendor id `add()` needs), so a result grid can
 * mix products from many stores in one page.
 */
export interface MarketProduct extends Product {
  store: {
    id: string;
    slug: string;
    storeName: string;
    /** Null when the caller sent no `lat`/`lng`. */
    distanceKm: number | null;
  };
}

function readMarketProductStore(value: unknown): MarketProduct['store'] | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;
  return {
    id,
    slug: str(value, 'slug') ?? id,
    storeName: str(value, 'storeName') ?? 'A store',
    distanceKm: num(value, 'distanceKm'),
  };
}

export function readMarketProduct(value: unknown): MarketProduct | null {
  const base = readProduct(value);
  if (base === null || !isDict(value)) return null;
  const store = readMarketProductStore(value['store']);
  if (store === null) return null;
  return { ...base, store };
}

export function readProductDetail(value: unknown): ProductDetail | null {
  const base = readProduct(value);
  if (base === null || !isDict(value)) return null;

  const store = dict(value, 'store');
  // A product with no store is not orderable and not renderable as one.
  if (store === null) return null;
  const storeId = str(store, 'id');
  if (storeId === null) return null;

  const category = dict(value, 'category');
  const categoryAisle = category === null ? null : readAisleKey(category['aisleKey']);
  const categoryId = category === null ? null : str(category, 'id');

  return {
    ...base,
    // `aisleKey` is on the row already; the category echoes it. Prefer the row,
    // fall back to the category, never assume either is present.
    aisleKey: base.aisleKey ?? categoryAisle,
    description: str(value, 'description'),
    sku: str(value, 'sku') ?? '',
    category:
      category === null || categoryId === null || categoryAisle === null
        ? null
        : {
            id: categoryId,
            name: str(category, 'name') ?? 'Category',
            slug: str(category, 'slug') ?? categoryId,
            aisleKey: categoryAisle,
          },
    store: {
      id: storeId,
      slug: str(store, 'slug') ?? storeId,
      storeName: str(store, 'storeName') ?? 'This store',
      isOpen: bool(store, 'isOpen') ?? false,
      rating: int(store, 'rating'),
    },
  };
}

/* ═══════════════════════════════ cart ══════════════════════════════════ */

/**
 * The four honest flags, EXACTLY as `CartService` emits them — a flat array of
 * string codes on each line, with no detail object.
 *
 * `unavailable` was missing from the old union entirely, so a delisted product
 * rendered as no chip at all: the basket looked fine and checkout refused.
 */
export const CART_LINE_FLAGS = [
  'price_changed',
  'out_of_stock',
  'reduced_qty',
  'unavailable',
] as const;

export type CartLineFlag = (typeof CART_LINE_FLAGS)[number];

export function isCartLineFlag(value: unknown): value is CartLineFlag {
  return typeof value === 'string' && (CART_LINE_FLAGS as readonly string[]).includes(value);
}

/** `CartLine`. The DETAIL behind a flag is the pair of price/qty fields below. */
export interface CartLine {
  productId: string;
  name: string;
  image: string | null;
  /** INTEGER PAISE — the price when the line was added. */
  price: number;
  /** INTEGER PAISE — the price right now. `price_changed` compares these two. */
  currentPrice: number;
  qty: number;
  /** currentPrice × qty, INTEGER PAISE. */
  lineTotal: number;
  /** Live stock. `qty` above this is what raises `reduced_qty`. */
  availableQty: number;
  flags: CartLineFlag[];
}

/** Cart pricing has NO discount field — a coupon only exists at checkout. */
export interface CartPricing {
  /** All INTEGER PAISE. */
  itemsSubtotal: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
}

export interface CartStore {
  id: string;
  slug: string;
  storeName: string;
  isOpen: boolean;
}

export interface ParkedCart {
  id: string;
  vendorId: string;
  storeName: string;
  itemCount: number;
  updatedAt: string;
}

/** `GET /cart` → `CartView`. `id` is null when there is no cart at all. */
export interface Cart {
  id: string | null;
  vendorId: string | null;
  store: CartStore | null;
  status: string | null;
  items: CartLine[];
  itemCount: number;
  pricing: CartPricing;
  hasIssues: boolean;
  parkedCarts: ParkedCart[];
}

export const EMPTY_CART_PRICING: CartPricing = {
  itemsSubtotal: 0,
  deliveryFee: 0,
  taxes: 0,
  grandTotal: 0,
};

export function readCartLine(value: unknown): CartLine | null {
  if (!isDict(value)) return null;
  const productId = str(value, 'productId');
  if (productId === null) return null;

  const price = int(value, 'price');
  const currentPrice = num(value, 'currentPrice') ?? price;
  const qty = num(value, 'qty') ?? 1;

  return {
    productId,
    name: str(value, 'name') ?? 'Item',
    image: str(value, 'image'),
    price,
    currentPrice,
    qty,
    lineTotal: num(value, 'lineTotal') ?? currentPrice * qty,
    availableQty: int(value, 'availableQty'),
    flags: list(value, 'flags').filter(isCartLineFlag),
  };
}

function readCartPricing(value: Dict | null): CartPricing {
  if (value === null) return EMPTY_CART_PRICING;
  return {
    itemsSubtotal: int(value, 'itemsSubtotal'),
    deliveryFee: int(value, 'deliveryFee'),
    taxes: int(value, 'taxes'),
    grandTotal: int(value, 'grandTotal'),
  };
}

function readCartStore(value: unknown): CartStore | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;
  return {
    id,
    slug: str(value, 'slug') ?? id,
    storeName: str(value, 'storeName') ?? 'This store',
    isOpen: bool(value, 'isOpen') ?? false,
  };
}

function readParkedCart(value: unknown): ParkedCart | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  const vendorId = str(value, 'vendorId');
  if (id === null || vendorId === null) return null;
  return {
    id,
    vendorId,
    storeName: str(value, 'storeName') ?? 'A store',
    itemCount: int(value, 'itemCount'),
    updatedAt: str(value, 'updatedAt') ?? '',
  };
}

export function readCart(value: unknown): Cart | null {
  if (!isDict(value)) return null;
  const items = compact(list(value, 'items'), readCartLine);

  return {
    // An empty cart legitimately answers `{ id: null, … }`, so a null id is a
    // state to render, not a reason to return null from the reader.
    id: str(value, 'id'),
    vendorId: str(value, 'vendorId'),
    store: readCartStore(value['store']),
    status: str(value, 'status'),
    items,
    itemCount: num(value, 'itemCount') ?? items.reduce((sum, line) => sum + line.qty, 0),
    pricing: readCartPricing(dict(value, 'pricing')),
    hasIssues: bool(value, 'hasIssues') ?? items.some((line) => line.flags.length > 0),
    parkedCarts: compact(list(value, 'parkedCarts'), readParkedCart),
  };
}

/** `POST /cart/items` → `{ cart, parked }`. */
export interface AddItemResult {
  cart: Cart | null;
  parked: ParkedCart | null;
}

export function readAddItemResult(value: unknown): AddItemResult {
  if (!isDict(value)) return { cart: null, parked: null };
  return {
    cart: readCart(value['cart']),
    parked: readParkedCart(value['parked']),
  };
}

/* ══════════════════════════════ address ════════════════════════════════ */

/** `GET /addresses` → `AddressView[]` (a bare array, no envelope). */
export interface Address {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  location: LatLng | null;
  phone: string;
  isDefault: boolean;
}

export function readAddress(value: unknown): Address | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;
  return {
    id,
    label: str(value, 'label') ?? 'Address',
    line1: str(value, 'line1') ?? '',
    line2: str(value, 'line2'),
    city: str(value, 'city') ?? '',
    pincode: str(value, 'pincode') ?? '',
    location: readLatLng(value['location']),
    phone: str(value, 'phone') ?? '',
    isDefault: bool(value, 'isDefault') ?? false,
  };
}

export function readAddresses(value: unknown): Address[] {
  return compact(Array.isArray(value) ? value : [], readAddress);
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

export type PaymentMethod = 'cod' | 'online';

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === 'cod' || value === 'online';
}

export interface OrderPayment {
  method: PaymentMethod | null;
  status: string | null;
}

/** The store stub carried by every order row. Null on a deleted vendor. */
export interface OrderStore {
  id: string;
  storeName: string;
  slug: string;
}

/** Every field INTEGER PAISE. Unlike the cart, an ORDER does carry `discount`. */
export interface OrderPricing {
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
}

/**
 * `GET /orders` → `OrderSummary`.
 *
 * A row has NO `items[]` and NO `pricing` object — it carries `itemCount`, a
 * flat `grandTotal`, and `preview`: the first few item NAMES as plain strings.
 */
export interface OrderSummary {
  id: string;
  orderNo: string;
  status: OrderStatus;
  placedAt: string | null;
  itemCount: number;
  /** INTEGER PAISE. */
  grandTotal: number;
  payment: OrderPayment;
  store: OrderStore | null;
  preview: string[];
}

export interface OrderItem {
  productId: string;
  name: string;
  image: string | null;
  unit: string;
  /** INTEGER PAISE. */
  price: number;
  qty: number;
  /** INTEGER PAISE. */
  lineTotal: number;
  fulfilled: boolean;
}

/** The address as FROZEN ONTO the order. It has no id and no `isDefault`. */
export interface OrderAddress {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  location: LatLng | null;
  phone: string;
}

export interface StatusChange {
  from: OrderStatus | null;
  to: OrderStatus;
  byRole: string | null;
  reason: string | null;
  at: string;
}

/** `GET /orders/:id` → `OrderDetail`. */
export interface OrderDetail extends OrderSummary {
  items: OrderItem[];
  pricing: OrderPricing;
  address: OrderAddress | null;
  statusHistory: StatusChange[];
  cancellation: { by: string | null; reason: string | null; at: string | null } | null;
  canCancel: boolean;
  acceptedAt: string | null;
  deliveredAt: string | null;
}

function readOrderStore(value: unknown): OrderStore | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;
  return {
    id,
    storeName: str(value, 'storeName') ?? 'Store',
    slug: str(value, 'slug') ?? id,
  };
}

function readOrderPayment(value: unknown): OrderPayment {
  if (!isDict(value)) return { method: null, status: null };
  const method = value['method'];
  return {
    method: isPaymentMethod(method) ? method : null,
    status: str(value, 'status'),
  };
}

export function readStatusChange(value: unknown): StatusChange | null {
  if (!isDict(value)) return null;
  const to = value['to'];
  if (!isOrderStatus(to)) return null;
  const from = value['from'];
  return {
    from: isOrderStatus(from) ? from : null,
    to,
    byRole: str(value, 'byRole'),
    reason: str(value, 'reason'),
    at: str(value, 'at') ?? '',
  };
}

export function readOrderSummary(value: unknown): OrderSummary | null {
  if (!isDict(value)) return null;
  const id = str(value, 'id');
  if (id === null) return null;
  const status = value['status'];

  return {
    id,
    orderNo: str(value, 'orderNo') ?? id,
    status: isOrderStatus(status) ? status : 'PLACED',
    placedAt: str(value, 'placedAt'),
    itemCount: int(value, 'itemCount'),
    grandTotal: int(value, 'grandTotal'),
    payment: readOrderPayment(value['payment']),
    store: readOrderStore(value['store']),
    preview: strings(value, 'preview'),
  };
}

function readOrderItem(value: unknown): OrderItem | null {
  if (!isDict(value)) return null;
  const productId = str(value, 'productId');
  if (productId === null) return null;
  const price = int(value, 'price');
  const qty = num(value, 'qty') ?? 1;
  return {
    productId,
    name: str(value, 'name') ?? 'Item',
    image: str(value, 'image'),
    unit: str(value, 'unit') ?? '',
    price,
    qty,
    lineTotal: num(value, 'lineTotal') ?? price * qty,
    fulfilled: bool(value, 'fulfilled') ?? true,
  };
}

function readOrderAddress(value: unknown): OrderAddress | null {
  if (!isDict(value)) return null;
  const line1 = str(value, 'line1');
  if (line1 === null) return null;
  return {
    label: str(value, 'label'),
    line1,
    line2: str(value, 'line2'),
    city: str(value, 'city') ?? '',
    pincode: str(value, 'pincode') ?? '',
    location: readLatLng(value['location']),
    phone: str(value, 'phone') ?? '',
  };
}

export function readOrderDetail(value: unknown): OrderDetail | null {
  const summary = readOrderSummary(value);
  if (summary === null || !isDict(value)) return null;
  const pricing = dict(value, 'pricing');
  const cancellation = dict(value, 'cancellation');

  return {
    ...summary,
    items: compact(list(value, 'items'), readOrderItem),
    pricing: {
      itemsSubtotal: pricing === null ? 0 : int(pricing, 'itemsSubtotal'),
      discount: pricing === null ? 0 : int(pricing, 'discount'),
      deliveryFee: pricing === null ? 0 : int(pricing, 'deliveryFee'),
      taxes: pricing === null ? 0 : int(pricing, 'taxes'),
      grandTotal: pricing === null ? summary.grandTotal : int(pricing, 'grandTotal'),
    },
    address: readOrderAddress(value['address']),
    statusHistory: compact(list(value, 'statusHistory'), readStatusChange),
    cancellation:
      cancellation === null
        ? null
        : {
            by: str(cancellation, 'by'),
            reason: str(cancellation, 'reason'),
            at: str(cancellation, 'at'),
          },
    canCancel: bool(value, 'canCancel') ?? false,
    acceptedAt: str(value, 'acceptedAt'),
    deliveredAt: str(value, 'deliveredAt'),
  };
}

/* ════════════════════════════ order tracking ═══════════════════════════ */

/**
 * `GET /orders/:id/track` → `TrackView`.
 *
 * This is NOT an order. It does not carry items, pricing or an aisle key, and
 * there is no route polyline — the API never invents a road. The rider block is
 * reported exactly as last received, with `lastSeenAt` and `ageSeconds`, so the
 * UI can say "40s ago" without extrapolating anything.
 */
export type EtaBasis = 'sla' | 'delivered' | 'closed';

function isEtaBasis(value: unknown): value is EtaBasis {
  return value === 'sla' || value === 'delivered' || value === 'closed';
}

export interface TrackEta {
  /** Minutes remaining against the promise. Null once terminal. */
  minutes: number | null;
  at: string | null;
  basis: EtaBasis;
}

export interface TrackRider {
  name: string;
  phone: string;
  location: LatLng | null;
  lastSeenAt: string | null;
  ageSeconds: number | null;
}

export interface Track {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  statusHistory: StatusChange[];
  eta: TrackEta;
  vendor: { id: string; name: string; location: LatLng | null } | null;
  drop: { location: LatLng | null; line1: string; city: string; pincode: string } | null;
  rider: TrackRider | null;
}

export function readTrack(value: unknown): Track | null {
  if (!isDict(value)) return null;
  const orderId = str(value, 'orderId');
  if (orderId === null) return null;

  const status = value['status'];
  const eta = dict(value, 'eta');
  const vendor = dict(value, 'vendor');
  const vendorId = vendor === null ? null : str(vendor, 'id');
  const drop = dict(value, 'drop');
  const rider = dict(value, 'rider');

  return {
    orderId,
    orderNo: str(value, 'orderNo') ?? orderId,
    status: isOrderStatus(status) ? status : 'PLACED',
    statusHistory: compact(list(value, 'statusHistory'), readStatusChange),
    eta: {
      minutes: eta === null ? null : num(eta, 'minutes'),
      at: eta === null ? null : str(eta, 'at'),
      basis: eta !== null && isEtaBasis(eta['basis']) ? eta['basis'] : 'sla',
    },
    vendor:
      vendor === null || vendorId === null
        ? null
        : {
            id: vendorId,
            name: str(vendor, 'name') ?? 'Store',
            location: readLatLng(vendor['location']),
          },
    drop:
      drop === null
        ? null
        : {
            location: readLatLng(drop['location']),
            line1: str(drop, 'line1') ?? '',
            city: str(drop, 'city') ?? '',
            pincode: str(drop, 'pincode') ?? '',
          },
    rider:
      rider === null
        ? null
        : {
            name: str(rider, 'name') ?? 'Your rider',
            phone: str(rider, 'phone') ?? '',
            location: readLatLng(rider['location']),
            lastSeenAt: str(rider, 'lastSeenAt'),
            ageSeconds: num(rider, 'ageSeconds'),
          },
  };
}

/* ═════════════════════════════ checkout ════════════════════════════════ */

export const CHECKOUT_ISSUE_CODES = [
  'OUT_OF_STOCK',
  'REDUCED_QTY',
  'PRICE_CHANGED',
  'UNAVAILABLE',
  'STORE_CLOSED',
  'OUT_OF_SERVICE_AREA',
  'NO_ADDRESS',
  'COD_UNAVAILABLE',
  'COD_LIMIT',
  'COUPON',
] as const;

export type CheckoutIssueCode = (typeof CHECKOUT_ISSUE_CODES)[number];

export interface CheckoutIssue {
  code: CheckoutIssueCode | 'UNKNOWN';
  message: string;
  productId: string | null;
}

export interface PaymentAvailability {
  available: boolean;
  reason: string | null;
}

/** `POST /checkout/validate` → `CheckoutQuote`. The server's own arithmetic. */
export interface CheckoutQuote {
  vendorId: string;
  store: CartStore | null;
  items: CartLine[];
  pricing: OrderPricing;
  coupon: { code: string; discount: number } | null;
  couponProblem: { code: string; message: string } | null;
  address: Address | null;
  delivery: { serviceable: boolean; distanceKm: number | null; radiusKm: number };
  payment: { cod: PaymentAvailability; online: PaymentAvailability };
  issues: CheckoutIssue[];
  checkoutReady: boolean;
}

function isCheckoutIssueCode(value: unknown): value is CheckoutIssueCode {
  return (
    typeof value === 'string' && (CHECKOUT_ISSUE_CODES as readonly string[]).includes(value)
  );
}

function readCheckoutIssue(value: unknown): CheckoutIssue | null {
  if (!isDict(value)) return null;
  const message = str(value, 'message');
  if (message === null) return null;
  return {
    code: isCheckoutIssueCode(value['code']) ? value['code'] : 'UNKNOWN',
    message,
    productId: str(value, 'productId'),
  };
}

function readPaymentAvailability(value: unknown): PaymentAvailability {
  if (!isDict(value)) return { available: false, reason: null };
  return { available: bool(value, 'available') ?? false, reason: str(value, 'reason') };
}

export function readCheckoutQuote(value: unknown): CheckoutQuote | null {
  if (!isDict(value)) return null;
  const vendorId = str(value, 'vendorId');
  if (vendorId === null) return null;

  const pricing = dict(value, 'pricing');
  const coupon = dict(value, 'coupon');
  const couponCode = coupon === null ? null : str(coupon, 'code');
  const couponProblem = dict(value, 'couponProblem');
  const delivery = dict(value, 'delivery');
  const payment = dict(value, 'payment');

  return {
    vendorId,
    store: readCartStore(value['store']),
    items: compact(list(value, 'items'), readCartLine),
    pricing: {
      itemsSubtotal: pricing === null ? 0 : int(pricing, 'itemsSubtotal'),
      discount: pricing === null ? 0 : int(pricing, 'discount'),
      deliveryFee: pricing === null ? 0 : int(pricing, 'deliveryFee'),
      taxes: pricing === null ? 0 : int(pricing, 'taxes'),
      grandTotal: pricing === null ? 0 : int(pricing, 'grandTotal'),
    },
    coupon:
      coupon === null || couponCode === null
        ? null
        : { code: couponCode, discount: int(coupon, 'discount') },
    couponProblem:
      couponProblem === null
        ? null
        : {
            code: str(couponProblem, 'code') ?? 'COUPON',
            message: str(couponProblem, 'message') ?? 'That code did not apply.',
          },
    address: readAddress(value['address']),
    delivery: {
      serviceable: delivery === null ? false : (bool(delivery, 'serviceable') ?? false),
      distanceKm: delivery === null ? null : num(delivery, 'distanceKm'),
      radiusKm: delivery === null ? 0 : int(delivery, 'radiusKm'),
    },
    payment: {
      cod: readPaymentAvailability(payment?.['cod']),
      online: readPaymentAvailability(payment?.['online']),
    },
    issues: compact(list(value, 'issues'), readCheckoutIssue),
    checkoutReady: bool(value, 'checkoutReady') ?? false,
  };
}

/**
 * `POST /checkout` → `{ order, deliveryOtp, payment }`.
 *
 * `deliveryOtp` is the plaintext proof-of-delivery code and this response is
 * the ONLY place it is ever readable — the database stores a hash. If the
 * confirmation screen does not show it, the customer cannot take delivery.
 */
export interface PlacedOrder {
  order: OrderDetail | null;
  deliveryOtp: string | null;
  payment: {
    method: PaymentMethod | null;
    status: string | null;
    next: 'pay_on_delivery' | 'gateway' | null;
  };
  /**
   * The Razorpay order to open Checkout against. TOP-LEVEL, a sibling of
   * `payment` — not a field inside it. `CheckoutService` returns
   * `{ order, deliveryOtp, payment, gatewayOrder }`, and reading this off
   * `payment` instead found `undefined` on every online order, so the
   * sheet could never open.
   *
   * `null` for COD, and also `null` for an ONLINE order whose gateway
   * order could not be created — the order still EXISTS with its stock
   * reserved, so the customer is told payment could not start rather than
   * shown a phantom order.
   *
   * `keyId` is the PUBLIC key, handed over by the server that already
   * holds the secret. Taking it from here rather than from a
   * `NEXT_PUBLIC_` variable keeps ONE source of truth: the two can never
   * drift into a sheet opened against the wrong merchant account.
   */
  gatewayOrder: {
    providerOrderId: string;
    /** INTEGER PAISE — what Razorpay Checkout should charge. */
    amount: number;
    currency: string;
    keyId: string;
  } | null;
}

export function readPlacedOrder(value: unknown): PlacedOrder {
  const emptyPayment = { method: null, status: null, next: null } as const;
  if (!isDict(value)) {
    return { order: null, deliveryOtp: null, payment: emptyPayment, gatewayOrder: null };
  }
  const payment = dict(value, 'payment');
  const next = payment === null ? null : str(payment, 'next');

  return {
    order: readOrderDetail(value['order']),
    deliveryOtp: str(value, 'deliveryOtp'),
    payment: {
      method: payment !== null && isPaymentMethod(payment['method']) ? payment['method'] : null,
      status: payment === null ? null : str(payment, 'status'),
      next: next === 'pay_on_delivery' || next === 'gateway' ? next : null,
    },
    gatewayOrder: readGatewayOrder(value['gatewayOrder']),
  };
}

/**
 * All four fields or nothing. A half-read block would open Checkout
 * against an undefined order id or charge a NaN amount, which is worse
 * than telling the customer online payment could not be started.
 */
function readGatewayOrder(value: unknown): PlacedOrder['gatewayOrder'] {
  if (!isDict(value)) return null;
  const providerOrderId = str(value, 'providerOrderId');
  const amount = num(value, 'amount');
  const currency = str(value, 'currency');
  const keyId = str(value, 'keyId');
  if (providerOrderId === null || amount === null || currency === null || keyId === null) {
    return null;
  }
  return { providerOrderId, amount, currency, keyId };
}

/* ═════════════════════════════ list envelope ═══════════════════════════ */

/**
 * `{ data, meta }` — the envelope every PAGINATED endpoint returns.
 *
 * `/addresses` and `/stores/:id/categories` return BARE ARRAYS and have their
 * own readers above; this one no longer pretends an array is a page, because
 * silently synthesising `meta` from an array hid exactly that difference.
 */
export function readPaged<T>(value: unknown, reader: (item: unknown) => T | null): Paged<T> {
  const source = isDict(value) ? value : null;
  const data = compact(source === null ? [] : list(source, 'data'), reader);
  const meta = source === null ? null : dict(source, 'meta');

  return {
    data,
    meta: {
      page: meta === null ? 1 : (num(meta, 'page') ?? 1),
      limit: meta === null ? data.length : (num(meta, 'limit') ?? data.length),
      total: meta === null ? data.length : (num(meta, 'total') ?? data.length),
      pages: meta === null ? 1 : (num(meta, 'pages') ?? 1),
    },
  };
}

/* ═══════════════════ the PIN-code refusal (400 on browse) ═══════════════ */

/**
 * `GET /stores?pincode=` and `GET /products?pincode=` answer `400` with
 * `errors: { code: 'PINCODE_NOT_SERVICEABLE', pincode, serviceable }` for a
 * PIN this platform cannot resolve.
 *
 * ── WHY THE LIST COMES FROM THE SERVER ──────────────────────────────────────
 * "That PIN is not serviceable" on its own leaves the customer typing six
 * digits at random until one sticks. The other half of the answer is "here is
 * what IS", and the only honest source of that is `pincode-table.ts` on the
 * API — a second copy of the table here would drift the day a city is added,
 * and the UI would then confidently name a city that no longer works (or fail
 * to mention one that does). So the refusal carries the list and this reads it.
 *
 * Returns `null` for any other failure, including a 400 that is not this one:
 * a caller must be able to tell "unserviceable PIN" from "the API is down"
 * without string-matching English prose.
 */
export interface PincodeRefusal {
  pincode: string | null;
  serviceable: { city: string; pincodes: string[] }[];
}

export function readPincodeRefusal(problem: unknown): PincodeRefusal | null {
  if (!isDict(problem)) return null;
  const errors = dict(problem, 'errors');
  if (errors === null || str(errors, 'code') !== 'PINCODE_NOT_SERVICEABLE') return null;

  return {
    pincode: str(errors, 'pincode'),
    serviceable: compact(list(errors, 'serviceable'), (row) => {
      if (!isDict(row)) return null;
      const city = str(row, 'city');
      if (city === null) return null;
      return { city, pincodes: strings(row, 'pincodes') };
    }),
  };
}

/**
 * The machine-readable `code` on any problem body that carries one — the
 * `problem()` helper on the API nests it under `errors` precisely so the
 * client never has to read the sentence.
 *
 * This matters most at 503: `AllExceptionsFilter` replaces the `detail` of
 * every 5xx with "Internal server error" so internals cannot leak, which means
 * a DELIBERATE 503 (`PAYMENT_PROVIDER_NOT_CONFIGURED`) arrives with no usable
 * prose at all. The code survives that scrub; the sentence does not.
 */
export function readProblemCode(problem: unknown): string | null {
  if (!isDict(problem)) return null;
  const errors = dict(problem, 'errors');
  return errors === null ? null : str(errors, 'code');
}
