/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * Stands in for `GET /admin/ops/approvals` when the API cannot be reached.
 * Shown only behind the amber <SampleBanner/>; see `_shared-pages/useSourced`.
 *
 * ── THE TYPES BELOW MIRROR THE API, FIELD FOR FIELD ─────────────────────────
 * `VendorApprovalRow` is the API's `VendorRow` and `RiderApprovalRow` is its
 * `PartnerRow`. Both are copied rather than imported: `apps/web` does not
 * depend on `apps/api`, and the shared-types package does not carry the admin
 * read-models yet.
 *
 * TODO: re-export these from `@mandi/shared-types` once Worker A's admin DTOs
 * land there, so a field rename breaks the build instead of a screen.
 *
 * Every nullable field here is nullable in the API too — `location`, `vendorId`,
 * `createdAt` and the partner's name and phone all come back `null` for real
 * records, and a screen that assumes otherwise crashes on the first one.
 *
 * ── WHY THE DATES ARE FROZEN ────────────────────────────────────────────────
 * A fixture computed at module scope from `Date.now()` produces a different
 * string on the server than in the browser, which React reports as a hydration
 * mismatch on a screen that is not even showing real data.
 *
 * Money is INTEGER PAISE (plan §5.2). `codMaxAmount` is a per-order cap.
 */

export type VendorStatus = 'pending' | 'approved' | 'suspended';

/** The API's `VehicleType` enum, verbatim. */
export type VehicleType = 'bicycle' | 'scooter' | 'motorcycle' | 'ev_scooter';

export type PartnerStatus = 'pending' | 'active' | 'suspended';

export interface OpeningHour {
  /** 0 = Sunday, matching `Date#getDay()`. */
  day: number;
  open: string;
  close: string;
}

/** `VendorRow` from `admin/vendors`, which the approvals endpoint reuses. */
export interface VendorApprovalRow {
  id: string;
  ownerId: string;
  storeName: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  address: {
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    pincode: string;
  };
  location: { lat: number; lng: number } | null;
  serviceRadiusKm: number;
  /** Percent, applied to future orders. */
  commissionPct: number;
  codEnabled: boolean;
  /** INTEGER PAISE. */
  codMaxAmount: number;
  isOpen: boolean;
  openingHours: OpeningHour[];
  status: VendorStatus;
  rating: number;
  statusReason: string | null;
  /** Lifetime GMV, INTEGER PAISE. Zero for anything still pending. */
  gmv: number;
  orderCount: number;
  createdAt: string | null;
}

/** `PartnerRow` from `admin/delivery-partners`. */
export interface RiderApprovalRow {
  id: string;
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vehicleType: VehicleType;
  isOnline: boolean;
  isAvailable: boolean;
  status: PartnerStatus;
  statusReason: string | null;
  completedCount: number;
  rating: number;
  activeOrderId: string | null;
  location: { lat: number; lng: number } | null;
  locationAt: string | null;
  createdAt: string | null;
}

export interface ApprovalsPayload {
  vendors: VendorApprovalRow[];
  riders: RiderApprovalRow[];
  /**
   * TOTALS, not the length of the arrays above — the API caps each list at 100.
   * The tabs show these.
   */
  counts: { vendors: number; riders: number };
}

const ALL_WEEK: OpeningHour[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  open: '07:00',
  close: '22:00',
}));

const VENDORS: VendorApprovalRow[] = [
  {
    id: 'sample-vendor-1',
    ownerId: 'sample-owner-1',
    storeName: 'Green Basket Organics',
    slug: 'green-basket-organics',
    description: 'Certified organic produce sourced from farms around Kanakapura.',
    logoUrl: null,
    bannerUrl: null,
    address: {
      line1: '11, 27th Main, HSR Layout Sector 2',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560102',
    },
    location: { lat: 12.9116, lng: 77.6446 },
    serviceRadiusKm: 5,
    commissionPct: 16,
    codEnabled: true,
    codMaxAmount: 200000,
    isOpen: false,
    openingHours: ALL_WEEK,
    status: 'pending',
    rating: 0,
    statusReason: null,
    gmv: 0,
    orderCount: 0,
    createdAt: '2026-03-22T00:00:00.000Z',
  },
  {
    id: 'sample-vendor-2',
    ownerId: 'sample-owner-2',
    storeName: 'Sagar Super Bazaar',
    slug: 'sagar-super-bazaar',
    description: 'Large-format neighbourhood supermarket. Awaiting onboarding approval.',
    logoUrl: null,
    bannerUrl: null,
    address: {
      line1: '42, Hill Road, Bandra West',
      line2: null,
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400050',
    },
    location: { lat: 19.0596, lng: 72.8296 },
    serviceRadiusKm: 5,
    commissionPct: 14,
    codEnabled: true,
    codMaxAmount: 200000,
    isOpen: false,
    openingHours: ALL_WEEK,
    status: 'pending',
    rating: 0,
    statusReason: null,
    gmv: 0,
    orderCount: 0,
    createdAt: '2026-03-11T00:00:00.000Z',
  },
  {
    id: 'sample-vendor-3',
    ownerId: 'sample-owner-3',
    storeName: 'Kadai Kirana Stores',
    slug: 'kadai-kirana-stores',
    description: null,
    logoUrl: null,
    bannerUrl: null,
    address: {
      line1: '92, Bazaar Street, Mylapore',
      line2: null,
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600004',
    },
    // A real record with no pin dropped. The drawer has to say so rather than
    // render "undefined, undefined".
    location: null,
    serviceRadiusKm: 2,
    commissionPct: 15,
    codEnabled: false,
    codMaxAmount: 0,
    isOpen: false,
    openingHours: [
      { day: 1, open: '06:30', close: '20:30' },
      { day: 2, open: '06:30', close: '20:30' },
      { day: 3, open: '06:30', close: '20:30' },
      { day: 4, open: '06:30', close: '20:30' },
      { day: 5, open: '06:30', close: '20:30' },
      { day: 6, open: '07:00', close: '13:00' },
    ],
    status: 'pending',
    rating: 0,
    statusReason: null,
    gmv: 0,
    orderCount: 0,
    createdAt: '2026-09-23T04:18:00.000Z',
  },
];

const RIDERS: RiderApprovalRow[] = [
  {
    id: 'sample-rider-1',
    userId: 'sample-user-1',
    name: 'Imran Qureshi',
    phone: '9731100455',
    email: null,
    vendorId: 'sample-vendor-1',
    vendorName: 'Green Basket Organics',
    vehicleType: 'motorcycle',
    isOnline: false,
    isAvailable: false,
    status: 'pending',
    statusReason: null,
    completedCount: 0,
    rating: 0,
    activeOrderId: null,
    location: null,
    locationAt: null,
    createdAt: '2026-09-22T09:30:00.000Z',
  },
  {
    id: 'sample-rider-2',
    userId: 'sample-user-2',
    name: 'Deepak Yadav',
    phone: '9955441122',
    email: 'deepak.y@demo.mandi.app',
    vendorId: null,
    vendorName: null,
    vehicleType: 'ev_scooter',
    isOnline: false,
    isAvailable: false,
    status: 'pending',
    statusReason: null,
    completedCount: 0,
    rating: 0,
    activeOrderId: null,
    location: null,
    locationAt: null,
    createdAt: '2026-09-23T07:02:00.000Z',
  },
];

export const APPROVALS_FIXTURE: ApprovalsPayload = {
  vendors: VENDORS,
  riders: RIDERS,
  counts: { vendors: VENDORS.length, riders: RIDERS.length },
};

export const VEHICLE_LABEL: Record<VehicleType, string> = {
  bicycle: 'Bicycle',
  scooter: 'Scooter',
  motorcycle: 'Motorcycle',
  ev_scooter: 'Electric scooter',
};

const DAY_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Seven identical rows compressed to "Mon–Sun 07:00–22:00".
 *
 * The API sends one entry per open day, so a store that keeps the same hours
 * all week arrives as seven repetitions. Printing them verbatim buries the one
 * thing that matters — whether the hours are plausible — under six duplicates.
 */
export function summariseHours(hours: readonly OpeningHour[]): string {
  if (hours.length === 0) return 'No opening hours set';

  const first = hours[0];
  if (first === undefined) return 'No opening hours set';

  const uniform = hours.every(
    (entry) => entry.open === first.open && entry.close === first.close,
  );
  const window = `${first.open}–${first.close}`;

  if (!uniform) {
    return hours
      .map((entry) => `${DAY_NAME[entry.day] ?? entry.day} ${entry.open}–${entry.close}`)
      .join(', ');
  }

  if (hours.length === 7) return `Every day, ${window}`;

  const days = [...hours]
    .map((entry) => entry.day)
    .sort((a, b) => a - b)
    .map((day) => DAY_NAME[day] ?? String(day));
  return `${days.join(', ')}, ${window}`;
}
