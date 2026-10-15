/**
 * The shapes the vendor panel reads and writes.
 *
 * ── THE SOURCE OF TRUTH IS THE RUNNING API ──────────────────────────────────
 * Every interface here was transcribed from `apps/api/src/modules/vendor/**`
 * — the service return types and the request DTOs — and verified against live
 * responses. It is NOT a sketch of what the panel would like to receive.
 *
 * If a field is not in this file, the API does not send it. Keeping an
 * invented field "just in case" is what produced
 * `profile.ratingCount.toLocaleString()` on a payload that has no
 * `ratingCount`, and a white screen in place of a dashboard.
 *
 * ── TWO RULES THIS FILE ENCODES ─────────────────────────────────────────────
 *   · EVERY amount is INTEGER PAISE. ₹149.50 is `14950`, never `149.5`.
 *     `<Money value/>` is the only thing that divides.
 *   · Stock lives ONLY on the inventory record. A `VendorProduct` carries a
 *     joined-for-display `stock`; nothing writes through it — the authority is
 *     `PATCH /vendor/inventory/:productId`.
 *
 * ── NULLABILITY IS NOT DECORATION ───────────────────────────────────────────
 * The API emits `string | null` for every date it does not have, and
 * `name: string | null` for a party whose user record was removed. Those nulls
 * are transcribed verbatim so the compiler forces a guard at the point of use.
 */

import type { AisleKey } from '@mandi/design-system';

/* ================================================================== */
/* Envelope                                                            */
/* ================================================================== */

/** `{ data, meta }` — returned by every vendor list endpoint. */
export interface Paged<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; pages: number };
}

/** The inclusive window every range-aware endpoint echoes back. */
export interface ApiRange {
  from: string;
  to: string;
}

/* ================================================================== */
/* Store — GET/PUT /vendor/profile, PATCH /vendor/store/status,        */
/*         PUT /vendor/store/hours, GET /vendor/dashboard              */
/* ================================================================== */

export type VendorStatus = 'pending' | 'approved' | 'suspended';

/** `0 = Sunday`, matching `Date#getDay`. There is no "closed all day" flag: */
/** a day the shop does not open is a day with no row in `openingHours`. */
export interface OpeningHour {
  day: number;
  /** `HH:mm`, 24-hour. */
  open: string;
  close: string;
}

export interface VendorAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

/** Plain lat/lng — NOT GeoJSON. The API converts at its own boundary. */
export interface VendorLocation {
  lat: number;
  lng: number;
}

/** `StoreProfile` in `store.service.ts`. */
export interface VendorProfile {
  id: string;
  storeName: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  address: VendorAddress;
  location: VendorLocation;
  serviceRadiusKm: number;
  /** Admin-set, snapshotted onto every order. Read-only here. */
  commissionPct: number;
  codEnabled: boolean;
  /** INTEGER PAISE. Platform ceiling 200000. */
  codMaxAmount: number;
  isOpen: boolean;
  openingHours: OpeningHour[];
  status: VendorStatus;
  rating: number;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * The body of `PUT /vendor/profile` — `UpdateStoreProfileDto`.
 *
 * `forbidNonWhitelisted` is on, so sending `slug`, `commissionPct`, `status`,
 * `rating`, `isOpen` or `openingHours` here is a 400, not a silent no-op.
 * Hours have their own endpoint; the open/closed switch has another.
 */
export interface VendorProfileUpdate {
  storeName?: string;
  description?: string;
  logoUrl?: string;
  bannerUrl?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  location?: VendorLocation;
  /** Integer, 1–25. */
  serviceRadiusKm?: number;
  codEnabled?: boolean;
  /** INTEGER PAISE, 0–200000. */
  codMaxAmount?: number;
}

/** The body of `PUT /vendor/store/hours`. A full replacement, not a merge. */
export interface VendorHoursUpdate {
  hours: OpeningHour[];
}

/** `StoreStatus` — the reply to `PATCH /vendor/store/status`. */
export interface VendorStoreStatus {
  id: string;
  isOpen: boolean;
  status: VendorStatus;
  updatedAt: string | null;
}

export interface DashboardSparkPoint {
  /** `YYYY-MM-DD`, local time. */
  date: string;
  orders: number;
  /** INTEGER PAISE. */
  revenue: number;
}

/** `VendorDashboard` — the whole home screen in one call. */
export interface VendorDashboard {
  vendorId: string;
  storeName: string;
  isOpen: boolean;
  status: VendorStatus;
  rating: number;
  /** Local midnight of the day these numbers cover, as an ISO instant. */
  today: string;
  ordersToday: {
    total: number;
    byStatus: Record<OrderStatus, number>;
  };
  revenueToday: {
    /** INTEGER PAISE. */
    gross: number;
    itemsSubtotal: number;
    commission: number;
    net: number;
    orderCount: number;
  };
  /** PLACED orders waiting for accept/reject. */
  pendingCount: number;
  inFlightCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  /** Oldest first, last 7 days including today. */
  sparkline: DashboardSparkPoint[];
}

/* ================================================================== */
/* Orders                                                              */
/* ================================================================== */

export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PACKING'
  | 'READY_FOR_PICKUP'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'REJECTED'
  | 'CANCELLED';

export type PaymentMethod = 'online' | 'cod';

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export type ApiRole = 'super_admin' | 'admin' | 'vendor' | 'customer' | 'delivery';

export interface OrderItem {
  productId: string;
  name: string;
  image: string | null;
  unit: string;
  /** INTEGER PAISE, snapshot at order time. */
  price: number;
  qty: number;
  /** INTEGER PAISE — price × qty, as the API computed it. */
  lineTotal: number;
  fulfilled: boolean;
}

/** `OrderPricingRow` — the checkout snapshot plus one convenience alias. */
export interface OrderPricing {
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
  /** Percent. The SNAPSHOT taken at checkout — never re-read. */
  commissionPct: number;
  commissionAmount: number;
  vendorPayout: number;
  /** Equals `grandTotal`. */
  customerTotal: number;
}

/** A customer or a rider on an order row. Every field can be null. */
export interface OrderParty {
  id: string | null;
  name: string | null;
  phone: string | null;
}

/** `OrderRow` — the list payload, and the base of the detail payload. */
export interface VendorOrder {
  id: string;
  orderNo: string;
  status: OrderStatus;
  itemCount: number;
  /** INTEGER PAISE. */
  itemsSubtotal: number;
  grandTotal: number;
  commissionAmount: number;
  vendorPayout: number;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    /** INTEGER PAISE. */
    refundedAmount: number;
  };
  customer: OrderParty;
  deliveryPartner: OrderParty | null;
  placedAt: string | null;
  acceptedAt: string | null;
  readyAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
}

export interface OrderStatusEvent {
  from: OrderStatus | null;
  to: OrderStatus;
  byUserId: string | null;
  byRole: ApiRole | null;
  reason: string | null;
  at: string | null;
}

/** `OrderDetail`. The delivery OTP hash is never serialised. */
export interface VendorOrderDetail extends VendorOrder {
  items: OrderItem[];
  pricing: OrderPricing;
  address: {
    label: string | null;
    line1: string;
    line2: string | null;
    city: string;
    pincode: string;
    location: VendorLocation | null;
    phone: string;
  };
  statusHistory: OrderStatusEvent[];
  cancellation: {
    by: ApiRole | null;
    reason: string | null;
    at: string | null;
  } | null;
  proof: { otpVerifiedAt: string | null; photoUrl: string | null };
}

/** The body of `PATCH /vendor/orders/:id/items` — send EVERY line. */
export interface FulfilmentUpdate {
  items: Array<{ productId: string; fulfilled: boolean }>;
  reason?: string;
}

/** `PartialFulfilmentResult` — what that PATCH returns. */
export interface PartialFulfilmentResult {
  order: VendorOrderDetail;
  /** INTEGER PAISE owed back to the customer. */
  refundDelta: number;
  /** INTEGER PAISE the vendor will no longer be paid. */
  payoutDelta: number;
  droppedLineCount: number;
  ledgerEntryId: string | null;
}

/** The body of `PATCH /vendor/orders/:id/status`. Items do NOT go here. */
export interface OrderStatusUpdate {
  status: OrderStatus;
  /** Required when moving to CANCELLED. */
  reason?: string;
}

/* ================================================================== */
/* Catalogue                                                           */
/* ================================================================== */

export type ProductUnit = 'kg' | 'g' | 'l' | 'ml' | 'piece' | 'pack';

/** `CategoryRow`. `GET /vendor/categories` returns a bare array. */
export interface VendorCategory {
  id: string;
  vendorId: string | null;
  /** `true` when `vendorId` is null — the shared platform taxonomy. */
  isGlobal: boolean;
  name: string;
  slug: string;
  aisleKey: AisleKey;
  parentId: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  createdAt: string | null;
}

/** `ProductRow`. */
export interface VendorProduct {
  id: string;
  vendorId: string;
  categoryId: string;
  categoryName: string | null;
  aisleKey: AisleKey | null;
  name: string;
  slug: string;
  description: string | null;
  images: string[];
  brand: string | null;
  unit: ProductUnit;
  unitValue: number;
  sku: string;
  /** INTEGER PAISE. */
  mrp: number;
  /** INTEGER PAISE. */
  price: number;
  discountPct: number;
  isActive: boolean;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * `CreateProductDto`. `sku` is required on create and ABSENT from the update
 * DTO — a SKU is the vendor's own immutable code, and sending one on a PATCH
 * is a 400.
 */
export interface ProductCreate {
  name: string;
  categoryId: string;
  description?: string;
  images?: string[];
  brand?: string;
  unit: ProductUnit;
  /** Integer ≥ 1, in `unit`. */
  unitValue: number;
  sku: string;
  /** INTEGER PAISE. */
  mrp: number;
  /** INTEGER PAISE, must not exceed `mrp`. */
  price: number;
  openingStock?: number;
  lowStockThreshold?: number;
  isActive?: boolean;
}

/** `UpdateProductDto` — no `sku`, no `openingStock`, no `lowStockThreshold`. */
export type ProductUpdate = Omit<
  ProductCreate,
  'sku' | 'openingStock' | 'lowStockThreshold'
>;

/** What the drawer holds while it is being edited. */
export interface ProductDraft {
  id?: string;
  name: string;
  description: string;
  sku: string;
  brand: string;
  categoryId: string;
  images: string[];
  unit: ProductUnit;
  unitValue: number;
  mrp: number;
  price: number;
  isActive: boolean;
}

/* ================================================================== */
/* Inventory                                                           */
/* ================================================================== */

/** `InventoryRow`. There is no `categoryName`, `unit` or `unitValue` here. */
export interface InventoryRow {
  productId: string;
  vendorId: string;
  name: string;
  sku: string;
  brand: string | null;
  categoryId: string | null;
  aisleKey: AisleKey | null;
  /** INTEGER PAISE. */
  price: number;
  isActive: boolean;
  stock: number;
  reserved: number;
  /** stock − reserved: what a new checkout may actually take. */
  available: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  isOutOfStock: boolean;
  updatedAt: string | null;
}

/**
 * The reasons a VENDOR may cite. `order_reserve`, `order_release` and
 * `order_commit` are written by checkout and delivery and are rejected here —
 * a hand-typed `order_commit` would make the stock trail un-auditable.
 */
export type VendorInventoryReason = 'restock' | 'manual';

/** The body of `PATCH /vendor/inventory/:productId`. A DELTA, never a total. */
export interface InventoryAdjust {
  delta: number;
  reason: VendorInventoryReason;
  note?: string;
  lowStockThreshold?: number;
}

/** The body of `POST /vendor/inventory/bulk` — one transaction for the lot. */
export interface InventoryBulkAdjust {
  adjustments: Array<{
    productId: string;
    delta: number;
    reason?: VendorInventoryReason;
  }>;
  reason?: VendorInventoryReason;
  note?: string;
}

/** `BulkAdjustResult`. */
export interface InventoryBulkResult {
  adjusted: number;
  items: InventoryRow[];
}

/**
 * Every reason an `InventoryLog` row can carry — the vendor's own two
 * (`restock`, `manual`) plus the three the ORDER lifecycle writes
 * (`order_reserve` at checkout, `order_release` on a cancellation or a
 * partial-fulfilment drop, `order_commit` on delivery). `InventoryAdjust`
 * only accepts the first two from a vendor; the log shows all five because
 * the trail is written by every one of them.
 */
export type InventoryLogReason =
  | 'restock'
  | 'manual'
  | 'order_reserve'
  | 'order_release'
  | 'order_commit';

/**
 * `InventoryLogRow` — `GET /vendor/inventory/:productId/logs`, verified
 * against the live response. There is no `note` and no `balanceAfter` — the
 * log is the delta and the reason only; `refId` is the order id for the
 * three order-driven reasons and null for `restock` / `manual`.
 */
export interface InventoryLogRow {
  id: string;
  productId: string;
  vendorId: string;
  /** SIGNED — the change this row made, not a running total. */
  delta: number;
  reason: InventoryLogReason;
  refId: string | null;
  byUserId: string | null;
  at: string;
}

/* ================================================================== */
/* Delivery partners                                                   */
/* ================================================================== */

export type VehicleType = 'bicycle' | 'scooter' | 'motorcycle' | 'ev_scooter';

export type PartnerStatus = 'active' | 'pending' | 'suspended';

/** `PartnerRow`. `GET /vendor/delivery-partners` is PAGINATED. */
export interface VendorPartner {
  id: string;
  userId: string;
  vendorId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  vehicleType: VehicleType;
  status: PartnerStatus;
  statusReason: string | null;
  isOnline: boolean;
  isAvailable: boolean;
  /** The order id only — the API does not join the order number. */
  activeOrderId: string | null;
  completedCount: number;
  rating: number;
  location: VendorLocation | null;
  locationAt: string | null;
  createdAt: string | null;
}

/** `CreatePartnerDto`. The password is 12–128 characters and never read back. */
export interface PartnerDraft {
  name: string;
  /** Exactly 10 digits. */
  phone: string;
  email?: string;
  password: string;
  vehicleType: VehicleType;
}

/** `UpdatePartnerStatusDto` — administrative state, not the online toggle. */
export interface PartnerStatusUpdate {
  status: PartnerStatus;
  reason?: string;
}

/* ================================================================== */
/* Money out                                                           */
/* ================================================================== */

export type LedgerType = 'sale' | 'commission' | 'refund' | 'payout' | 'adjustment';

/** `LedgerRow`. There is no `orderNo` — only the id it points at. */
export interface LedgerEntryRow {
  id: string;
  orderId: string | null;
  type: LedgerType;
  /** SIGNED INTEGER PAISE, from the vendor's point of view. */
  amount: number;
  note: string | null;
  settlementId: string | null;
  at: string | null;
}

export type SettlementStatus = 'pending' | 'processing' | 'paid' | 'failed';

/** `SettlementRow`. */
export interface SettlementRow {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossSales: number;
  totalCommission: number;
  refunds: number;
  netPayable: number;
  orderCount: number;
  status: SettlementStatus;
  paidAt: string | null;
  reference: string | null;
  failureReason: string | null;
}

/**
 * `EarningsSummary` — `GET /vendor/earnings?from=&to=`.
 *
 * gross − commission − refunds = net. There is no `commissionPct`,
 * `averageOrderValue`, `paidOut`, `ledger`, `settlements` or `topProducts` on
 * this payload: the ledger, the settlements and the top products are three
 * separate endpoints, and the average order value is a division the page does.
 */
export interface EarningsSummary {
  range: ApiRange;
  /** INTEGER PAISE. Sum of `itemsSubtotal` over DELIVERED orders. */
  gross: number;
  /** Sum of `commissionAmount` — the SNAPSHOT rate. */
  commission: number;
  /** Refund ledger rows in the window, as a positive magnitude. */
  refunds: number;
  /** gross − commission − refunds. */
  net: number;
  orderCount: number;
  /** INTEGER PAISE across settlements that have not been paid yet. */
  payoutPending: number;
  lastSettlement: {
    id: string;
    periodStart: string | null;
    periodEnd: string | null;
    netPayable: number;
    status: SettlementStatus;
    paidAt: string | null;
  } | null;
}

/* ================================================================== */
/* Reports                                                             */
/* ================================================================== */

/** The server groups by this — there is no `range` parameter anywhere. */
export type SalesGroupBy = 'day' | 'week' | 'month';

export interface SalesBucket {
  /** `2026-09-25`, `2026-W39` or `2026-09`, per `groupBy`. */
  period: string;
  periodStart: string;
  orders: number;
  itemsSold: number;
  /** INTEGER PAISE. */
  gross: number;
  commission: number;
  net: number;
  /** Average order value, INTEGER PAISE. */
  aov: number;
}

/** `SalesReport` — `GET /vendor/reports/sales?from=&to=&groupBy=`. */
export interface SalesReport {
  range: ApiRange;
  groupBy: SalesGroupBy;
  buckets: SalesBucket[];
  totals: {
    orders: number;
    itemsSold: number;
    gross: number;
    commission: number;
    net: number;
    aov: number;
  };
}

export interface TopProductRow {
  productId: string;
  name: string;
  unitsSold: number;
  /** INTEGER PAISE. */
  revenue: number;
  orders: number;
}

/** `TopProductsReport` — `GET /vendor/reports/top-products?from=&to=&limit=`. */
export interface TopProductsReport {
  range: ApiRange;
  products: TopProductRow[];
}

/* ================================================================== */
/* Images                                                              */
/* ================================================================== */

/**
 * `PresignedUpload` — the reply to `POST /vendor/products/:id/images`, whose
 * body is `{ contentType, sizeBytes }`. The byte length is SIGNED into the URL
 * as `content-length`, which is what makes the 5 MB cap real rather than a
 * client-side suggestion.
 */
export interface PresignedUpload {
  uploadUrl: string;
  method: 'PUT';
  /** Must be sent VERBATIM — they are part of the signature. */
  headers: Record<string, string>;
  key: string;
  publicUrl: string;
  expiresAt: string;
  maxBytes: number;
}
