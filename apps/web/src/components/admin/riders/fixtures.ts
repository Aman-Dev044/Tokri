/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * Stands in only when `/admin/delivery-partners` cannot be reached; the page
 * shows an amber banner for as long as these are on screen.
 *
 * Mirrors the `DeliveryPartner` collection (plan §5.1) joined onto its `User`:
 * `isOnline` / `isAvailable` come from the partner doc, `status` from the user.
 * Money is INTEGER PAISE.
 */

import type { OrderStatus } from '@/lib/admin/types';

export type VehicleType = 'cycle' | 'scooter' | 'bike' | 'ev_scooter' | 'van';
export type RiderStatus = 'active' | 'suspended' | 'pending';

export interface RiderRow {
  id: string;
  name: string;
  phone: string;
  vehicleType: VehicleType;
  /** null ⇒ platform pool rather than a single vendor's fleet */
  vendorId: string | null;
  vendorName: string | null;
  isOnline: boolean;
  isAvailable: boolean;
  activeOrderId: string | null;
  activeOrderNo: string | null;
  completedCount: number;
  /** 0–5, one decimal */
  rating: number;
  status: RiderStatus;
  city: string;
  lastSeenAt: string;
}

export interface RiderDeliveryRow {
  id: string;
  orderNo: string;
  vendorName: string;
  status: OrderStatus;
  distanceKm: number;
  minutes: number;
  earnedPaise: number;
  deliveredAt: string;
}

export interface RiderDetail extends RiderRow {
  joinedAt: string;
  performance: {
    onTimePct: number;
    avgMinutes: number;
    acceptRatePct: number;
    failedCount: number;
    earningsPaise: number;
    /** trailing weekly completed count, oldest first */
    spark: number[];
  };
  currentAssignment: {
    orderNo: string;
    orderId: string;
    status: OrderStatus;
    customerName: string;
    pickup: string;
    dropCity: string;
    dropPincode: string;
    assignedAt: string;
    etaMinutes: number;
  } | null;
  deliveries: RiderDeliveryRow[];
}

export const VEHICLE_LABEL: Readonly<Record<VehicleType, string>> = {
  cycle: 'Cycle',
  scooter: 'Scooter',
  bike: 'Motorcycle',
  ev_scooter: 'EV scooter',
  van: 'Van',
};

export const RIDERS_FIXTURE: readonly RiderRow[] = [
  {
    id: 'rdr_01',
    name: 'Suresh Kumar',
    phone: '+91 99860 21174',
    vehicleType: 'ev_scooter',
    vendorId: 'ven_02',
    vendorName: 'Nandini Fresh, HSR',
    isOnline: true,
    isAvailable: false,
    activeOrderId: 'ord_9101',
    activeOrderNo: 'MND-20260924-0517',
    completedCount: 1_284,
    rating: 4.9,
    status: 'active',
    city: 'Bengaluru',
    lastSeenAt: '2026-09-24T11:58:00+05:30',
  },
  {
    id: 'rdr_02',
    name: 'Mohammed Arif',
    phone: '+91 98451 33902',
    vehicleType: 'bike',
    vendorId: null,
    vendorName: null,
    isOnline: true,
    isAvailable: true,
    activeOrderId: null,
    activeOrderNo: null,
    completedCount: 872,
    rating: 4.7,
    status: 'active',
    city: 'Bengaluru',
    lastSeenAt: '2026-09-24T11:59:00+05:30',
  },
  {
    id: 'rdr_03',
    name: 'Pravin Jadhav',
    phone: '+91 98221 60418',
    vehicleType: 'scooter',
    vendorId: 'ven_07',
    vendorName: 'Sahyadri Kirana',
    isOnline: false,
    isAvailable: false,
    activeOrderId: null,
    activeOrderNo: null,
    completedCount: 2_041,
    rating: 4.8,
    status: 'active',
    city: 'Pune',
    lastSeenAt: '2026-09-24T02:14:00+05:30',
  },
  {
    id: 'rdr_04',
    name: 'Ramesh Yadav',
    phone: '+91 99306 17720',
    vehicleType: 'bike',
    vendorId: null,
    vendorName: null,
    isOnline: true,
    isAvailable: false,
    activeOrderId: 'ord_9098',
    activeOrderNo: 'MND-20260924-0503',
    completedCount: 613,
    rating: 4.4,
    status: 'active',
    city: 'Mumbai',
    lastSeenAt: '2026-09-24T11:57:00+05:30',
  },
  {
    id: 'rdr_05',
    name: 'Bikash Das',
    phone: '+91 98311 90255',
    vehicleType: 'cycle',
    vendorId: 'ven_11',
    vendorName: 'Park Street Provisions',
    isOnline: true,
    isAvailable: true,
    activeOrderId: null,
    activeOrderNo: null,
    completedCount: 164,
    rating: 4.2,
    status: 'active',
    city: 'Kolkata',
    lastSeenAt: '2026-09-24T11:54:00+05:30',
  },
  {
    id: 'rdr_06',
    name: 'Ganesh Pillai',
    phone: '+91 98471 28806',
    vehicleType: 'scooter',
    vendorId: 'ven_05',
    vendorName: 'Marine Drive Mart',
    isOnline: false,
    isAvailable: false,
    activeOrderId: null,
    activeOrderNo: null,
    completedCount: 47,
    rating: 3.6,
    status: 'suspended',
    city: 'Kochi',
    lastSeenAt: '2026-08-30T19:41:00+05:30',
  },
  {
    id: 'rdr_07',
    name: 'Harpreet Singh',
    phone: '+91 98720 55193',
    vehicleType: 'van',
    vendorId: null,
    vendorName: null,
    isOnline: true,
    isAvailable: true,
    activeOrderId: null,
    activeOrderNo: null,
    completedCount: 398,
    rating: 4.6,
    status: 'active',
    city: 'Chandigarh',
    lastSeenAt: '2026-09-24T11:52:00+05:30',
  },
  {
    id: 'rdr_08',
    name: 'Venkatesh Rao',
    phone: '+91 90001 44820',
    vehicleType: 'ev_scooter',
    vendorId: 'ven_09',
    vendorName: 'Jubilee Daily Needs',
    isOnline: true,
    isAvailable: false,
    activeOrderId: 'ord_9094',
    activeOrderNo: 'MND-20260924-0488',
    completedCount: 1_507,
    rating: 4.9,
    status: 'active',
    city: 'Hyderabad',
    lastSeenAt: '2026-09-24T11:59:00+05:30',
  },
  {
    id: 'rdr_09',
    name: 'Dinesh Solanki',
    phone: '+91 99251 70334',
    vehicleType: 'bike',
    vendorId: null,
    vendorName: null,
    isOnline: false,
    isAvailable: false,
    activeOrderId: null,
    activeOrderNo: null,
    completedCount: 0,
    rating: 0,
    status: 'pending',
    city: 'Ahmedabad',
    lastSeenAt: '2026-09-23T17:08:00+05:30',
  },
  {
    id: 'rdr_10',
    name: 'Selvam Murugan',
    phone: '+91 94441 30672',
    vehicleType: 'scooter',
    vendorId: 'ven_13',
    vendorName: 'T. Nagar Grocers',
    isOnline: true,
    isAvailable: true,
    activeOrderId: null,
    activeOrderNo: null,
    completedCount: 921,
    rating: 4.5,
    status: 'active',
    city: 'Chennai',
    lastSeenAt: '2026-09-24T11:56:00+05:30',
  },
  {
    id: 'rdr_11',
    name: 'Anil Rawat',
    phone: '+91 97112 04487',
    vehicleType: 'bike',
    vendorId: null,
    vendorName: null,
    isOnline: false,
    isAvailable: false,
    activeOrderId: null,
    activeOrderNo: null,
    completedCount: 742,
    rating: 4.1,
    status: 'active',
    city: 'Delhi',
    lastSeenAt: '2026-09-24T06:22:00+05:30',
  },
  {
    id: 'rdr_12',
    name: 'Kiran Bhosale',
    phone: '+91 98223 11908',
    vehicleType: 'ev_scooter',
    vendorId: 'ven_07',
    vendorName: 'Sahyadri Kirana',
    isOnline: true,
    isAvailable: false,
    activeOrderId: 'ord_9088',
    activeOrderNo: 'MND-20260924-0461',
    completedCount: 355,
    rating: 4.3,
    status: 'active',
    city: 'Pune',
    lastSeenAt: '2026-09-24T11:58:00+05:30',
  },
];

const DELIVERIES: readonly RiderDeliveryRow[] = [
  {
    id: 'dlv_01',
    orderNo: 'MND-20260924-0498',
    vendorName: 'Nandini Fresh, HSR',
    status: 'DELIVERED',
    distanceKm: 2.8,
    minutes: 19,
    earnedPaise: 4_600,
    deliveredAt: '2026-09-24T10:41:00+05:30',
  },
  {
    id: 'dlv_02',
    orderNo: 'MND-20260924-0455',
    vendorName: 'Iyengar Bakery, Koramangala',
    status: 'DELIVERED',
    distanceKm: 1.4,
    minutes: 12,
    earnedPaise: 3_200,
    deliveredAt: '2026-09-24T09:58:00+05:30',
  },
  {
    id: 'dlv_03',
    orderNo: 'MND-20260923-0619',
    vendorName: 'Nandini Fresh, HSR',
    status: 'DELIVERY_FAILED',
    distanceKm: 4.1,
    minutes: 34,
    earnedPaise: 2_000,
    deliveredAt: '2026-09-23T20:12:00+05:30',
  },
  {
    id: 'dlv_04',
    orderNo: 'MND-20260923-0570',
    vendorName: 'Green Basket Organics',
    status: 'DELIVERED',
    distanceKm: 3.3,
    minutes: 22,
    earnedPaise: 5_100,
    deliveredAt: '2026-09-23T18:04:00+05:30',
  },
  {
    id: 'dlv_05',
    orderNo: 'MND-20260923-0512',
    vendorName: 'Sri Ganesh Stores',
    status: 'DELIVERED',
    distanceKm: 2.1,
    minutes: 16,
    earnedPaise: 3_900,
    deliveredAt: '2026-09-23T16:27:00+05:30',
  },
];

export function riderDetailFixture(id: string): RiderDetail {
  const base =
    RIDERS_FIXTURE.find((r) => r.id === id) ??
    RIDERS_FIXTURE[0] ??
    ({
      id,
      name: 'Unknown',
      phone: '',
      vehicleType: 'bike',
      vendorId: null,
      vendorName: null,
      isOnline: false,
      isAvailable: false,
      activeOrderId: null,
      activeOrderNo: null,
      completedCount: 0,
      rating: 0,
      status: 'pending',
      city: '',
      lastSeenAt: '2026-09-24T00:00:00+05:30',
    } satisfies RiderRow);

  return {
    ...base,
    id,
    joinedAt: '2025-05-12T10:00:00+05:30',
    performance: {
      onTimePct: 94.2,
      avgMinutes: 21,
      acceptRatePct: 88.5,
      failedCount: 7,
      earningsPaise: 3_84_600,
      spark: [38, 44, 41, 52, 49, 58, 55, 61],
    },
    currentAssignment:
      base.activeOrderId === null || base.activeOrderNo === null
        ? null
        : {
            orderId: base.activeOrderId,
            orderNo: base.activeOrderNo,
            status: 'OUT_FOR_DELIVERY',
            customerName: 'Ananya Iyer',
            pickup: base.vendorName ?? 'Platform pool pickup',
            dropCity: base.city,
            dropPincode: '560102',
            assignedAt: '2026-09-24T11:31:00+05:30',
            etaMinutes: 8,
          },
    deliveries: [...DELIVERIES],
  };
}
