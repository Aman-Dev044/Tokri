/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * Stands in only when `/admin/delivery-partners` cannot be reached; the page
 * shows an amber banner for as long as these are on screen.
 *
 * ── THESE MIRROR THE ENDPOINT, NOT THE SCREEN ───────────────────────────────
 * `RiderRow` is `PartnerRow` and `RiderDetail` is `PartnerDetail`, field for
 * field (apps/api/src/modules/admin/delivery-partners/delivery-partners.service.ts).
 * The first version of this file was written for the screen instead — a
 * `city`, a `lastSeenAt`, an on-time rate — and the screen it described
 * crashed on the first real payload, because none of those exist. If the
 * screen wants a field, the API grows it first and this file follows.
 *
 * Nullable here means nullable there: a rider who has never pinged has no
 * `locationAt`, and one who has never answered an offer has no acceptance
 * rate. Money is INTEGER PAISE.
 */

import type { OrderStatus } from '@/lib/admin/types';

/** The API's `VehicleType` enum, verbatim. */
export type VehicleType = 'bicycle' | 'scooter' | 'motorcycle' | 'ev_scooter';
export type RiderStatus = 'active' | 'suspended' | 'pending';
export type KycStatus = 'not_started' | 'submitted' | 'verified' | 'rejected';
/** The API's `InsuranceStanding` — computed on every read, never stored. */
export type InsuranceStanding = 'not_provided' | 'valid' | 'expiring_soon' | 'expired';

/** `GET /admin/delivery-partners` — one row. */
export interface RiderRow {
  id: string;
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** null ⇒ platform pool rather than a single vendor's fleet */
  vendorId: string | null;
  vendorName: string | null;
  vehicleType: VehicleType;
  isOnline: boolean;
  isAvailable: boolean;
  status: RiderStatus;
  statusReason: string | null;
  completedCount: number;
  /** 0–5; 0 means "not rated yet" */
  rating: number;
  activeOrderId: string | null;
  activeOrderNo: string | null;
  location: { lat: number; lng: number } | null;
  /** the last location ping — the screen's "last seen" */
  locationAt: string | null;
  createdAt: string | null;
  /** The list's insurance flag. No vehicle NUMBER is ever on a list row. */
  vehicleInsuranceStatus: InsuranceStanding;
}

export interface RiderDeliveryRow {
  id: string;
  orderNo: string;
  vendorId: string;
  vendorName: string | null;
  status: OrderStatus;
  pickedUpAt: string | null;
  /** deliveredAt, or when the failure was recorded */
  endedAt: string | null;
  /** pickedUpAt → deliveredAt; null for a failed run */
  runMinutes: number | null;
}

export interface RiderKycDocument {
  kind: 'aadhaar' | 'pan' | 'driving_licence' | 'selfie' | 'vehicle_rc' | 'vehicle_insurance';
  url: string;
  uploadedAt: string;
}

/** The rider surface's own KYC view, plus `breached`. Numbers are MASKED. */
export interface RiderKyc {
  status: KycStatus;
  submittedAt: string | null;
  verifiedAt: string | null;
  rejectedReason: string | null;
  slaDueAt: string | null;
  /** clamped at 0 — read `breached` for "already missed" */
  slaRemainingMs: number | null;
  slaHours: number;
  aadhaarNumberMasked: string | null;
  panNumberMasked: string | null;
  drivingLicenceNumberMasked: string | null;
  /** Masked by the same function as PAN — last four only. */
  vehicleRegistrationNumberMasked: string | null;
  vehicleRcNumberMasked: string | null;
  vehicleInsurancePolicyNumberMasked: string | null;
  /** `YYYY-MM-DD`, the last covered day */
  vehicleInsuranceExpiresOn: string | null;
  vehicleInsuranceStatus: InsuranceStanding;
  /** 0 on the last covered day; negative once expired */
  vehicleInsuranceDaysLeft: number | null;
  documents: RiderKycDocument[];
  canResubmit: boolean;
  breached: boolean;
}

/** `GET /admin/delivery-partners/:id`. */
export interface RiderDetail extends RiderRow {
  performance: {
    deliveredCount: number;
    failedCount: number;
    avgRunMinutes: number | null;
    offers: { accepted: number; rejected: number; expired: number };
    acceptRatePct: number | null;
    /** delivered per week, last 8 weeks, oldest first */
    weeklyDelivered: number[];
  };
  currentAssignment: {
    orderId: string;
    orderNo: string;
    status: OrderStatus;
    customerName: string | null;
    pickup: string | null;
    dropCity: string;
    dropPincode: string;
    assignedAt: string | null;
  } | null;
  deliveries: RiderDeliveryRow[];
  kyc: RiderKyc;
  walletBalancePaise: number;
}

export const VEHICLE_LABEL: Readonly<Record<VehicleType, string>> = {
  bicycle: 'Bicycle',
  scooter: 'Scooter',
  motorcycle: 'Motorcycle',
  ev_scooter: 'EV scooter',
};

/**
 * A vehicle the API added after this map was written still gets a label —
 * humanised from the enum — rather than an empty cell.
 */
export function vehicleLabel(type: string): string {
  const known = (VEHICLE_LABEL as Readonly<Record<string, string>>)[type];
  if (known !== undefined) return known;
  const spaced = type.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const RIDERS_FIXTURE: readonly RiderRow[] = [
  {
    id: 'rdr_01',
    userId: 'usr_r01',
    name: 'Suresh Kumar',
    phone: '9986021174',
    email: null,
    vendorId: 'ven_02',
    vendorName: 'Nandini Fresh, HSR',
    vehicleType: 'ev_scooter',
    isOnline: true,
    isAvailable: false,
    status: 'active',
    statusReason: null,
    completedCount: 1_284,
    rating: 4.9,
    activeOrderId: 'ord_9101',
    activeOrderNo: 'MND-20260924-0517',
    location: { lat: 12.9121, lng: 77.6387 },
    locationAt: '2026-09-24T11:58:00+05:30',
    createdAt: '2025-05-12T10:00:00+05:30',
    vehicleInsuranceStatus: 'valid',
  },
  {
    id: 'rdr_02',
    userId: 'usr_r02',
    name: 'Mohammed Arif',
    phone: '9845133902',
    email: 'arif@example.invalid',
    vendorId: null,
    vendorName: null,
    vehicleType: 'motorcycle',
    isOnline: true,
    isAvailable: true,
    status: 'active',
    statusReason: null,
    completedCount: 872,
    rating: 4.7,
    activeOrderId: null,
    activeOrderNo: null,
    location: { lat: 12.9352, lng: 77.6245 },
    locationAt: '2026-09-24T11:59:00+05:30',
    createdAt: '2025-07-03T09:30:00+05:30',
    vehicleInsuranceStatus: 'valid',
  },
  {
    id: 'rdr_03',
    userId: 'usr_r03',
    name: 'Pravin Jadhav',
    phone: '9822160418',
    email: null,
    vendorId: 'ven_07',
    vendorName: 'Sahyadri Kirana',
    vehicleType: 'scooter',
    isOnline: false,
    isAvailable: false,
    status: 'active',
    statusReason: null,
    completedCount: 2_041,
    rating: 4.8,
    activeOrderId: null,
    activeOrderNo: null,
    location: { lat: 18.5204, lng: 73.8567 },
    locationAt: '2026-09-24T02:14:00+05:30',
    createdAt: '2025-02-20T11:15:00+05:30',
    vehicleInsuranceStatus: 'expiring_soon',
  },
  {
    id: 'rdr_04',
    userId: 'usr_r04',
    name: 'Ramesh Yadav',
    phone: '9930617720',
    email: null,
    vendorId: null,
    vendorName: null,
    vehicleType: 'motorcycle',
    isOnline: true,
    isAvailable: false,
    status: 'active',
    statusReason: null,
    completedCount: 613,
    rating: 4.4,
    activeOrderId: 'ord_9098',
    activeOrderNo: 'MND-20260924-0503',
    location: { lat: 19.076, lng: 72.8777 },
    locationAt: '2026-09-24T11:57:00+05:30',
    createdAt: '2025-09-01T14:00:00+05:30',
    vehicleInsuranceStatus: 'valid',
  },
  {
    id: 'rdr_05',
    userId: 'usr_r05',
    name: 'Bikash Das',
    phone: '9831190255',
    email: null,
    vendorId: 'ven_11',
    vendorName: 'Park Street Provisions',
    vehicleType: 'bicycle',
    isOnline: true,
    isAvailable: true,
    status: 'active',
    statusReason: null,
    completedCount: 164,
    rating: 4.2,
    activeOrderId: null,
    activeOrderNo: null,
    location: { lat: 22.5726, lng: 88.3639 },
    locationAt: '2026-09-24T11:54:00+05:30',
    createdAt: '2026-03-18T08:45:00+05:30',
    vehicleInsuranceStatus: 'not_provided',
  },
  {
    id: 'rdr_06',
    userId: 'usr_r06',
    name: 'Ganesh Pillai',
    phone: '9847128806',
    email: null,
    vendorId: 'ven_05',
    vendorName: 'Marine Drive Mart',
    vehicleType: 'scooter',
    isOnline: false,
    isAvailable: false,
    status: 'suspended',
    statusReason: 'Repeated cash-on-delivery shortfalls',
    completedCount: 47,
    rating: 3.6,
    activeOrderId: null,
    activeOrderNo: null,
    location: null,
    locationAt: null,
    createdAt: '2026-06-02T10:20:00+05:30',
    vehicleInsuranceStatus: 'expired',
  },
  {
    id: 'rdr_07',
    userId: 'usr_r07',
    name: 'Dinesh Solanki',
    phone: '9925170334',
    email: null,
    vendorId: null,
    vendorName: null,
    vehicleType: 'motorcycle',
    isOnline: false,
    isAvailable: false,
    status: 'pending',
    statusReason: null,
    completedCount: 0,
    rating: 0,
    activeOrderId: null,
    activeOrderNo: null,
    location: null,
    locationAt: null,
    createdAt: '2026-09-23T17:08:00+05:30',
    vehicleInsuranceStatus: 'valid',
  },
  {
    id: 'rdr_08',
    userId: 'usr_r08',
    name: 'Venkatesh Rao',
    phone: '9000144820',
    email: null,
    vendorId: 'ven_09',
    vendorName: 'Jubilee Daily Needs',
    vehicleType: 'ev_scooter',
    isOnline: true,
    isAvailable: false,
    status: 'active',
    statusReason: null,
    completedCount: 1_507,
    rating: 4.9,
    activeOrderId: 'ord_9094',
    activeOrderNo: 'MND-20260924-0488',
    location: { lat: 17.4326, lng: 78.4071 },
    locationAt: '2026-09-24T11:59:00+05:30',
    createdAt: '2025-04-11T12:00:00+05:30',
    vehicleInsuranceStatus: 'valid',
  },
];

const DELIVERIES: readonly RiderDeliveryRow[] = [
  {
    id: 'dlv_01',
    orderNo: 'MND-20260924-0498',
    vendorId: 'ven_02',
    vendorName: 'Nandini Fresh, HSR',
    status: 'DELIVERED',
    pickedUpAt: '2026-09-24T10:22:00+05:30',
    endedAt: '2026-09-24T10:41:00+05:30',
    runMinutes: 19,
  },
  {
    id: 'dlv_02',
    orderNo: 'MND-20260924-0455',
    vendorId: 'ven_03',
    vendorName: 'Iyengar Bakery, Koramangala',
    status: 'DELIVERED',
    pickedUpAt: '2026-09-24T09:46:00+05:30',
    endedAt: '2026-09-24T09:58:00+05:30',
    runMinutes: 12,
  },
  {
    id: 'dlv_03',
    orderNo: 'MND-20260923-0619',
    vendorId: 'ven_02',
    vendorName: 'Nandini Fresh, HSR',
    status: 'DELIVERY_FAILED',
    pickedUpAt: '2026-09-23T19:38:00+05:30',
    endedAt: '2026-09-23T20:12:00+05:30',
    runMinutes: null,
  },
  {
    id: 'dlv_04',
    orderNo: 'MND-20260923-0570',
    vendorId: 'ven_04',
    vendorName: 'Green Basket Organics',
    status: 'DELIVERED',
    pickedUpAt: '2026-09-23T17:42:00+05:30',
    endedAt: '2026-09-23T18:04:00+05:30',
    runMinutes: 22,
  },
];

/** The vehicle half of the sample KYC, consistent with the row's flag. */
const SAMPLE_EXPIRY: Readonly<Record<InsuranceStanding, [string | null, number | null]>> = {
  not_provided: [null, null],
  valid: ['2027-06-30', 279],
  expiring_soon: ['2026-10-12', 18],
  expired: ['2026-09-01', -23],
};

function kycFixture(row: RiderRow): RiderKyc {
  // A pending account has sent its documents and is waiting on a human;
  // everyone else in the sample was verified long ago.
  const waiting = row.status === 'pending';
  const insured = row.vehicleInsuranceStatus !== 'not_provided';
  const [expiresOn, daysLeft] = SAMPLE_EXPIRY[row.vehicleInsuranceStatus];
  return {
    status: waiting ? 'submitted' : 'verified',
    submittedAt: waiting ? '2026-09-23T17:20:00+05:30' : '2025-05-12T10:30:00+05:30',
    verifiedAt: waiting ? null : '2025-05-12T16:05:00+05:30',
    rejectedReason: null,
    slaDueAt: waiting ? '2026-09-24T17:20:00+05:30' : null,
    slaRemainingMs: waiting ? 19_200_000 : null,
    slaHours: 24,
    aadhaarNumberMasked: 'XXXX XXXX 4821',
    panNumberMasked: 'XXXXXX907K',
    drivingLicenceNumberMasked: 'XXXXXXXXXXX3310',
    vehicleRegistrationNumberMasked: insured ? 'XXXXXX4417' : null,
    vehicleRcNumberMasked: insured ? 'XXXXXXXXXXX0218' : null,
    vehicleInsurancePolicyNumberMasked: insured ? 'XXXXXXXXXXXXXXXX/001' : null,
    vehicleInsuranceExpiresOn: expiresOn,
    vehicleInsuranceStatus: row.vehicleInsuranceStatus,
    vehicleInsuranceDaysLeft: daysLeft,
    documents: [
      {
        kind: 'aadhaar',
        url: 'https://example.invalid/kyc/aadhaar.jpg',
        uploadedAt: '2026-09-23T17:12:00+05:30',
      },
      {
        kind: 'driving_licence',
        url: 'https://example.invalid/kyc/licence.jpg',
        uploadedAt: '2026-09-23T17:15:00+05:30',
      },
    ],
    canResubmit: waiting,
    breached: false,
  };
}

const UNKNOWN_RIDER: RiderRow = {
  id: 'rdr_unknown',
  userId: 'usr_unknown',
  name: null,
  phone: null,
  email: null,
  vendorId: null,
  vendorName: null,
  vehicleType: 'motorcycle',
  isOnline: false,
  isAvailable: false,
  status: 'pending',
  statusReason: null,
  completedCount: 0,
  rating: 0,
  activeOrderId: null,
  activeOrderNo: null,
  location: null,
  locationAt: null,
  createdAt: null,
  vehicleInsuranceStatus: 'not_provided',
};

export function riderDetailFixture(id: string): RiderDetail {
  const base = RIDERS_FIXTURE.find((r) => r.id === id) ?? RIDERS_FIXTURE[0] ?? UNKNOWN_RIDER;
  const fresh = base.completedCount === 0;

  return {
    ...base,
    id,
    performance: fresh
      ? {
          deliveredCount: 0,
          failedCount: 0,
          avgRunMinutes: null,
          offers: { accepted: 0, rejected: 0, expired: 0 },
          acceptRatePct: null,
          weeklyDelivered: [0, 0, 0, 0, 0, 0, 0, 0],
        }
      : {
          deliveredCount: base.completedCount,
          failedCount: 7,
          avgRunMinutes: 21,
          offers: { accepted: 412, rejected: 38, expired: 16 },
          acceptRatePct: 88.4,
          weeklyDelivered: [38, 44, 41, 52, 49, 58, 55, 61],
        },
    currentAssignment:
      base.activeOrderId === null || base.activeOrderNo === null
        ? null
        : {
            orderId: base.activeOrderId,
            orderNo: base.activeOrderNo,
            status: 'OUT_FOR_DELIVERY',
            customerName: 'Ananya Iyer',
            pickup: base.vendorName,
            dropCity: 'Bengaluru',
            dropPincode: '560102',
            assignedAt: '2026-09-24T11:31:00+05:30',
          },
    deliveries: fresh ? [] : [...DELIVERIES],
    kyc: kycFixture(base),
    walletBalancePaise: fresh ? 0 : 18_500,
  };
}
