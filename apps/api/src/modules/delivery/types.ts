import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../common/constants/order-status.enum';
import {
  PartnerStatus,
  VehicleType,
} from '../../database/schemas/delivery-partner.schema';

/**
 * The rider app's response shapes.
 *
 * Every id is a string, every timestamp an ISO-8601 string, every money
 * field INTEGER PAISE with a `Paise` suffix on the name. The suffix is
 * not decoration: `total: 14950` and `total: 149.5` look identical in a
 * JSON body, and the rider app displaying one as the other is exactly the
 * class of bug §5.2 exists to prevent.
 */

export interface LatLngDto {
  lat: number;
  lng: number;
}

export interface RiderTodayStats {
  deliveries: number;
  /** Integer paise earned from deliveries completed today. */
  earningsPaise: number;
  /**
   * Minutes socket-connected today.
   *
   * Measured from the live socket, so it is honest about presence rather
   * than about the `isOnline` flag — a rider whose app is closed is not
   * online however the flag was left. See `RiderPresenceRegistry` for why
   * it resets when the API process restarts.
   */
  onlineMinutes: number;
}

export interface RiderProfile {
  partnerId: string;
  userId: string;
  name: string;
  phone: string;
  vendorId: string | null;
  vehicleType: VehicleType;
  status: PartnerStatus;
  isOnline: boolean;
  isAvailable: boolean;
  rating: number;
  completedCount: number;
  activeOrderId: string | null;
  currentLocation: LatLngDto | null;
  locationAt: string | null;
  socketConnected: boolean;
  today: RiderTodayStats;
}

export interface Waypoint {
  label: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

export interface OfferRow {
  /** The DeliveryAssignment id — what `/offers/:id/accept` takes. */
  id: string;
  orderId: string;
  orderNo: string;
  attemptNo: number;
  offeredAt: string;
  expiresAt: string;
  /** Milliseconds left, so the app can run a countdown without a clock skew. */
  expiresInMs: number;
  pickup: Waypoint;
  drop: Waypoint;
  distanceKm: number | null;
  itemCount: number;
  /** Cash to collect at the door, integer paise. 0 for a prepaid order. */
  codAmountPaise: number;
  payoutPaise: number;
}

export interface ActiveOrderItem {
  name: string;
  qty: number;
  unit: string;
  image: string | null;
}

export interface OtpState {
  attemptsUsed: number;
  attemptsRemaining: number;
  /** True once the cap is hit: only an admin can move this order now. */
  locked: boolean;
}

export interface ActiveOrder {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  assignmentId: string | null;
  placedAt: string;
  pickup: Waypoint;
  drop: Waypoint;
  /** The delivery contact from the order address — the rider needs to call. */
  customerName: string | null;
  customerPhone: string;
  items: ActiveOrderItem[];
  itemCount: number;
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    /** Cash to collect, integer paise. 0 unless this is an unpaid COD order. */
    codAmountPaise: number;
  };
  distanceKm: number | null;
  etaMinutes: number | null;
  payoutPaise: number;
  otp: OtpState;
}

export interface DeliveryHistoryRow {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  /** Null for a failed attempt, which never reached a delivery time. */
  deliveredAt: string | null;
  city: string;
  pincode: string;
  distanceKm: number | null;
  payoutPaise: number;
  codCollectedPaise: number;
}

export interface EarningsDay {
  /** `YYYY-MM-DD`. */
  date: string;
  deliveries: number;
  payoutPaise: number;
}

export interface EarningsSummary {
  from: string;
  to: string;
  deliveries: number;
  payoutPaise: number;
  /** Cash the rider took in and owes the platform, integer paise. */
  codCollectedPaise: number;
  byDay: EarningsDay[];
}

export interface LocationAck {
  accepted: true;
  at: string;
  orderId: string;
  etaMinutes: number | null;
}

// ══════════════════════════════════════════════════════════════════════
//  WALLET
// ══════════════════════════════════════════════════════════════════════

/** `GET /delivery/wallet`. Every money field is INTEGER PAISE. */
export interface WalletSummary {
  balancePaise: number;
  /** `balancePaise <= warnThresholdPaise`. Computed here, never client-side. */
  lowBalance: boolean;
  warnThresholdPaise: number;
  lifetimeEarnedPaise: number;
  lifetimeToppedUpPaise: number;
  lifetimeSpentPaise: number;
  /** Lifetime completed deliveries — `DeliveryPartner.completedCount`. */
  totalDelivered: number;
  /**
   * The bounds the per-order pick fee is drawn from.
   *
   * Exposed so the confirm screen can state the charge HONESTLY before
   * the rider taps accept. The exact fee is drawn at accept time (§1.5),
   * so the only truthful thing to show beforehand is the range — and
   * showing nothing at all would mean the rider discovers the charge
   * after the money has gone, which is the thing this must never do.
   */
  pickFeeMinPaise: number;
  pickFeeMaxPaise: number;
}

/** One row of `GET /delivery/wallet/transactions`. */
export interface WalletLedgerRow {
  id: string;
  /** `WalletTxnType` — topup | pick_fee | earning | adjustment | refund. */
  type: string;
  /** SIGNED integer paise: positive credits, negative debits. */
  amountPaise: number;
  balanceAfterPaise: number;
  orderId: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

/** `POST /delivery/wallet/topup`. `null` while the gateway has no keys. */
export interface WalletTopupResponse {
  /** Our own wallet top-up order id — what `/topup/:orderId/verify` takes. */
  topupId: string;
  amountPaise: number;
  gatewayOrder: {
    providerOrderId: string;
    /** Integer paise, echoed from the gateway. */
    amount: number;
    currency: 'INR';
    /** The PUBLIC key id. The secret never leaves the server. */
    keyId: string;
  } | null;
}

// ══════════════════════════════════════════════════════════════════════
//  KYC
// ══════════════════════════════════════════════════════════════════════

export interface KycDocumentRow {
  /** `KycDocumentKind` — aadhaar | pan | driving_licence | selfie. */
  kind: string;
  url: string;
  uploadedAt: string;
}

/**
 * `GET /delivery/profile/kyc`.
 *
 * The three identifier fields are MASKED (`XXXX XXXX 1234`) or null.
 * The full numbers exist on exactly one endpoint in this platform,
 * `GET /admin/riders/:id/kyc`, and this is not it.
 */
export interface RiderKycView {
  /** `KycStatus` — not_started | submitted | verified | rejected. */
  status: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectedReason: string | null;
  /** The verification deadline while SUBMITTED. */
  slaDueAt: string | null;
  /** Milliseconds until `slaDueAt`, clamped at 0. For the countdown. */
  slaRemainingMs: number | null;
  /** The promise, in hours — `RIDER_KYC_SLA_HOURS`. */
  slaHours: number;
  aadhaarNumberMasked: string | null;
  panNumberMasked: string | null;
  drivingLicenceNumberMasked: string | null;
  documents: KycDocumentRow[];
  /** False once VERIFIED: a verified rider may not overwrite their identity. */
  canResubmit: boolean;
}

// ══════════════════════════════════════════════════════════════════════
//  THE OFFER CONFIRM SCREEN
// ══════════════════════════════════════════════════════════════════════

/**
 * `GET /delivery/offers/:id` — everything the rider must see BEFORE the
 * money moves: what was ordered, where it goes, and what accepting costs.
 */
export interface OfferDetail extends OfferRow {
  items: ActiveOrderItem[];
  /** The bounds the fee will be drawn from, integer paise. */
  pickFeeMinPaise: number;
  pickFeeMaxPaise: number;
  /** The rider's balance right now, so the screen can pre-empt a 402. */
  walletBalancePaise: number;
  /** False when the balance cannot cover even the cheapest possible draw. */
  canAfford: boolean;
  /** `KycStatus`. Accepting is refused unless this is `verified`. */
  kycStatus: string;
}

// ══════════════════════════════════════════════════════════════════════
//  LIVE TRACKING
// ══════════════════════════════════════════════════════════════════════

/**
 * `GET /delivery/orders/:id/tracking` — the Ola/Uber-style view.
 *
 * Both parties on one map: where the rider is right now, where the
 * customer is, where the store is, plus the items being carried.
 */
export interface DeliveryTracking {
  orderId: string;
  orderNo: string;
  status: OrderStatus;
  /** The rider's last reported position, or null if they have never pinged. */
  rider: (LatLngDto & { at: string }) | null;
  pickup: Waypoint;
  drop: Waypoint;
  /** Straight-line distance from the rider to the drop, km. */
  remainingKm: number | null;
  etaMinutes: number | null;
  items: ActiveOrderItem[];
  itemCount: number;
  customerName: string | null;
  customerPhone: string;
  codAmountPaise: number;
}

/**
 * `POST /delivery/offers/:id/accept`.
 *
 * The active order AND what it just cost. The fee is reported in the
 * same response that creates the charge, so the rider sees the number
 * the instant the money moves rather than discovering it later in a
 * ledger — the whole reason this is not simply `ActiveOrder`.
 */
export interface AcceptedOffer {
  order: ActiveOrder | null;
  /** The randomly drawn fee actually charged, integer paise. */
  pickFeePaise: number;
  /** The balance after the charge, integer paise. */
  walletBalancePaise: number;
}
