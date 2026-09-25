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
