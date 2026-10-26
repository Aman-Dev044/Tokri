import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { User, UserDocument } from '../../src/database/schemas/user.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import { Vendor, VendorDocument, VendorStatus } from '../../src/database/schemas/vendor.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { OrderStatus } from '../../src/common/constants/order-status.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { TestContext, closeTestApp, createTestApp, nextIp } from '../utils/test-app';

/** Generated per run, never a literal. Long enough for the DTO. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * GET /admin/customers/:id — the detail page read `lifetime` and `orders`
 * off a fixture, so a real customer took the page down. Both now come from
 * the customer's orders; this pins every figure to the orders behind it.
 */
describe('Admin customer detail (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let users: Model<UserDocument>;
  let orders: Model<OrderDocument>;
  let vendors: Model<VendorDocument>;
  let passwords: PasswordService;
  let adminToken: string;
  let counter = 0;

  async function seedUser(role: Role) {
    const n = String(++counter).padStart(4, '0');
    return users.create({
      name: `Detail ${role} ${n}`,
      email: `detail${n}@test.invalid`,
      phone: `96${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role,
      status: UserStatus.ACTIVE,
    });
  }

  /**
   * Straight into the collection: the read under test touches only these
   * fields, and a full order needs a cart, a quote and an address to build.
   */
  async function seedOrder(
    customerId: Types.ObjectId,
    vendorId: Types.ObjectId,
    o: { status: OrderStatus; total: number; refunded?: number; qtys: number[]; placedAt: Date },
  ) {
    const _id = new Types.ObjectId();
    await orders.collection.insertOne({
      _id,
      orderNo: `TST-${++counter}`,
      customerId,
      vendorId,
      status: o.status,
      items: o.qtys.map((qty) => ({ qty })),
      pricing: { grandTotal: o.total },
      payment: { refundedAmount: o.refunded ?? 0 },
      placedAt: o.placedAt,
    });
    return _id;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
    vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
    passwords = ctx.app.get(PasswordService);

    const admin = await seedUser(Role.ADMIN);
    const res = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: admin.email, password: PASSWORD });
    expect(res.status).toBe(200);
    adminToken = res.body.accessToken as string;
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  const get = (path: string) =>
    request(server)
      .get(path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${adminToken}`);

  it('returns zeroed lifetime figures and no orders for a customer who never ordered', async () => {
    const customer = await seedUser(Role.CUSTOMER);

    const res = await get(`/admin/customers/${customer._id.toString()}`);

    expect(res.status).toBe(200);
    expect(res.body.orders).toEqual([]);
    expect(res.body.lifetime).toEqual({
      ordersCount: 0,
      grossPaise: 0,
      avgOrderPaise: 0,
      refundedPaise: 0,
      cancelledCount: 0,
      firstOrderAt: null,
      spark: [0, 0, 0, 0, 0, 0],
    });
  });

  it('counts lifetime figures from the orders and lists them newest first', async () => {
    const customer = await seedUser(Role.CUSTOMER);
    const owner = await seedUser(Role.VENDOR);
    const vendor = await vendors.create({
      ownerId: owner._id,
      storeName: 'Detail Kirana',
      slug: `detail-kirana-${Date.now()}`,
      address: { line1: '2 Bazaar Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      location: { type: 'Point', coordinates: [73.85, 18.52] },
      commissionPct: 12,
      status: VendorStatus.APPROVED,
    });

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const first = new Date(now - 3 * day);
    await seedOrder(customer._id, vendor._id, {
      status: OrderStatus.DELIVERED,
      total: 40_000,
      refunded: 5_000,
      qtys: [2, 1],
      placedAt: first,
    });
    const newest = await seedOrder(customer._id, vendor._id, {
      status: OrderStatus.DELIVERED,
      total: 20_000,
      qtys: [4],
      placedAt: new Date(now - day),
    });
    // Cancelled: counted as cancelled, kept out of spend and averages.
    await seedOrder(customer._id, vendor._id, {
      status: OrderStatus.CANCELLED,
      total: 99_000,
      qtys: [1],
      placedAt: new Date(now - 2 * day),
    });

    const res = await get(`/admin/customers/${customer._id.toString()}`);

    expect(res.status).toBe(200);
    expect(res.body.orderCount).toBe(2);
    expect(res.body.totalSpend).toBe(60_000);
    expect(res.body.lifetime).toMatchObject({
      ordersCount: 2,
      grossPaise: 60_000,
      avgOrderPaise: 30_000,
      refundedPaise: 5_000,
      cancelledCount: 1,
      firstOrderAt: first.toISOString(),
    });
    expect(res.body.lifetime.spark).toHaveLength(6);
    expect(
      (res.body.lifetime.spark as number[]).reduce((a, b) => a + b, 0),
    ).toBe(60_000);

    expect(res.body.orders).toHaveLength(3);
    expect(res.body.orders[0]).toEqual({
      id: newest.toString(),
      orderNo: expect.any(String),
      vendorName: 'Detail Kirana',
      status: OrderStatus.DELIVERED,
      itemCount: 4,
      totalPaise: 20_000,
      placedAt: expect.any(String),
    });
    expect(res.body.orders.map((o: { status: string }) => o.status)).toEqual([
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.DELIVERED,
    ]);
  });
});
