/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * ── THE ENDPOINT ────────────────────────────────────────────────────────────
 * `GET /admin/payments` (SUPER_ADMIN only) — there is no payments collection;
 * each row is an order's `Order.payment` flattened onto the order, paged
 * server-side in the usual `{ data, meta }` envelope. `id` is the order id,
 * which is what `POST /admin/payments/:id/refund` takes. The interface below
 * is that endpoint's row, key for key; this fixture stands in for it only when
 * it cannot be reached.
 *
 * Money is INTEGER PAISE.
 */

import type { PaymentStatus } from '@/lib/admin/types';

export type PaymentMethod = 'online' | 'cod';

export interface PaymentRow {
  /** The order id. */
  id: string;
  orderId: string;
  orderNo: string;
  /** null when the account no longer exists — the API never makes one up. */
  customerName: string | null;
  vendorName: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  /** `pricing.grandTotal` — the order's current total. */
  amountPaise: number;
  refundedPaise: number;
  /** `'razorpay'` online, `'cod'` for cash; null if never recorded. */
  provider: string | null;
  /** `providerPaymentId` — null for COD, which has no gateway leg at all. */
  gatewayRef: string | null;
  /** `placedAt` — when the payment was initiated at checkout. */
  at: string;
}

export const PAYMENTS_FIXTURE: readonly PaymentRow[] = [
  {
    id: 'pay_01',
    orderId: 'ord_9101',
    orderNo: 'MND-20260924-0517',
    customerName: 'Ananya Iyer',
    vendorName: 'Nandini Fresh, HSR',
    method: 'online',
    status: 'paid',
    amountPaise: 1_84_500,
    refundedPaise: 0,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ8xk2ZaLm41vB',
    at: '2026-09-24T11:31:00+05:30',
  },
  {
    id: 'pay_02',
    orderId: 'ord_9098',
    orderNo: 'MND-20260924-0503',
    customerName: 'Fatima Sheikh',
    vendorName: 'Marine Drive Mart',
    method: 'cod',
    status: 'pending',
    amountPaise: 96_200,
    refundedPaise: 0,
    provider: 'cod',
    gatewayRef: null,
    at: '2026-09-24T11:12:00+05:30',
  },
  {
    id: 'pay_03',
    orderId: 'ord_9094',
    orderNo: 'MND-20260924-0488',
    customerName: 'Lakshmi Reddy',
    vendorName: 'Jubilee Daily Needs',
    method: 'online',
    status: 'paid',
    amountPaise: 2_41_350,
    refundedPaise: 0,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ8t9RvCdE72nH',
    at: '2026-09-24T10:47:00+05:30',
  },
  {
    id: 'pay_04',
    orderId: 'ord_9088',
    orderNo: 'MND-20260924-0461',
    customerName: 'Rahul Deshpande',
    vendorName: 'Sahyadri Kirana',
    method: 'online',
    status: 'authorized',
    amountPaise: 58_900,
    refundedPaise: 0,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ8qW4fGhJ83kL',
    at: '2026-09-24T10:05:00+05:30',
  },
  {
    id: 'pay_05',
    orderId: 'ord_9077',
    orderNo: 'MND-20260924-0419',
    customerName: 'Imran Qureshi',
    vendorName: 'Nandini Fresh, HSR',
    method: 'online',
    status: 'failed',
    amountPaise: 1_12_000,
    refundedPaise: 0,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ8nM6bVxZ19qR',
    at: '2026-09-24T09:22:00+05:30',
  },
  {
    id: 'pay_06',
    orderId: 'ord_9061',
    orderNo: 'MND-20260924-0377',
    customerName: 'Divya Ramaswamy',
    vendorName: 'T. Nagar Grocers',
    method: 'cod',
    status: 'paid',
    amountPaise: 74_800,
    refundedPaise: 0,
    provider: 'cod',
    gatewayRef: null,
    at: '2026-09-24T08:48:00+05:30',
  },
  {
    id: 'pay_07',
    orderId: 'ord_9040',
    orderNo: 'MND-20260923-0612',
    customerName: 'Sandeep Grover',
    vendorName: 'Park Street Provisions',
    method: 'online',
    status: 'refunded',
    amountPaise: 1_26_800,
    refundedPaise: 1_26_800,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ7hG2nKpL55tY',
    at: '2026-09-23T20:03:00+05:30',
  },
  {
    id: 'pay_08',
    orderId: 'ord_9032',
    orderNo: 'MND-20260923-0588',
    customerName: 'Joy Barman',
    vendorName: 'Park Street Provisions',
    method: 'online',
    status: 'partially_refunded',
    amountPaise: 89_400,
    refundedPaise: 21_000,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ7dF9mJqW31xC',
    at: '2026-09-23T18:41:00+05:30',
  },
  {
    id: 'pay_09',
    orderId: 'ord_9019',
    orderNo: 'MND-20260923-0540',
    customerName: 'Arvind Bhatt',
    vendorName: 'Jubilee Daily Needs',
    method: 'cod',
    status: 'pending',
    amountPaise: 1_54_600,
    refundedPaise: 0,
    provider: 'cod',
    gatewayRef: null,
    at: '2026-09-23T17:16:00+05:30',
  },
  {
    id: 'pay_10',
    orderId: 'ord_9004',
    orderNo: 'MND-20260923-0491',
    customerName: 'Priyanka Sahoo',
    vendorName: 'Sahyadri Kirana',
    method: 'online',
    status: 'paid',
    amountPaise: 2_88_410,
    refundedPaise: 0,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ7bC4kHnR77dM',
    at: '2026-09-23T15:52:00+05:30',
  },
  {
    id: 'pay_11',
    orderId: 'ord_8996',
    orderNo: 'MND-20260923-0455',
    customerName: 'Shalini Pradhan',
    vendorName: 'Marine Drive Mart',
    method: 'online',
    status: 'paid',
    amountPaise: 41_300,
    refundedPaise: 0,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ79zX8sTv02bN',
    at: '2026-09-23T14:09:00+05:30',
  },
  {
    id: 'pay_12',
    orderId: 'ord_8981',
    orderNo: 'MND-20260923-0402',
    customerName: 'Karthik Menon',
    vendorName: 'Marine Drive Mart',
    method: 'cod',
    status: 'failed',
    amountPaise: 33_900,
    refundedPaise: 0,
    provider: 'cod',
    gatewayRef: null,
    at: '2026-09-23T12:37:00+05:30',
  },
  {
    id: 'pay_13',
    orderId: 'ord_8968',
    orderNo: 'MND-20260923-0361',
    customerName: 'Nikhil Chauhan',
    vendorName: 'T. Nagar Grocers',
    method: 'online',
    status: 'paid',
    amountPaise: 67_500,
    refundedPaise: 0,
    provider: 'razorpay',
    gatewayRef: 'pay_PQ76vY1pQd48fJ',
    at: '2026-09-23T11:02:00+05:30',
  },
  {
    id: 'pay_14',
    orderId: 'ord_8950',
    orderNo: 'MND-20260922-0598',
    customerName: 'Meera Nair',
    vendorName: 'Nandini Fresh, HSR',
    method: 'cod',
    status: 'paid',
    amountPaise: 1_08_750,
    refundedPaise: 0,
    provider: 'cod',
    gatewayRef: null,
    at: '2026-09-22T19:28:00+05:30',
  },
];
