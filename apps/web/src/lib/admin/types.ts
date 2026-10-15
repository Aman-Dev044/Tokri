/**
 * The shapes the admin console reads.
 *
 * These mirror the API contract in IMPLEMENTATION_PLAN §6.2 and the collections
 * in §5.1. They live here rather than in `packages/shared-types` because the
 * admin analytics endpoints are a read-model the API owns; when Worker A's
 * DTOs land in shared-types these become re-exports.
 *
 * ── THE MONEY RULE (plan §5.2) ──────────────────────────────────────────────
 * Every field below whose name ends in `Paise` is an INTEGER number of paise.
 * Never a float, never rupees. Render it with <Money value={...} /> which is
 * the only place in the admin surface that divides by 100.
 */

import type { AisleKey } from '@mandi/design-system';

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

/** Every list endpoint: `{ data, meta }` (plan §6.1). */
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

/**
 * The console draws a line between a plain ADMIN and a SUPER_ADMIN: team
 * management, settlements, settings and the commission editor are super-admin
 * only.
 *
 * Hiding a control is UX. The API's RolesGuard is the enforcement.
 */
export type AdminLevel = 'ADMIN' | 'SUPER_ADMIN';

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export type KpiKey =
  | 'gmv'
  | 'orders'
  | 'aov'
  | 'activeVendors'
  | 'pendingApprovals'
  | 'onlineRiders'
  | 'cancellationRate'
  | 'codShare';

export interface KpiDatum {
  /** paise for money keys, a count for counts, a 0-100 number for rates */
  value: number;
  /**
   * Signed percentage change against the previous window. OPTIONAL: the API
   * reports `null` when the previous window was empty, and "+100% against
   * zero" is not a measurement — the tile then shows the value alone.
   */
  delta?: number;
  /**
   * Trailing series for the sparkline, oldest first. OPTIONAL, because only
   * GMV has a real series behind it; the rest would need an invented one.
   */
  spark?: number[];
}

/**
 * The shape this screen RENDERS, composed from three endpoints by
 * `overview-adapter.ts`. It is not the shape of any single response — see
 * that file for why the two were ever different.
 */
export interface OverviewResponse {
  windowDays: number;
  kpis: Record<KpiKey, KpiDatum>;
  needsAttention: NeedsAttentionItem[];
  recentOrders: RecentOrder[];
}

export interface NeedsAttentionItem {
  id: string;
  /** which queue this is — the key `/admin/ops/summary` counts it under */
  kind: string;
  title: string;
  detail: string;
  /** how urgent — drives the semantic colour, never decoration */
  tone: 'warn' | 'crit' | 'neutral';
  count: number;
  href: string;
  /**
   * When the oldest item in the queue arrived. OPTIONAL, because
   * `/admin/ops/summary` counts queues without timestamping them — the view
   * drops "oldest …" rather than printing a time nobody measured.
   */
  at?: string;
}

export interface RecentOrder {
  id: string;
  orderNo: string;
  vendorName: string;
  customerName: string;
  status: OrderStatus;
  totalPaise: number;
  placedAt: string;
}

export interface TimeseriesPoint {
  /** ISO date, YYYY-MM-DD */
  date: string;
  gmvPaise: number;
  orders: number;
  [key: string]: string | number;
}

export interface OrdersByStatusSlice {
  status: OrderStatus;
  count: number;
}

export interface SalesByAisleRow {
  aisleKey: AisleKey;
  aisle: string;
  gmvPaise: number;
  orders: number;
  [key: string]: string | number;
}

export interface TopVendorRow {
  id: string;
  storeName: string;
  city: string;
  orders: number;
  gmvPaise: number;
}

export interface TopProductRow {
  id: string;
  name: string;
  /** absent when the product's vendor is outside the vendor leaderboard */
  vendorName?: string;
  unitsSold: number;
  gmvPaise: number;
}

/* ------------------------------------------------------------------ */
/* Vendors                                                             */
/* ------------------------------------------------------------------ */

export type VendorStatus = 'pending' | 'approved' | 'suspended';

export interface VendorListRow {
  id: string;
  storeName: string;
  slug: string;
  ownerName: string;
  phone: string;
  city: string;
  status: VendorStatus;
  isOpen: boolean;
  commissionPct: number;
  orders: number;
  gmvPaise: number;
  rating: number;
  createdAt: string;
}

export interface VendorHours {
  day: string;
  open: string;
  close: string;
}

export interface VendorDetail extends VendorListRow {
  description: string;
  address: { line1: string; city: string; state: string; pincode: string };
  /** [lng, lat] — GeoJSON order, same as the DB (plan §5.1) */
  location: { coordinates: [number, number] };
  serviceRadiusKm: number;
  codEnabled: boolean;
  codMaxAmountPaise: number;
  openingHours: VendorHours[];
  earnings: {
    grossPaise: number;
    commissionPaise: number;
    refundsPaise: number;
    netPayablePaise: number;
    lastSettledAt: string | null;
  };
  recentOrders: RecentOrder[];
  products: VendorProductRow[];
}

export interface VendorProductRow {
  id: string;
  name: string;
  aisleKey: AisleKey;
  sku: string;
  pricePaise: number;
  mrpPaise: number;
  stock: number;
  lowStockThreshold: number;
  isActive: boolean;
}

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

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

export type PaymentStatus =
  | 'pending'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export interface OrderListRow {
  id: string;
  orderNo: string;
  vendorId: string;
  vendorName: string;
  customerName: string;
  city: string;
  status: OrderStatus;
  paymentMethod: 'online' | 'cod';
  paymentStatus: PaymentStatus;
  itemCount: number;
  totalPaise: number;
  placedAt: string;
}

export interface OrderStatusEvent {
  from: OrderStatus | null;
  to: OrderStatus;
  byName: string;
  byRole: 'admin' | 'vendor' | 'customer' | 'delivery' | 'system';
  reason?: string;
  at: string;
}

export interface OrderLine {
  productId: string;
  name: string;
  aisleKey: AisleKey;
  unit: string;
  qty: number;
  pricePaise: number;
  lineTotalPaise: number;
  fulfilled: boolean;
}

export interface OrderDetail extends OrderListRow {
  statusHistory: OrderStatusEvent[];
  items: OrderLine[];
  pricing: {
    itemsSubtotalPaise: number;
    discountPaise: number;
    deliveryFeePaise: number;
    taxesPaise: number;
    grandTotalPaise: number;
    commissionPct: number;
    commissionAmountPaise: number;
    vendorPayoutPaise: number;
  };
  payment: {
    method: 'online' | 'cod';
    status: PaymentStatus;
    provider: string;
    providerOrderId: string | null;
    providerPaymentId: string | null;
    paidAt: string | null;
    refundedAmountPaise: number;
  };
  address: {
    label: string;
    line1: string;
    line2?: string;
    city: string;
    pincode: string;
    phone: string;
  };
  rider: {
    id: string;
    name: string;
    phone: string;
    vehicleType: string;
    assignedAt: string;
    completedCount: number;
    rating: number;
  } | null;
  cancellation: { by: string; reason: string; at: string } | null;
}

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  level: AdminLevel;
  status: 'active' | 'suspended';
  /**
   * A system account is created by a migration, owns the audit trail and the
   * scheduled jobs, and cannot be edited or deleted from the UI at all.
   */
  isSystem: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Notifications (top-bar bell)                                        */
/* ------------------------------------------------------------------ */

export interface AdminNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  readAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* ★ OPERATIONS — the ADMIN role's own surface                         */
/* ------------------------------------------------------------------ */

/**
 * These mirror the LIVE `/admin/ops/*` contract, field for field:
 *
 *   GET  /admin/ops/summary            -> OpsSummary
 *   GET  /admin/ops/board?vendorId&q   -> OpsBoardLane[]   ← a BARE ARRAY
 *   GET  /admin/ops/stuck              -> Paginated<OpsStuckOrder>
 *   GET  /admin/ops/dispatch           -> OpsDispatchResponse
 *   POST /admin/ops/dispatch/assign    -> OpsOrderCard  (200, not 201)
 *   POST /admin/ops/dispatch/unassign  -> OpsOrderCard  (200, reason REQUIRED)
 *
 * Two shapes here are easy to get wrong and expensive when you do:
 *
 *   · `/admin/ops/board` is NOT `{data,meta}`. It is five lane objects in a
 *     fixed order, each capped at 50 cards with `truncated` set when the cap
 *     bit. Reading `.data` off it yields `undefined` and an empty board that
 *     looks like a quiet evening.
 *   · `avgAssignMinutes` and `onTimePct` are `number | null` — null means
 *     "nothing to average today", not zero. Render the null case; never print
 *     the word "null" at an operator.
 *
 * Money is INTEGER PAISE (`grandTotal`). Durations are whole MINUTES.
 */

/** The five board lanes, in the order the server returns them. */
export type OpsLaneKey = 'new' | 'preparing' | 'ready' | 'assigned' | 'in_transit';

export const OPS_LANES: readonly OpsLaneKey[] = [
  'new',
  'preparing',
  'ready',
  'assigned',
  'in_transit',
];

/**
 * Fallback labels. The board endpoint sends its own `label` per lane and that
 * one wins; this map exists for the dashboard's live strip, which is built
 * from `summary.liveOrders.byStatus` and therefore has no labels of its own.
 */
export const OPS_LANE_LABEL: Record<OpsLaneKey, string> = {
  new: 'New',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  assigned: 'Assigned',
  in_transit: 'In transit',
};

/**
 * Which statuses collapse into which lane — kept in step with `OPS_LANES` in
 * the API's `sla.util.ts`. Used ONLY to fold `summary.liveOrders.byStatus`
 * into the five lanes for the dashboard strip. The board itself never folds
 * anything: the server decides which lane a card is in.
 */
export const OPS_LANE_STATUSES: Record<OpsLaneKey, readonly OrderStatus[]> = {
  new: ['PLACED'],
  preparing: ['ACCEPTED', 'PACKING'],
  ready: ['READY_FOR_PICKUP'],
  assigned: ['ASSIGNED', 'PICKED_UP'],
  in_transit: ['OUT_FOR_DELIVERY'],
};

/**
 * SLA, as three states rather than a number.
 *
 * ★ NEVER RE-DERIVE `state` ON THE CLIENT. The warning band opens at 80% of
 * the target and `breached` is strictly PAST 100%, so exactly-at-target is a
 * warning, not a breach. Two clients disagreeing about whether an order is
 * late is a support call. Read `state`; use the minutes only for the words.
 */
export type OpsSlaState = 'ok' | 'warning' | 'breached';

export interface OpsSla {
  targetMinutes: number;
  elapsedMinutes: number;
  state: OpsSlaState;
}

/**
 * ONE card shape, shared by the board, the stuck list and the dispatch queue.
 *
 * `vendorName`, `customerName` and `riderName` are nullable: the name lookup
 * is a separate collection and a deleted or unresolvable reference must not
 * take a live order off the board.
 */
export interface OpsOrderCard {
  id: string;
  orderNo: string;
  status: OrderStatus;
  vendorId: string;
  vendorName: string | null;
  customerName: string | null;
  itemCount: number;
  /** INTEGER PAISE */
  grandTotal: number;
  placedAt: string;
  /** whole minutes since the last status transition */
  minutesInStatus: number;
  riderId: string | null;
  riderName: string | null;
  sla: OpsSla;
}

/* ---- GET /admin/ops/summary --------------------------------------- */

export interface OpsNeedsAction {
  pendingVendors: number;
  pendingRiders: number;
  unassignedOrders: number;
  stuckOrders: number;
  failedDeliveries: number;
  openIssues: number;
  lowStockItems: number;
  outOfStockItems: number;
}

export interface OpsStatusCount {
  status: OrderStatus;
  count: number;
}

export interface OpsSummary {
  liveOrders: {
    total: number;
    byStatus: OpsStatusCount[];
  };
  needsAction: OpsNeedsAction;
  dispatch: {
    ridersOnline: number;
    ridersAvailable: number;
    ridersOnDelivery: number;
    /** ready-for-pickup → assigned, averaged over today. `null` = nothing yet. */
    avgAssignMinutes: number | null;
  };
  today: {
    ordersPlaced: number;
    ordersDelivered: number;
    ordersCancelled: number;
    slaBreaches: number;
    /** 0-100, or `null` when nothing has completed today */
    onTimePct: number | null;
  };
}

/* ---- GET /admin/ops/board ----------------------------------------- */

export interface OpsBoardLane {
  lane: OpsLaneKey;
  /** the server's own label — prefer it over OPS_LANE_LABEL */
  label: string;
  orders: OpsOrderCard[];
  /** every order in this lane, not just the ones returned */
  total: number;
  /** true when `total` exceeded the 50-card cap and cards were dropped */
  truncated: boolean;
}

/** The endpoint returns the array itself. There is no envelope. */
export type OpsBoardResponse = OpsBoardLane[];

/* ---- GET /admin/ops/stuck ----------------------------------------- */

export interface OpsStuckOrder extends OpsOrderCard {
  reason: string;
  suggestedAction: string;
  /** minutes BEYOND the threshold for this status, not minutes in it */
  stuckSinceMinutes: number;
}

/* ---- GET /admin/ops/dispatch -------------------------------------- */

export interface OpsNearestRider {
  id: string;
  name: string | null;
  distanceKm: number;
  isAvailable: boolean;
}

export interface OpsUnassignedOrder extends OpsOrderCard {
  /** minutes since the order was packed and ready */
  waitingMinutes: number;
  nearestRiders: OpsNearestRider[];
}

/**
 * A rider on the monitor. There is no single `state` field — availability is
 * three booleans in a trench coat, so `riderState()` below is the ONE place
 * that folds them into a word. Doing it inline at each call site is how two
 * panes end up disagreeing about who is free.
 */
export interface OpsDispatchRider {
  id: string;
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vehicleType: string;
  isOnline: boolean;
  isAvailable: boolean;
  /** ACCOUNT status ('active' | 'suspended'), NOT shift state */
  status: string;
  statusReason: string | null;
  completedCount: number;
  rating: number;
  activeOrderId: string | null;
  location: { lat: number; lng: number } | null;
  locationAt: string | null;
  createdAt: string | null;
  activeOrderNo: string | null;
  minutesOnCurrentJob: number | null;
  distanceToDropKm: number | null;
}

export type OpsRiderState = 'offline' | 'available' | 'on_job';

export function riderState(rider: OpsDispatchRider): OpsRiderState {
  if (!rider.isOnline) return 'offline';
  if (rider.activeOrderId !== null) return 'on_job';
  return rider.isAvailable ? 'available' : 'offline';
}

export interface OpsDispatchResponse {
  unassigned: OpsUnassignedOrder[];
  riders: OpsDispatchRider[];
}

/* ---- POST /admin/ops/dispatch/{assign,unassign} -------------------- */

export interface OpsAssignBody {
  orderId: string;
  /** the DeliveryPartner id, NOT the rider's User id */
  riderId: string;
  /** optional — recorded on the status transition */
  reason?: string;
}

export interface OpsUnassignBody {
  orderId: string;
  /** REQUIRED, 3-500 chars. A 400 without it. */
  reason: string;
}

/** Both writes answer with the updated card. */
export type OpsDispatchResult = OpsOrderCard;

/* ------------------------------------------------------------------ */
/* Audit log (the dashboard's activity feed reads this)                */
/* ------------------------------------------------------------------ */

export interface AuditLogRow {
  id: string;
  actorId: string;
  actorRole: string;
  /** dotted, e.g. `vendor.commission.update` */
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  method: string;
  path: string;
  at: string;
}
