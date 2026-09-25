/**
 * SAMPLE DATA — not real, never presented as real.
 *
 * Backs `/admin/audit-logs` when it cannot be reached, always behind the amber
 * banner.
 *
 * Mirrors the `AuditLog` collection (plan §5.1):
 *   { actorId, actorRole, action, entity, entityId, before, after, ip, at }
 *
 * The sensitive fields here carry the API's own `"[REDACTED]"` marker on
 * purpose — the diff view must be seen to handle them, and must never draw one
 * as though it were a real value.
 */

import type { Json } from './diff';

export type ActorRole = 'admin' | 'vendor' | 'customer' | 'delivery' | 'system';

export interface AuditRow {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: ActorRole;
  action: string;
  entity: string;
  entityId: string;
  before: Json | null;
  after: Json | null;
  ip: string;
  at: string;
}

export const AUDIT_FIXTURE: readonly AuditRow[] = [
  {
    id: 'aud_01',
    actorId: 'adm_02',
    actorName: 'Rohit Malhotra',
    actorRole: 'admin',
    action: 'vendor.commission.update',
    entity: 'Vendor',
    entityId: 'ven_02',
    ip: '203.0.113.41',
    at: '2026-09-24T11:42:00+05:30',
    before: {
      storeName: 'Nandini Fresh, HSR',
      commissionPct: 12,
      codEnabled: true,
      codMaxAmount: 250000,
      status: 'approved',
      serviceRadiusKm: 5,
    },
    after: {
      storeName: 'Nandini Fresh, HSR',
      commissionPct: 15,
      codEnabled: true,
      codMaxAmount: 250000,
      status: 'approved',
      serviceRadiusKm: 5,
    },
  },
  {
    id: 'aud_02',
    actorId: 'adm_01',
    actorName: 'Priya Venkataraman',
    actorRole: 'admin',
    action: 'settings.update',
    entity: 'Setting',
    entityId: 'platform',
    ip: '203.0.113.12',
    at: '2026-09-24T10:18:00+05:30',
    before: {
      deliveryFeePaise: 2900,
      freeDeliveryThresholdPaise: 49900,
      serviceRadiusKm: 5,
      defaultCommissionPct: 12,
      maintenanceMode: false,
    },
    after: {
      deliveryFeePaise: 3500,
      freeDeliveryThresholdPaise: 59900,
      serviceRadiusKm: 5,
      defaultCommissionPct: 12,
      maintenanceMode: false,
    },
  },
  {
    id: 'aud_03',
    actorId: 'sys_00',
    actorName: 'Mandi system',
    actorRole: 'system',
    action: 'order.status.transition',
    entity: 'Order',
    entityId: 'ord_9101',
    ip: '10.0.4.19',
    at: '2026-09-24T11:31:00+05:30',
    before: {
      orderNo: 'MND-20260924-0517',
      status: 'ASSIGNED',
      deliveryPartnerId: 'rdr_01',
      deliveryOtpHash: '[REDACTED]',
      pricing: { grandTotal: 184500, commissionAmount: 27675, vendorPayout: 156825 },
    },
    after: {
      orderNo: 'MND-20260924-0517',
      status: 'PICKED_UP',
      deliveryPartnerId: 'rdr_01',
      deliveryOtpHash: '[REDACTED]',
      pricing: { grandTotal: 184500, commissionAmount: 27675, vendorPayout: 156825 },
    },
  },
  {
    id: 'aud_04',
    actorId: 'adm_02',
    actorName: 'Rohit Malhotra',
    actorRole: 'admin',
    action: 'customer.suspend',
    entity: 'User',
    entityId: 'cus_04',
    ip: '203.0.113.41',
    at: '2026-09-24T09:07:00+05:30',
    before: {
      name: 'Karthik Menon',
      phone: '+91 98470 33190',
      status: 'active',
      passwordHash: '[REDACTED]',
      refreshTokenFamily: '[REDACTED]',
    },
    after: {
      name: 'Karthik Menon',
      phone: '+91 98470 33190',
      status: 'suspended',
      passwordHash: '[REDACTED]',
      refreshTokenFamily: '[REDACTED]',
      suspensionReason: 'Repeated chargebacks',
    },
  },
  {
    id: 'aud_05',
    actorId: 'ven_07',
    actorName: 'Sahyadri Kirana',
    actorRole: 'vendor',
    action: 'product.price.update',
    entity: 'Product',
    entityId: 'prd_15',
    ip: '198.51.100.77',
    at: '2026-09-23T12:29:00+05:30',
    before: {
      name: 'Cold Pressed Groundnut Oil',
      sku: 'STP-GNO-1L',
      price: 45900,
      mrp: 56000,
      discountPct: 18,
      isActive: true,
    },
    after: {
      name: 'Cold Pressed Groundnut Oil',
      sku: 'STP-GNO-1L',
      price: 49900,
      mrp: 56000,
      discountPct: 11,
      isActive: true,
    },
  },
  {
    id: 'aud_06',
    actorId: 'adm_01',
    actorName: 'Priya Venkataraman',
    actorRole: 'admin',
    action: 'settlement.mark_paid',
    entity: 'Settlement',
    entityId: 'stl_01',
    ip: '203.0.113.12',
    at: '2026-09-16T11:04:00+05:30',
    before: {
      vendorId: 'ven_02',
      status: 'processing',
      netPayablePaise: 4006240,
      reference: null,
      paidAt: null,
    },
    after: {
      vendorId: 'ven_02',
      status: 'paid',
      netPayablePaise: 4006240,
      reference: 'UTR2026091600418823',
      paidAt: '2026-09-16T11:04:00+05:30',
    },
  },
  {
    id: 'aud_07',
    actorId: 'adm_03',
    actorName: 'Nisha Kulkarni',
    actorRole: 'admin',
    action: 'coupon.create',
    entity: 'Coupon',
    entityId: 'cpn_06',
    ip: '203.0.113.88',
    at: '2026-09-22T16:50:00+05:30',
    before: null,
    after: {
      code: 'DIWALI500',
      type: 'flat',
      value: 50000,
      minOrder: 249900,
      usageLimit: 1000,
      perUserLimit: 1,
      validFrom: '2026-10-25T00:00:00+05:30',
      validTo: '2026-11-05T23:59:59+05:30',
      isActive: true,
    },
  },
  {
    id: 'aud_08',
    actorId: 'adm_02',
    actorName: 'Rohit Malhotra',
    actorRole: 'admin',
    action: 'coupon.delete',
    entity: 'Coupon',
    entityId: 'cpn_09',
    ip: '203.0.113.41',
    at: '2026-09-21T14:12:00+05:30',
    before: {
      code: 'STAFFTEST',
      type: 'percent',
      value: 90,
      minOrder: 0,
      maxDiscount: null,
      usedCount: 3,
      isActive: false,
    },
    after: null,
  },
  {
    id: 'aud_09',
    actorId: 'rdr_06',
    actorName: 'Ganesh Pillai',
    actorRole: 'delivery',
    action: 'delivery.availability.update',
    entity: 'DeliveryPartner',
    entityId: 'rdr_06',
    ip: '198.51.100.201',
    at: '2026-08-30T19:41:00+05:30',
    before: { isOnline: true, isAvailable: true, activeOrderId: null },
    after: { isOnline: false, isAvailable: false, activeOrderId: null },
  },
  {
    id: 'aud_10',
    actorId: 'adm_01',
    actorName: 'Priya Venkataraman',
    actorRole: 'admin',
    action: 'report.export',
    entity: 'Report',
    entityId: 'sales',
    ip: '203.0.113.12',
    at: '2026-09-24T08:33:00+05:30',
    before: null,
    after: null,
  },
  {
    id: 'aud_11',
    actorId: 'adm_03',
    actorName: 'Nisha Kulkarni',
    actorRole: 'admin',
    action: 'vendor.status.update',
    entity: 'Vendor',
    entityId: 'ven_11',
    ip: '203.0.113.88',
    at: '2026-09-20T10:26:00+05:30',
    before: { storeName: 'Park Street Provisions', status: 'pending', isOpen: false, rating: 0 },
    after: { storeName: 'Park Street Provisions', status: 'approved', isOpen: true, rating: 0 },
  },
  {
    id: 'aud_12',
    actorId: 'sys_00',
    actorName: 'Mandi system',
    actorRole: 'system',
    action: 'settlement.generate',
    entity: 'Settlement',
    entityId: 'stl_04',
    ip: '10.0.4.19',
    at: '2026-09-22T02:00:00+05:30',
    before: null,
    after: {
      vendorId: 'ven_02',
      periodStart: '2026-09-15T00:00:00+05:30',
      periodEnd: '2026-09-21T23:59:59+05:30',
      grossSalesPaise: 5207900,
      totalCommissionPaise: 781185,
      refundsPaise: 218450,
      netPayablePaise: 4208265,
      status: 'pending',
    },
  },
];

// Mutable arrays: <FilterBar> takes `FilterOption[]`, not a readonly one.
export const ACTION_OPTIONS: { label: string; value: string }[] = [
  { label: 'Any action', value: '' },
  ...[...new Set(AUDIT_FIXTURE.map((row) => row.action))]
    .sort()
    .map((action) => ({ label: action, value: action })),
];

export const ENTITY_OPTIONS: { label: string; value: string }[] = [
  { label: 'Any entity', value: '' },
  ...[...new Set(AUDIT_FIXTURE.map((row) => row.entity))]
    .sort()
    .map((entity) => ({ label: entity, value: entity })),
];

export const ROLE_OPTIONS: { label: string; value: string }[] = [
  { label: 'Any actor', value: '' },
  { label: 'Admin', value: 'admin' },
  { label: 'Vendor', value: 'vendor' },
  { label: 'Customer', value: 'customer' },
  { label: 'Delivery', value: 'delivery' },
  { label: 'System', value: 'system' },
];
