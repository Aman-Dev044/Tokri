/**
 * The shapes the vendor panel reads and writes.
 *
 * Transcribed from plan §5.1 (collections) and §6.2 (the VENDOR endpoint
 * block). Worker A is building those endpoints in parallel, so this file is the
 * contract both sides are coding against — not a description of something that
 * already exists.
 *
 * ── TWO RULES THIS FILE ENCODES ─────────────────────────────────────────────
 *   · EVERY amount is INTEGER PAISE (plan §5.2). A grand total of ₹149.50 is
 *     `14950`, never `149.5`. `<Money value/>` is the only thing that divides.
 *   · Stock lives ONLY on the inventory record, never on the product. A
 *     `VendorProduct` carries stock as an optional joined-for-display field and
 *     nothing writes through it — the authority is `PATCH /vendor/inventory`.
 */

import type { AisleKey } from '@mandi/design-system';

/* ================================================================== */
/* Envelope                                                            */
/* ================================================================== */

/** Every list endpoint returns this (plan §6.1). */
export interface Paged<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; pages: number };
}

/* ================================================================== */
/* Store                                                               */
/* ================================================================== */

export type VendorStatus = 'pending' | 'approved' | 'suspended';

export interface OpeningHour {
  /** 0 = Sunday … 6 = Saturday, matching Date#getDay */
  day: number;
  /** "HH:mm", 24h */
  open: string;
  close: string;
  /** a day the shop does not open at all */
  closed?: boolean;
}

export interface VendorAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface VendorProfile {
  id: string;
  storeName: string;
  slug: string;
  description: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  phone: string;
  address: VendorAddress;
  /** GeoJSON order — [lng, lat]. Reversing this is the classic map bug. */
  location: { type: 'Point'; coordinates: [number, number] };
  serviceRadiusKm: number;
  /** admin-set, copied onto every order at creation. Read-only here. */
  commissionPct: number;
  codEnabled: boolean;
  /** INTEGER PAISE */
  codMaxAmount: number;
  isOpen: boolean;
  openingHours: OpeningHour[];
  status: VendorStatus;
  rating: number;
  ratingCount: number;
}

/** What the settings form may actually send. Note what is absent. */
export type VendorProfileUpdate = Omit<
  VendorProfile,
  'id' | 'slug' | 'commissionPct' | 'status' | 'rating' | 'ratingCount' | 'isOpen'
>;

/* ================================================================== */
/* Orders                                                              */
/* ================================================================== */

/** plan §5.3 — the backend is the only authority; this is just the vocabulary. */
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

export interface OrderItem {
  productId: string;
  name: string;
  image: string | null;
  unit: string;
  /** INTEGER PAISE, snapshot at order time */
  price: number;
  qty: number;
  /** INTEGER PAISE — price x qty, as the API computed it */
  lineTotal: number;
  /**
   * Whether this line is actually going in the bag. Unticking it is the
   * partial-fulfilment flow on the detail screen.
   */
  fulfilled: boolean;
}

export interface OrderPricing {
  itemsSubtotal: number;
  discount: number;
  deliveryFee: number;
  taxes: number;
  grandTotal: number;
  /** SNAPSHOT at creation — not today's rate (plan §5.1) */
  commissionPct: number;
  commissionAmount: number;
  /** itemsSubtotal − commissionAmount */
  vendorPayout: number;
}

export interface OrderStatusEvent {
  from: OrderStatus | null;
  to: OrderStatus;
  byRole: string;
  byName?: string;
  reason?: string;
  at: string;
}

/** A card on the board. Deliberately smaller than the detail payload. */
export interface VendorOrder {
  id: string;
  /** MND-20260924-0001 */
  orderNo: string;
  status: OrderStatus;
  customerName: string;
  customerPhone: string;
  itemCount: number;
  /** INTEGER PAISE */
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  placedAt: string;
  acceptedAt?: string | null;
  etaMinutes?: number | null;
  partnerName?: string | null;
  /** first few lines, for the card — the full list is on the detail */
  preview: Array<{ name: string; qty: number }>;
}

export interface VendorOrderDetail extends VendorOrder {
  items: OrderItem[];
  pricing: OrderPricing;
  address: {
    label: string;
    line1: string;
    line2?: string;
    city: string;
    pincode: string;
    phone: string;
  };
  statusHistory: OrderStatusEvent[];
  deliveryPartnerId?: string | null;
  note?: string | null;
}

/* ================================================================== */
/* Catalogue                                                           */
/* ================================================================== */

export type ProductUnit = 'kg' | 'g' | 'l' | 'ml' | 'piece' | 'pack';

export interface VendorCategory {
  id: string;
  name: string;
  slug: string;
  aisleKey: AisleKey;
  isActive: boolean;
  productCount: number;
}

export interface VendorProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  sku: string;
  brand: string;
  categoryId: string;
  categoryName: string;
  aisleKey: AisleKey;
  images: string[];
  unit: ProductUnit;
  unitValue: number;
  /** INTEGER PAISE */
  mrp: number;
  /** INTEGER PAISE */
  price: number;
  discountPct: number;
  isActive: boolean;
  createdAt: string;
  /** joined from inventory for the table — display only, never written here */
  stock?: number;
  lowStockThreshold?: number;
}

/** The create/edit body. `id` absent means create. */
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

export interface InventoryRow {
  productId: string;
  name: string;
  sku: string;
  aisleKey: AisleKey;
  categoryName: string;
  /** authoritative available count */
  stock: number;
  /** held by in-flight checkouts — sellable = stock − reserved */
  reserved: number;
  lowStockThreshold: number;
  unit: ProductUnit;
  unitValue: number;
  price: number;
  isActive: boolean;
  updatedAt: string;
}

/** plan §5.1 — the only reasons the API records. */
export type InventoryReason =
  | 'restock'
  | 'order_reserve'
  | 'order_release'
  | 'order_commit'
  | 'manual';

export interface InventoryLogEntry {
  id: string;
  productId: string;
  /** signed: +40 is a restock, −2 is a sale */
  delta: number;
  reason: InventoryReason;
  refId: string | null;
  byName: string;
  at: string;
  /** resulting stock after the delta, when the API records it */
  balance?: number;
}

/** The body of PATCH /vendor/inventory/:productId. A DELTA, never a total. */
export interface InventoryAdjust {
  delta: number;
  reason: InventoryReason;
}

/* ================================================================== */
/* Delivery partners                                                   */
/* ================================================================== */

export type VehicleType = 'bike' | 'scooter' | 'bicycle' | 'van' | 'foot';

export interface VendorPartner {
  id: string;
  name: string;
  phone: string;
  vehicleType: VehicleType;
  isOnline: boolean;
  isAvailable: boolean;
  completedCount: number;
  rating: number;
  activeOrderId: string | null;
  activeOrderNo: string | null;
  lastSeenAt: string | null;
}

export interface PartnerDraft {
  name: string;
  phone: string;
  vehicleType: VehicleType;
  /** sent once, at creation. Never read back. */
  password: string;
}

/* ================================================================== */
/* Money out                                                           */
/* ================================================================== */

export type LedgerType = 'sale' | 'commission' | 'refund' | 'payout' | 'adjustment';

export interface LedgerEntryRow {
  id: string;
  orderId: string | null;
  orderNo: string | null;
  type: LedgerType;
  /** SIGNED INTEGER PAISE. A commission is negative. */
  amount: number;
  settlementId: string | null;
  createdAt: string;
}

export type SettlementStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface SettlementRow {
  id: string;
  periodStart: string;
  periodEnd: string;
  grossSales: number;
  totalCommission: number;
  refunds: number;
  netPayable: number;
  status: SettlementStatus;
  paidAt: string | null;
  reference: string | null;
}

export type EarningsRange = 'day' | 'week' | 'month';

/**
 * The earnings payload.
 *
 * gross − commission − refunds = net. The page prints that as an equation
 * rather than three unrelated tiles, because "where did my money go" is the
 * only question a shop owner opens this screen to answer.
 */
export interface EarningsSummary {
  range: EarningsRange;
  grossSales: number;
  commissionPct: number;
  totalCommission: number;
  refunds: number;
  netEarnings: number;
  orderCount: number;
  /** INTEGER PAISE */
  averageOrderValue: number;
  /** already settled and paid out, within the range */
  paidOut: number;
  /** earned, not yet in a paid settlement */
  pendingPayout: number;
  ledger: LedgerEntryRow[];
  settlements: SettlementRow[];
  topProducts: Array<{ productId: string; name: string; units: number; revenue: number }>;
}

/* ================================================================== */
/* Reports                                                             */
/* ================================================================== */

export interface SalesPoint {
  /** ISO date, or an ISO instant for an hourly bucket */
  bucket: string;
  /** INTEGER PAISE */
  revenue: number;
  orders: number;
}

export interface SalesReport {
  granularity: EarningsRange;
  points: SalesPoint[];
  /** INTEGER PAISE */
  total: number;
  orders: number;
}

/* ================================================================== */
/* Images                                                              */
/* ================================================================== */

/** Response of POST /vendor/products/:id/images (plan §6.2). */
export interface PresignedUpload {
  /** the S3 URL to PUT the bytes to */
  uploadUrl: string;
  /** the URL the image will be readable at afterwards */
  publicUrl: string;
  /** exact Content-Type the signature was computed over */
  contentType: string;
  expiresIn?: number;
}
