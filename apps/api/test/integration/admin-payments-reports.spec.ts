import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { User, UserDocument } from '../../src/database/schemas/user.schema';
import {
  Vendor,
  VendorDocument,
  VendorStatus,
} from '../../src/database/schemas/vendor.schema';
import {
  Category,
  CategoryDocument,
} from '../../src/database/schemas/category.schema';
import {
  Product,
  ProductDocument,
  ProductUnit,
} from '../../src/database/schemas/product.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
  LedgerEntryType,
} from '../../src/database/schemas/ledger-entry.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { AisleKey } from '../../src/common/constants/aisle.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { AdminModule } from '../../src/modules/admin/admin.module';
import {
  PAYMENT_PROVIDER,
  PaymentProvider,
} from '../../src/modules/shop/payments/payment-provider';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/** Generated per run, never a literal. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const STORE: [number, number] = [77.6101, 12.9352];

/** The exact key sets the console's `REPORTS[].columns` (+ xKey) expect. */
const REPORT_ROW_KEYS: Record<string, string[]> = {
  sales: ['date', 'orders', 'gmvPaise', 'aovPaise', 'discountPaise', 'commissionPaise'],
  vendor_performance: [
    'vendorId',
    'vendor',
    'city',
    'orders',
    'gmvPaise',
    'commissionPaise',
    'cancelPct',
  ],
  product_performance: ['aisleKey', 'products', 'units', 'gmvPaise', 'sharePct'],
  delivery_performance: ['date', 'deliveries', 'avgMinutes', 'onTimePct', 'failed'],
  tax_summary: ['slab', 'orders', 'taxablePaise', 'taxPaise'],
};

/** What `PaymentRow` in `apps/web/.../payments/fixtures.ts` declares. */
const PAYMENT_ROW_KEYS = [
  'id',
  'orderId',
  'orderNo',
  'customerName',
  'vendorName',
  'method',
  'status',
  'amountPaise',
  'refundedPaise',
  'provider',
  'gatewayRef',
  'at',
].sort();

const sortedKeys = (row: Record<string, unknown>): string[] =>
  Object.keys(row).sort();

/**
 * ════════════════════════════════════════════════════════════════════════
 *  /admin/payments AND /admin/reports — INTEGRATION
 * ════════════════════════════════════════════════════════════════════════
 *
 * Both endpoints exist so two console screens stop rendering fixtures,
 * so the assertions are about the CONTRACT those screens read:
 *
 *   - the exact query strings the pages send are accepted (an extra or
 *     mistyped key is a 400 under `forbidNonWhitelisted`, and a 400 is a
 *     fictional screen behind an amber banner);
 *   - each row carries exactly the keys the page's columns index into;
 *   - an empty database is an empty list, not an error and not zeros;
 *   - a refund either really happens or visibly does not — never a 200
 *     over money that did not move.
 *
 * Orders are inserted directly: checkout is not what is under test, and
 * the online path through it would open a connection to Razorpay.
 */
describe('Admin payments and reports (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let categories: Model<CategoryDocument>;
  let products: Model<ProductDocument>;
  let orders: Model<OrderDocument>;
  let ledger: Model<LedgerEntryDocument>;
  let passwords: PasswordService;

  let superToken: string;
  let adminToken: string;
  let customerToken: string;
  let customerId: Types.ObjectId;
  let otherCustomerId: Types.ObjectId;

  let phoneCounter = 0;

  async function seedUser(role: Role, name: string): Promise<{ id: Types.ObjectId; email: string }> {
    const n = String(++phoneCounter).padStart(4, '0');
    const email = `payrep${n}@test.invalid`;
    const created = await users.create({
      name,
      email,
      phone: `96${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role,
      status: UserStatus.ACTIVE,
    });
    return { id: created._id, email };
  }

  async function login(email: string): Promise<string> {
    const res = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: email, password: PASSWORD });
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  const get = (path: string, token: string = superToken) =>
    request(server)
      .get(path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);

  const post = (path: string, body: object, token: string = superToken) =>
    request(server)
      .post(path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;

    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
    categories = ctx.app.get<Model<CategoryDocument>>(getModelToken(Category.name));
    products = ctx.app.get<Model<ProductDocument>>(getModelToken(Product.name));
    orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
    ledger = ctx.app.get<Model<LedgerEntryDocument>>(getModelToken(LedgerEntry.name));
    passwords = ctx.app.get(PasswordService);

    const superAdmin = await seedUser(Role.SUPER_ADMIN, 'Pay Super');
    const admin = await seedUser(Role.ADMIN, 'Pay Admin');
    const customer = await seedUser(Role.CUSTOMER, 'Ananya Iyer');
    const other = await seedUser(Role.CUSTOMER, 'Rahul Deshpande');
    customerId = customer.id;
    otherCustomerId = other.id;

    superToken = await login(superAdmin.email);
    adminToken = await login(admin.email);
    customerToken = await login(customer.email);
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  Authorisation — SUPER_ADMIN only, on every route
  // ══════════════════════════════════════════════════════════════════

  describe('authorisation', () => {
    const routes: { method: 'get' | 'post'; path: string }[] = [
      { method: 'get', path: '/admin/payments' },
      { method: 'get', path: '/admin/reports?report=sales' },
      {
        method: 'post',
        path: `/admin/payments/${new Types.ObjectId().toString()}/refund`,
      },
    ];

    it('rejects a CUSTOMER token with 403', async () => {
      for (const route of routes) {
        const res =
          route.method === 'get'
            ? await get(route.path, customerToken)
            : await post(route.path, {}, customerToken);
        expect([route.path, res.status]).toEqual([route.path, 403]);
      }
    });

    it('rejects an ADMIN token with 403 — inheritance runs upward only', async () => {
      for (const route of routes) {
        const res =
          route.method === 'get'
            ? await get(route.path, adminToken)
            : await post(route.path, {}, adminToken);
        expect([route.path, res.status]).toEqual([route.path, 403]);
      }
    });

    it('rejects an anonymous request with 401', async () => {
      const res = await request(server)
        .get('/admin/payments')
        .set('X-Forwarded-For', nextIp());
      expect(res.status).toBe(401);
    });

    it('lets SUPER_ADMIN read both', async () => {
      expect((await get('/admin/payments')).status).toBe(200);
      expect((await get('/admin/reports?report=sales')).status).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Empty database — before a single order exists
  // ══════════════════════════════════════════════════════════════════

  describe('on an empty database', () => {
    it('answers the payments page with no rows and a truthful meta', async () => {
      const res = await get('/admin/payments?page=1&limit=12');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        data: [],
        meta: { page: 1, limit: 12, total: 0, pages: 0 },
      });
    });

    it('answers every report with no rows — never a row of invented zeros', async () => {
      for (const report of Object.keys(REPORT_ROW_KEYS)) {
        const res = await get(
          `/admin/reports?report=${report}&from=2026-09-18&to=2026-09-24`,
        );
        expect([report, res.status]).toEqual([report, 200]);
        expect(res.body).toEqual({
          data: [],
          meta: { page: 1, limit: 0, total: 0, pages: 0 },
        });
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  With data
  // ══════════════════════════════════════════════════════════════════

  describe('with orders', () => {
    let alphaId: Types.ObjectId;
    let betaId: Types.ObjectId;
    /** online · PAID · DELIVERED · Alpha · 2026-09-20 (Sunday) */
    let o1: OrderDocument;
    /** cod · PAID · DELIVERED · Beta · 2026-09-21 */
    let o2: OrderDocument;
    /** cod · PENDING · CANCELLED · Alpha · 2026-09-21 */
    let o3: OrderDocument;
    /** online · PENDING · DELIVERY_FAILED · Beta · 2026-09-22 */
    let o4: OrderDocument;
    /** online · PAID · PLACED · Alpha · 2026-08-01 — the gateway refund case */
    let o5: OrderDocument;

    let orderSeq = 0;

    async function seedVendor(storeName: string, city: string): Promise<Types.ObjectId> {
      const owner = await seedUser(Role.VENDOR, `${storeName} Owner`);
      const vendor = await vendors.create({
        ownerId: owner.id,
        storeName,
        slug: storeName.toLowerCase().replace(/\s+/g, '-'),
        address: { line1: '1 Market Road', city, state: 'Karnataka', pincode: '560034' },
        location: { type: 'Point', coordinates: STORE },
        serviceRadiusKm: 5,
        commissionPct: 10,
        codEnabled: true,
        codMaxAmount: 200_000,
        isOpen: true,
        status: VendorStatus.APPROVED,
      });
      return vendor._id;
    }

    interface OrderSpec {
      vendorId: Types.ObjectId;
      customerId: Types.ObjectId;
      method: PaymentMethod;
      paymentStatus: PaymentStatus;
      status: OrderStatus;
      placedAt: string;
      deliveredAt?: string;
      items: { productId: Types.ObjectId; price: number; qty: number }[];
      discount?: number;
      providerPaymentId?: string;
      history?: { to: OrderStatus; at: string }[];
    }

    /** Priced exactly as `shop/pricing/pricing.ts` would: 5% GST, 10% commission. */
    function seedOrder(spec: OrderSpec): Promise<OrderDocument> {
      const itemsSubtotal = spec.items.reduce((sum, i) => sum + i.price * i.qty, 0);
      const discount = spec.discount ?? 0;
      const taxes = Math.round(((itemsSubtotal - discount) * 5) / 100);
      const commissionAmount = Math.round((itemsSubtotal * 10) / 100);
      const n = String(++orderSeq).padStart(4, '0');

      return orders.create({
        orderNo: `TKR-20260920-${n}`,
        customerId: spec.customerId,
        vendorId: spec.vendorId,
        items: spec.items.map((item) => ({
          productId: item.productId,
          name: 'Line',
          unit: '1 pc',
          price: item.price,
          qty: item.qty,
          lineTotal: item.price * item.qty,
          fulfilled: true,
        })),
        pricing: {
          itemsSubtotal,
          discount,
          deliveryFee: 0,
          taxes,
          grandTotal: itemsSubtotal - discount + taxes,
          commissionPct: 10,
          commissionAmount,
          vendorPayout: itemsSubtotal - commissionAmount,
        },
        address: {
          line1: '2 Lake View',
          city: 'Bengaluru',
          pincode: '560034',
          location: { type: 'Point', coordinates: STORE },
          phone: '9000000099',
        },
        payment: {
          method: spec.method,
          status: spec.paymentStatus,
          provider: spec.method === PaymentMethod.ONLINE ? 'razorpay' : null,
          providerPaymentId: spec.providerPaymentId ?? null,
          refundedAmount: 0,
        },
        status: spec.status,
        statusHistory: (spec.history ?? []).map((h) => ({
          from: null,
          to: h.to,
          at: new Date(h.at),
        })),
        placedAt: new Date(spec.placedAt),
        deliveredAt: spec.deliveredAt ? new Date(spec.deliveredAt) : null,
      });
    }

    beforeAll(async () => {
      alphaId = await seedVendor('Alpha Fresh', 'Bengaluru');
      betaId = await seedVendor('Beta Mart', 'Pune');

      const fruits = await categories.create({
        name: 'Fresh Fruits',
        slug: 'fresh-fruits-payrep',
        aisleKey: AisleKey.FRUITS,
      });
      const dairy = await categories.create({
        name: 'Dairy',
        slug: 'dairy-payrep',
        aisleKey: AisleKey.DAIRY,
      });

      const product = (vendorId: Types.ObjectId, categoryId: Types.ObjectId, sku: string) =>
        products.create({
          vendorId,
          categoryId,
          name: sku,
          slug: sku.toLowerCase(),
          unit: ProductUnit.PIECE,
          unitValue: 1,
          sku,
          mrp: 10_000,
          price: 10_000,
        });

      const apple = await product(alphaId, fruits._id, 'APPLE');
      const milk = await product(betaId, dairy._id, 'MILK');

      o1 = await seedOrder({
        vendorId: alphaId,
        customerId,
        method: PaymentMethod.ONLINE,
        paymentStatus: PaymentStatus.PAID,
        status: OrderStatus.DELIVERED,
        placedAt: '2026-09-20T10:00:00.000Z',
        deliveredAt: '2026-09-20T10:25:00.000Z',
        items: [{ productId: apple._id, price: 10_000, qty: 2 }],
        discount: 1_000,
        providerPaymentId: 'pay_TESTONE',
      });
      o2 = await seedOrder({
        vendorId: betaId,
        customerId: otherCustomerId,
        method: PaymentMethod.COD,
        paymentStatus: PaymentStatus.PAID,
        status: OrderStatus.DELIVERED,
        placedAt: '2026-09-21T09:00:00.000Z',
        deliveredAt: '2026-09-21T09:45:00.000Z',
        items: [{ productId: milk._id, price: 10_000, qty: 1 }],
      });
      o3 = await seedOrder({
        vendorId: alphaId,
        customerId,
        method: PaymentMethod.COD,
        paymentStatus: PaymentStatus.PENDING,
        status: OrderStatus.CANCELLED,
        placedAt: '2026-09-21T12:00:00.000Z',
        items: [{ productId: apple._id, price: 10_000, qty: 5 }],
      });
      o4 = await seedOrder({
        vendorId: betaId,
        customerId: otherCustomerId,
        method: PaymentMethod.ONLINE,
        paymentStatus: PaymentStatus.PENDING,
        status: OrderStatus.DELIVERY_FAILED,
        placedAt: '2026-09-22T07:00:00.000Z',
        items: [{ productId: apple._id, price: 10_000, qty: 1 }],
        history: [{ to: OrderStatus.DELIVERY_FAILED, at: '2026-09-22T08:00:00.000Z' }],
      });
      o5 = await seedOrder({
        vendorId: alphaId,
        customerId,
        method: PaymentMethod.ONLINE,
        paymentStatus: PaymentStatus.PAID,
        status: OrderStatus.PLACED,
        placedAt: '2026-08-01T10:00:00.000Z',
        items: [{ productId: apple._id, price: 10_000, qty: 3 }],
        providerPaymentId: 'pay_TESTFIVE',
      });
    });

    // ── /admin/payments ───────────────────────────────────────────────

    describe('GET /admin/payments', () => {
      const ids = (body: { data: { id: string }[] }) => body.data.map((row) => row.id);

      it('answers the page\'s default query with every payment, newest first', async () => {
        const res = await get('/admin/payments?page=1&limit=12');
        expect(res.status).toBe(200);
        expect(res.body.meta).toEqual({ page: 1, limit: 12, total: 5, pages: 1 });
        expect(ids(res.body)).toEqual(
          [o4, o3, o2, o1, o5].map((o) => o._id.toString()),
        );
      });

      it('returns exactly the PaymentRow keys, flattened from the order', async () => {
        const res = await get('/admin/payments?page=1&limit=12');
        for (const row of res.body.data) expect(sortedKeys(row)).toEqual(PAYMENT_ROW_KEYS);

        const first = res.body.data.find((row: { id: string }) => row.id === o1._id.toString());
        expect(first).toEqual({
          id: o1._id.toString(),
          orderId: o1._id.toString(),
          orderNo: o1.orderNo,
          customerName: 'Ananya Iyer',
          vendorName: 'Alpha Fresh',
          method: 'online',
          status: 'paid',
          amountPaise: 19_950,
          refundedPaise: 0,
          provider: 'razorpay',
          gatewayRef: 'pay_TESTONE',
          at: '2026-09-20T10:00:00.000Z',
        });

        const cash = res.body.data.find((row: { id: string }) => row.id === o2._id.toString());
        expect(cash.provider).toBe('cod');
        expect(cash.gatewayRef).toBeNull();
      });

      it('filters by method', async () => {
        const res = await get('/admin/payments?method=cod&page=1&limit=12');
        expect(res.status).toBe(200);
        expect(ids(res.body).sort()).toEqual([o2, o3].map((o) => o._id.toString()).sort());
      });

      it('filters by status', async () => {
        const res = await get('/admin/payments?status=paid&page=1&limit=12');
        expect(ids(res.body).sort()).toEqual(
          [o1, o2, o5].map((o) => o._id.toString()).sort(),
        );
      });

      it('searches order number, gateway ref, customer name and store name', async () => {
        const byStore = await get('/admin/payments?q=alpha&page=1&limit=12');
        expect(ids(byStore.body).sort()).toEqual(
          [o1, o3, o5].map((o) => o._id.toString()).sort(),
        );

        const byCustomer = await get('/admin/payments?q=Rahul&page=1&limit=12');
        expect(ids(byCustomer.body).sort()).toEqual(
          [o2, o4].map((o) => o._id.toString()).sort(),
        );

        const byGateway = await get('/admin/payments?q=pay_TESTONE&page=1&limit=12');
        expect(ids(byGateway.body)).toEqual([o1._id.toString()]);

        const byOrderNo = await get(`/admin/payments?q=${o4.orderNo.slice(-4)}&page=1&limit=12`);
        expect(ids(byOrderNo.body)).toContain(o4._id.toString());
      });

      it('treats a search term as text, not as a pattern', async () => {
        const res = await get(`/admin/payments?q=${encodeURIComponent('.*')}&page=1&limit=12`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
      });

      it('includes the whole of a bare `to` day', async () => {
        // o3 was placed at 12:00 on the 21st. As midnight, `to=2026-09-21`
        // would have dropped it.
        const res = await get('/admin/payments?from=2026-09-21&to=2026-09-21&page=1&limit=12');
        expect(ids(res.body).sort()).toEqual([o2, o3].map((o) => o._id.toString()).sort());
      });

      it('combines filters, and pages with a truthful meta', async () => {
        const res = await get(
          '/admin/payments?method=online&status=paid&from=2026-08-01&to=2026-09-30&page=2&limit=1',
        );
        expect(res.body.meta).toEqual({ page: 2, limit: 1, total: 2, pages: 2 });
        expect(ids(res.body)).toEqual([o5._id.toString()]);
      });

      it('rejects a parameter the page does not send', async () => {
        const res = await get('/admin/payments?days=30');
        expect(res.status).toBe(400);
      });
    });

    // ── /admin/reports ────────────────────────────────────────────────

    describe('GET /admin/reports', () => {
      const WINDOW = 'from=2026-09-20&to=2026-09-22';

      it('returns exactly the row keys each report\'s columns read', async () => {
        const groupings: Record<string, string> = {
          sales: 'day',
          vendor_performance: 'vendor',
          product_performance: 'aisle',
          delivery_performance: 'day',
          tax_summary: 'slab',
        };
        for (const [report, keys] of Object.entries(REPORT_ROW_KEYS)) {
          const res = await get(
            `/admin/reports?report=${report}&grouping=${groupings[report]}&${WINDOW}`,
          );
          expect([report, res.status]).toEqual([report, 200]);
          expect(res.body.data.length).toBeGreaterThan(0);
          for (const row of res.body.data) {
            expect([report, sortedKeys(row)]).toEqual([report, [...keys].sort()]);
          }
          expect(res.body.meta).toEqual({
            page: 1,
            limit: res.body.data.length,
            total: res.body.data.length,
            pages: 1,
          });
        }
      });

      it('sales by day: GMV is grandTotal over orders not cancelled or rejected', async () => {
        const res = await get(`/admin/reports?report=sales&grouping=day&${WINDOW}`);
        expect(res.body.data).toEqual([
          {
            date: '2026-09-20',
            orders: 1,
            gmvPaise: 19_950,
            aovPaise: 19_950,
            discountPaise: 1_000,
            commissionPaise: 2_000,
          },
          // o3 (cancelled, same day) is not here.
          {
            date: '2026-09-21',
            orders: 1,
            gmvPaise: 10_500,
            aovPaise: 10_500,
            discountPaise: 0,
            commissionPaise: 1_000,
          },
          {
            date: '2026-09-22',
            orders: 1,
            gmvPaise: 10_500,
            aovPaise: 10_500,
            discountPaise: 0,
            commissionPaise: 1_000,
          },
        ]);
      });

      it('sales by week and by month collapse into Monday / 1st-of-month buckets', async () => {
        const week = await get(`/admin/reports?report=sales&grouping=week&${WINDOW}`);
        // The 20th is a Sunday — the week of Monday the 14th.
        expect(week.body.data.map((r: { date: string; orders: number }) => [r.date, r.orders])).toEqual([
          ['2026-09-14', 1],
          ['2026-09-21', 2],
        ]);
        expect(week.body.data[1].aovPaise).toBe(10_500);

        const month = await get(`/admin/reports?report=sales&grouping=month&${WINDOW}`);
        expect(month.body.data).toEqual([
          expect.objectContaining({ date: '2026-09-01', orders: 3, gmvPaise: 40_950 }),
        ]);
      });

      it('vendor performance: cancellation rate over everything placed, no rating', async () => {
        const res = await get(`/admin/reports?report=vendor_performance&grouping=vendor&${WINDOW}`);
        expect(res.body.data).toEqual([
          {
            vendorId: betaId.toString(),
            vendor: 'Beta Mart',
            city: 'Pune',
            orders: 2,
            gmvPaise: 21_000,
            commissionPaise: 2_000,
            cancelPct: 0,
          },
          {
            vendorId: alphaId.toString(),
            vendor: 'Alpha Fresh',
            city: 'Bengaluru',
            orders: 1,
            gmvPaise: 19_950,
            commissionPaise: 2_000,
            cancelPct: 50,
          },
        ]);
      });

      it('product performance: fulfilled lines by aisle, shares summing to 100', async () => {
        const res = await get(`/admin/reports?report=product_performance&grouping=aisle&${WINDOW}`);
        expect(res.body.data).toEqual([
          { aisleKey: 'fruits', products: 1, units: 3, gmvPaise: 30_000, sharePct: 75 },
          { aisleKey: 'dairy', products: 1, units: 1, gmvPaise: 10_000, sharePct: 25 },
        ]);
      });

      it('delivery performance: a day with only a failure has no average, not a zero', async () => {
        const res = await get(`/admin/reports?report=delivery_performance&grouping=day&${WINDOW}`);
        expect(res.body.data).toEqual([
          { date: '2026-09-20', deliveries: 1, avgMinutes: 25, onTimePct: 100, failed: 0 },
          // 45 minutes against the default 30-minute SLA.
          { date: '2026-09-21', deliveries: 1, avgMinutes: 45, onTimePct: 0, failed: 0 },
          { date: '2026-09-22', deliveries: 0, avgMinutes: null, onTimePct: null, failed: 1 },
        ]);
      });

      it('tax summary: delivered orders by the rate actually charged', async () => {
        const res = await get(`/admin/reports?report=tax_summary&grouping=slab&${WINDOW}`);
        expect(res.body.data).toEqual([
          { slab: '5%', orders: 2, taxablePaise: 29_000, taxPaise: 1_450 },
        ]);
      });

      it('defaults the grouping when the page has not sent one', async () => {
        const res = await get(`/admin/reports?report=sales&${WINDOW}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(3);
      });

      it('rejects a grouping the report cannot produce', async () => {
        const res = await get(`/admin/reports?report=vendor_performance&grouping=day&${WINDOW}`);
        expect(res.status).toBe(400);
      });

      it('rejects an unknown report, and a parameter the page does not send', async () => {
        expect((await get('/admin/reports?report=profit')).status).toBe(400);
        expect((await get('/admin/reports?report=sales&days=30')).status).toBe(400);
        expect((await get('/admin/reports')).status).toBe(400);
      });
    });

    // ── POST /admin/payments/:id/refund ───────────────────────────────

    describe('POST /admin/payments/:id/refund', () => {
      const refundsFor = (orderId: Types.ObjectId) =>
        ledger.find({ orderId, type: LedgerEntryType.REFUND }).lean().exec();

      /** The AdminModule's own binding of the payment port. */
      const adminProvider = (): PaymentProvider =>
        ctx.moduleRef.select(AdminModule).get<PaymentProvider>(PAYMENT_PROVIDER, {
          strict: true,
        });

      afterEach(() => {
        jest.restoreAllMocks();
      });

      it('503s an online refund while the gateway has no keys, and writes nothing', async () => {
        const res = await post(`/admin/payments/${o1._id.toString()}/refund`, {
          amountPaise: 19_950,
          reason: 'Refunded from the admin console',
        });

        expect(res.status).toBe(503);
        expect(res.body.errors.code).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');

        const after = await orders.findById(o1._id).lean().exec();
        expect(after?.payment.status).toBe(PaymentStatus.PAID);
        expect(after?.payment.refundedAmount).toBe(0);
        expect(await refundsFor(o1._id)).toHaveLength(0);
      });

      it('records a partial COD refund against the vendor ledger', async () => {
        const res = await post(`/admin/payments/${o2._id.toString()}/refund`, {
          amountPaise: 5_000,
          reason: 'Two bottles arrived broken',
        });

        expect(res.status).toBe(200);
        expect(sortedKeys(res.body)).toEqual(PAYMENT_ROW_KEYS);
        expect(res.body).toMatchObject({
          id: o2._id.toString(),
          status: 'partially_refunded',
          refundedPaise: 5_000,
          amountPaise: 10_500,
        });

        const rows = await refundsFor(o2._id);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.amount).toBe(-5_000);
        expect(rows[0]?.vendorId.toString()).toBe(betaId.toString());
      });

      it('refuses more than what is left, and moves nothing', async () => {
        const res = await post(`/admin/payments/${o2._id.toString()}/refund`, {
          amountPaise: 5_501,
          reason: 'Too much',
        });
        expect(res.status).toBe(400);
        expect(res.body.errors.code).toBe('REFUND_EXCEEDS_REMAINING');
        expect(res.body.errors.remainingPaise).toBe(5_500);
        expect(await refundsFor(o2._id)).toHaveLength(1);
      });

      it('marks the payment refunded once the remainder goes back', async () => {
        const res = await post(`/admin/payments/${o2._id.toString()}/refund`, {
          amountPaise: 5_500,
          reason: 'Refunded from the admin console',
        });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: 'refunded', refundedPaise: 10_500 });

        const again = await post(`/admin/payments/${o2._id.toString()}/refund`, {
          amountPaise: 1,
          reason: 'Once more',
        });
        expect(again.status).toBe(409);
        expect(again.body.errors.code).toBe('PAYMENT_NOT_REFUNDABLE');
      });

      it('refuses to refund cash that was never collected', async () => {
        const res = await post(`/admin/payments/${o3._id.toString()}/refund`, {
          amountPaise: 100,
          reason: 'Never paid',
        });
        expect(res.status).toBe(409);
        expect(res.body.errors.code).toBe('PAYMENT_NOT_REFUNDABLE');
        expect(await refundsFor(o3._id)).toHaveLength(0);
      });

      it('records an online refund only after the gateway accepts it', async () => {
        const provider = adminProvider();
        jest.spyOn(provider, 'isConfigured').mockReturnValue(true);
        const refund = jest
          .spyOn(provider, 'refundPayment')
          .mockResolvedValue({ providerRefundId: 'rfnd_TEST', status: 'processed' });

        const res = await post(`/admin/payments/${o5._id.toString()}/refund`, {
          amountPaise: 10_000,
          reason: 'Customer changed their mind',
        });

        expect(res.status).toBe(200);
        expect(refund).toHaveBeenCalledWith(
          expect.objectContaining({ providerPaymentId: 'pay_TESTFIVE', amount: 10_000 }),
        );
        expect(res.body).toMatchObject({ status: 'partially_refunded', refundedPaise: 10_000 });

        const rows = await refundsFor(o5._id);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.note).toContain('rfnd_TEST');
      });

      it('puts the order back when the gateway refuses, and writes no ledger row', async () => {
        const provider = adminProvider();
        jest.spyOn(provider, 'isConfigured').mockReturnValue(true);
        jest
          .spyOn(provider, 'refundPayment')
          .mockRejectedValue(new ServiceUnavailableException('gateway down'));

        const res = await post(`/admin/payments/${o5._id.toString()}/refund`, {
          amountPaise: 5_000,
          reason: 'Second go',
        });
        expect(res.status).toBe(503);

        const after = await orders.findById(o5._id).lean().exec();
        expect(after?.payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
        expect(after?.payment.refundedAmount).toBe(10_000);
        expect(await refundsFor(o5._id)).toHaveLength(1);
      });

      it('validates the body and the id', async () => {
        const id = o4._id.toString();
        expect((await post(`/admin/payments/${id}/refund`, { amountPaise: 0, reason: 'x y z' })).status).toBe(400);
        expect((await post(`/admin/payments/${id}/refund`, { amountPaise: 1.5, reason: 'x y z' })).status).toBe(400);
        expect(
          (await post(`/admin/payments/${id}/refund`, { amountPaise: 1, reason: 'x y z', force: true })).status,
        ).toBe(400);
        expect(
          (await post(`/admin/payments/${new Types.ObjectId().toString()}/refund`, { amountPaise: 1, reason: 'x y z' }))
            .status,
        ).toBe(404);
      });
    });
  });
});
