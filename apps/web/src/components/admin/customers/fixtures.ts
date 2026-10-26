/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * These rows stand in only when `/admin/customers` cannot be reached, and the
 * page that renders them shows an amber "sample data" banner for as long as
 * they are on screen (see `_shared-pages/SampleBanner`).
 *
 * Money is INTEGER PAISE throughout (plan §5.2). Dates are fixed ISO strings
 * rather than `Date.now()` offsets so the fixture is stable between renders —
 * a fixture that changes every second makes a diff impossible to read.
 */

import type { OrderStatus } from '@/lib/admin/types';

export type CustomerStatus = 'active' | 'suspended' | 'pending';

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: CustomerStatus;
  /** Everything but cancelled/rejected — the API's field names, verbatim. */
  orderCount: number;
  /** INTEGER PAISE, same population as `orderCount`. */
  totalSpend: number;
  lastOrderAt: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface CustomerAddress {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  phone: string;
  isDefault: boolean;
}

export interface CustomerOrderRow {
  id: string;
  orderNo: string;
  vendorName: string | null;
  status: OrderStatus;
  itemCount: number;
  totalPaise: number;
  placedAt: string | null;
}

export interface CustomerDetail extends CustomerRow {
  addresses: CustomerAddress[];
  orders: CustomerOrderRow[];
  lifetime: {
    ordersCount: number;
    grossPaise: number;
    avgOrderPaise: number;
    refundedPaise: number;
    cancelledCount: number;
    firstOrderAt: string | null;
    /** trailing monthly spend, oldest first, in paise */
    spark: number[];
  };
}

export const CUSTOMERS_FIXTURE: readonly CustomerRow[] = [
  {
    id: 'cus_01',
    name: 'Ananya Iyer',
    phone: '+91 98450 11204',
    email: 'ananya.iyer@example.in',
    status: 'active',
    orderCount: 64,
    totalSpend: 8_94_250,
    lastOrderAt: '2026-09-23T18:42:00+05:30',
    lastLoginAt: null,
    createdAt: '2025-02-11T09:15:00+05:30',
  },
  {
    id: 'cus_02',
    name: 'Rahul Deshpande',
    phone: '+91 98212 44871',
    email: 'rahul.d@example.in',
    status: 'active',
    orderCount: 41,
    totalSpend: 5_12_900,
    lastOrderAt: '2026-09-24T08:05:00+05:30',
    lastLoginAt: null,
    createdAt: '2025-04-02T19:40:00+05:30',
  },
  {
    id: 'cus_03',
    name: 'Fatima Sheikh',
    phone: '+91 99303 76512',
    email: null,
    status: 'active',
    orderCount: 128,
    totalSpend: 17_46_080,
    lastOrderAt: '2026-09-24T11:20:00+05:30',
    lastLoginAt: null,
    createdAt: '2024-11-28T07:55:00+05:30',
  },
  {
    id: 'cus_04',
    name: 'Karthik Menon',
    phone: '+91 98470 33190',
    email: 'k.menon@example.in',
    status: 'suspended',
    orderCount: 9,
    totalSpend: 74_300,
    lastOrderAt: '2026-06-14T21:10:00+05:30',
    lastLoginAt: null,
    createdAt: '2026-01-09T12:02:00+05:30',
  },
  {
    id: 'cus_05',
    name: 'Priyanka Sahoo',
    phone: '+91 94370 22845',
    email: 'priyanka.sahoo@example.in',
    status: 'active',
    orderCount: 23,
    totalSpend: 2_88_410,
    lastOrderAt: '2026-09-21T17:31:00+05:30',
    lastLoginAt: null,
    createdAt: '2025-08-19T15:26:00+05:30',
  },
  {
    id: 'cus_06',
    name: 'Imran Qureshi',
    phone: '+91 97110 58023',
    email: 'imran.q@example.in',
    status: 'active',
    orderCount: 77,
    totalSpend: 11_20_760,
    lastOrderAt: '2026-09-22T20:14:00+05:30',
    lastLoginAt: null,
    createdAt: '2025-01-05T10:48:00+05:30',
  },
  {
    id: 'cus_07',
    name: 'Meera Nair',
    phone: '+91 98862 90117',
    email: 'meera.nair@example.in',
    status: 'pending',
    orderCount: 0,
    totalSpend: 0,
    lastOrderAt: null,
    lastLoginAt: null,
    createdAt: '2026-09-24T09:02:00+05:30',
  },
  {
    id: 'cus_08',
    name: 'Sandeep Grover',
    phone: '+91 98996 41203',
    email: 'sandeep.grover@example.in',
    status: 'active',
    orderCount: 35,
    totalSpend: 4_61_115,
    lastOrderAt: '2026-09-20T13:44:00+05:30',
    lastLoginAt: null,
    createdAt: '2025-06-30T08:12:00+05:30',
  },
  {
    id: 'cus_09',
    name: 'Lakshmi Reddy',
    phone: '+91 90000 27754',
    email: 'lakshmi.reddy@example.in',
    status: 'active',
    orderCount: 52,
    totalSpend: 6_73_940,
    lastOrderAt: '2026-09-19T19:05:00+05:30',
    lastLoginAt: null,
    createdAt: '2025-03-17T16:33:00+05:30',
  },
  {
    id: 'cus_10',
    name: 'Joy Barman',
    phone: '+91 98310 65429',
    email: null,
    status: 'active',
    orderCount: 18,
    totalSpend: 1_92_300,
    lastOrderAt: '2026-09-18T12:26:00+05:30',
    lastLoginAt: null,
    createdAt: '2025-11-23T11:19:00+05:30',
  },
  {
    id: 'cus_11',
    name: 'Nikhil Chauhan',
    phone: '+91 96540 80931',
    email: 'nikhil.c@example.in',
    status: 'suspended',
    orderCount: 4,
    totalSpend: 31_950,
    lastOrderAt: '2026-04-02T18:00:00+05:30',
    lastLoginAt: null,
    createdAt: '2026-02-26T20:41:00+05:30',
  },
  {
    id: 'cus_12',
    name: 'Divya Ramaswamy',
    phone: '+91 94440 11875',
    email: 'divya.r@example.in',
    status: 'active',
    orderCount: 96,
    totalSpend: 13_05_620,
    lastOrderAt: '2026-09-24T07:48:00+05:30',
    lastLoginAt: null,
    createdAt: '2024-12-14T14:07:00+05:30',
  },
  {
    id: 'cus_13',
    name: 'Arvind Bhatt',
    phone: '+91 99250 47712',
    email: 'arvind.bhatt@example.in',
    status: 'active',
    orderCount: 29,
    totalSpend: 3_47_880,
    lastOrderAt: '2026-09-16T09:55:00+05:30',
    lastLoginAt: null,
    createdAt: '2025-09-08T17:52:00+05:30',
  },
  {
    id: 'cus_14',
    name: 'Shalini Pradhan',
    phone: '+91 98750 23664',
    email: 'shalini.p@example.in',
    status: 'active',
    orderCount: 12,
    totalSpend: 1_38_400,
    lastOrderAt: '2026-09-11T16:18:00+05:30',
    lastLoginAt: null,
    createdAt: '2026-03-21T13:30:00+05:30',
  },
];

const ADDRESSES: readonly CustomerAddress[] = [
  {
    id: 'adr_01',
    label: 'Home',
    line1: '14, Brindavan Layout, 3rd Cross',
    line2: 'Off Sarjapur Road',
    city: 'Bengaluru',
    pincode: '560102',
    phone: '+91 98450 11204',
    isDefault: true,
  },
  {
    id: 'adr_02',
    label: 'Work',
    line1: 'Prestige Tech Park, Tower C, Level 7',
    line2: null,
    city: 'Bengaluru',
    pincode: '560103',
    phone: '+91 98450 11204',
    isDefault: false,
  },
];

const ORDER_HISTORY: readonly CustomerOrderRow[] = [
  {
    id: 'ord_9041',
    orderNo: 'MND-20260923-0412',
    vendorName: 'Nandini Fresh, HSR',
    status: 'DELIVERED',
    itemCount: 11,
    totalPaise: 1_84_500,
    placedAt: '2026-09-23T18:42:00+05:30',
  },
  {
    id: 'ord_8873',
    orderNo: 'MND-20260919-0288',
    vendorName: 'Sri Ganesh Stores',
    status: 'DELIVERED',
    itemCount: 6,
    totalPaise: 92_700,
    placedAt: '2026-09-19T10:11:00+05:30',
  },
  {
    id: 'ord_8654',
    orderNo: 'MND-20260914-0177',
    vendorName: 'Iyengar Bakery, Koramangala',
    status: 'DELIVERED',
    itemCount: 4,
    totalPaise: 41_000,
    placedAt: '2026-09-14T08:26:00+05:30',
  },
  {
    id: 'ord_8402',
    orderNo: 'MND-20260908-0093',
    vendorName: 'Nandini Fresh, HSR',
    status: 'CANCELLED',
    itemCount: 9,
    totalPaise: 1_26_800,
    placedAt: '2026-09-08T19:03:00+05:30',
  },
  {
    id: 'ord_8199',
    orderNo: 'MND-20260902-0031',
    vendorName: 'Green Basket Organics',
    status: 'DELIVERED',
    itemCount: 15,
    totalPaise: 2_41_350,
    placedAt: '2026-09-02T17:37:00+05:30',
  },
];

/** Builds a plausible detail record around whichever list row was clicked. */
export function customerDetailFixture(id: string): CustomerDetail {
  const base =
    CUSTOMERS_FIXTURE.find((c) => c.id === id) ??
    CUSTOMERS_FIXTURE[0] ??
    // Unreachable — the fixture array is a non-empty literal. Kept so the
    // function is total under `noUncheckedIndexedAccess`.
    {
      id,
      name: 'Unknown',
      phone: '',
      email: null,
      status: 'active' as const,
      orderCount: 0,
      totalSpend: 0,
      lastOrderAt: null,
      lastLoginAt: null,
      createdAt: '2026-01-01T00:00:00+05:30',
    };

  const orders = ORDER_HISTORY.slice(0, Math.max(1, Math.min(5, base.orderCount)));
  const delivered = orders.filter((o) => o.status === 'DELIVERED');

  return {
    ...base,
    id,
    addresses: [...ADDRESSES],
    orders: [...orders],
    lifetime: {
      ordersCount: base.orderCount,
      grossPaise: base.totalSpend,
      avgOrderPaise:
        base.orderCount === 0 ? 0 : Math.round(base.totalSpend / base.orderCount),
      refundedPaise: 12_680,
      cancelledCount: orders.length - delivered.length,
      firstOrderAt: base.orderCount === 0 ? null : base.createdAt,
      spark: [42_000, 68_500, 51_200, 79_900, 64_400, 88_100],
    },
  };
}
