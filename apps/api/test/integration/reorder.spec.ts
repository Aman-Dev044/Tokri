import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { Role } from '../../src/common/constants/roles.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import { VendorStatus } from '../../src/database/schemas/vendor.schema';
import { TestContext, closeTestApp, createTestApp, nextIp } from '../utils/test-app';
import { SeededStore, StoreSeeder, runPassword } from '../utils/store-fixtures';

/**
 * "Order again": `GET /orders/:id/reorder-preview`.
 *
 * Orders are written straight into the collection with the status the
 * case needs — the checkout path is covered by `shop.spec.ts`, and
 * walking every order to DELIVERED through the vendor and rider APIs
 * would make this spec about them instead.
 */
describe('Order again — reorder preview (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let seed: StoreSeeder;
  let orders: Model<OrderDocument>;

  let store: SeededStore;
  let customerId: Types.ObjectId;
  let customerToken: string;
  let otherToken: string;
  let orderCounter = 0;

  /** A DELIVERED order of `lines` at `store`, unless told otherwise. */
  async function seedOrder(
    vendorId: string,
    lines: { productId: string; name: string; price: number; qty: number }[],
    status: OrderStatus = OrderStatus.DELIVERED,
    owner: Types.ObjectId = customerId,
  ): Promise<string> {
    const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    const order = await orders.create({
      orderNo: `TKR-RO-${++orderCounter}`,
      customerId: owner,
      vendorId: new Types.ObjectId(vendorId),
      items: lines.map((line) => ({
        productId: new Types.ObjectId(line.productId),
        name: line.name,
        image: null,
        unit: 'g',
        price: line.price,
        qty: line.qty,
        lineTotal: line.price * line.qty,
      })),
      pricing: {
        itemsSubtotal: subtotal,
        grandTotal: subtotal,
        commissionPct: 12,
        commissionAmount: Math.round(subtotal * 0.12),
        vendorPayout: subtotal - Math.round(subtotal * 0.12),
      },
      address: {
        line1: '4 Reorder Road',
        city: 'Pune',
        pincode: '411001',
        location: { type: 'Point', coordinates: [73.857, 18.52] },
        phone: '9800000000',
      },
      payment: { method: PaymentMethod.COD, status: PaymentStatus.PAID },
      status,
      placedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      deliveredAt: status === OrderStatus.DELIVERED ? new Date() : null,
    });
    return order._id.toString();
  }

  const preview = (token: string, orderId: string) =>
    request(server)
      .get(`/orders/${orderId}/reorder-preview`)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
    seed = new StoreSeeder(ctx, runPassword());
    orders = ctx.app.get(getModelToken(Order.name));

    store = await seed.store('Reorder', [
      { name: 'Milk', price: 3000, mrp: 3200, stock: 50 },
      { name: 'Paneer', price: 9000, mrp: 9500, stock: 1 },
      { name: 'Curd', price: 4000, mrp: 4200, stock: 0 },
      { name: 'Ghee', price: 60000, mrp: 62000, stock: 50, isActive: false },
      { name: 'Eggs', price: 8000, mrp: 8400, stock: 50 },
    ]);

    const customer = await seed.user(Role.CUSTOMER, null);
    customerId = customer._id;
    customerToken = await seed.token(customer.phone);

    const other = await seed.user(Role.CUSTOMER, null);
    otherToken = await seed.token(other.phone);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  it('re-reads every line against the live catalogue: ok, reduced, out of stock, unavailable', async () => {
    const [milk, paneer, curd, ghee, eggs] = store.products;
    const deleted = new Types.ObjectId().toString();

    const orderId = await seedOrder(store.vendorId, [
      // The price has since gone UP — the old 2500 must not be trusted.
      { productId: milk.id, name: 'Milk', price: 2500, qty: 2 },
      { productId: paneer.id, name: 'Paneer', price: 9000, qty: 3 },
      { productId: curd.id, name: 'Curd', price: 4000, qty: 1 },
      { productId: ghee.id, name: 'Ghee', price: 60000, qty: 1 },
      { productId: deleted, name: 'Discontinued Biscuits', price: 1000, qty: 4 },
      // More than the per-line ceiling of 20.
      { productId: eggs.id, name: 'Eggs', price: 8000, qty: 25 },
    ]);

    const res = await preview(customerToken, orderId);
    expect(res.status).toBe(200);

    expect(res.body.orderId).toBe(orderId);
    expect(res.body.store).toEqual({
      id: store.vendorId,
      storeName: 'Reorder Store',
      slug: store.slug,
      availability: 'open',
    });

    const byName = new Map<string, Record<string, unknown>>(
      res.body.lines.map((line: { name: string }) => [line.name, line]),
    );

    expect(byName.get('Milk')).toMatchObject({
      status: 'ok',
      orderedQty: 2,
      qty: 2,
      orderedPrice: 2500,
      product: { id: milk.id, price: 3000, availableQty: 50 },
    });
    expect(byName.get('Paneer')).toMatchObject({
      status: 'reduced',
      orderedQty: 3,
      qty: 1,
    });
    expect(byName.get('Curd')).toMatchObject({
      status: 'out_of_stock',
      qty: 0,
      product: { id: curd.id, inStock: false },
    });
    expect(byName.get('Ghee')).toMatchObject({
      status: 'unavailable',
      qty: 0,
      product: null,
    });
    expect(byName.get('Discontinued Biscuits')).toMatchObject({
      productId: deleted,
      status: 'unavailable',
      qty: 0,
      product: null,
    });
    expect(byName.get('Eggs')).toMatchObject({ status: 'reduced', qty: 20 });

    expect(res.body.addableCount).toBe(3);
  });

  it('merges a product that appears twice on the order into one line', async () => {
    const [milk] = store.products;
    const orderId = await seedOrder(store.vendorId, [
      { productId: milk.id, name: 'Milk', price: 3000, qty: 1 },
      { productId: milk.id, name: 'Milk', price: 3000, qty: 2 },
    ]);

    const res = await preview(customerToken, orderId);
    expect(res.status).toBe(200);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({ orderedQty: 3, qty: 3, status: 'ok' });
  });

  it('a product moved to ANOTHER store is unavailable here, never added across stores', async () => {
    const elsewhere = await seed.store('Elsewhere', [
      { name: 'Bread', price: 4500, mrp: 5000 },
    ]);
    const orderId = await seedOrder(store.vendorId, [
      { productId: elsewhere.products[0].id, name: 'Bread', price: 4500, qty: 1 },
    ]);

    const res = await preview(customerToken, orderId);
    expect(res.status).toBe(200);
    expect(res.body.lines[0]).toMatchObject({ status: 'unavailable', qty: 0, product: null });
    expect(res.body.addableCount).toBe(0);
  });

  it('a closed store adds nothing', async () => {
    const closed = await seed.store('Closed', [
      { name: 'Atta', price: 30000, mrp: 32000, stock: 50 },
    ]);
    await seed.vendors.updateOne(
      { _id: new Types.ObjectId(closed.vendorId) },
      { $set: { isOpen: false } },
    );
    const orderId = await seedOrder(closed.vendorId, [
      { productId: closed.products[0].id, name: 'Atta', price: 30000, qty: 1 },
    ]);

    const res = await preview(customerToken, orderId);
    expect(res.status).toBe(200);
    expect(res.body.store.availability).toBe('closed');
    expect(res.body.lines[0]).toMatchObject({ status: 'unavailable', qty: 0, product: null });
    expect(res.body.addableCount).toBe(0);
  });

  it('a store that is no longer approved is unavailable', async () => {
    const suspended = await seed.store('Suspended', [
      { name: 'Rice', price: 50000, mrp: 52000, stock: 50 },
    ]);
    await seed.vendors.updateOne(
      { _id: new Types.ObjectId(suspended.vendorId) },
      { $set: { status: VendorStatus.SUSPENDED } },
    );
    const orderId = await seedOrder(suspended.vendorId, [
      { productId: suspended.products[0].id, name: 'Rice', price: 50000, qty: 1 },
    ]);

    const res = await preview(customerToken, orderId);
    expect(res.status).toBe(200);
    expect(res.body.store.availability).toBe('unavailable');
    expect(res.body.addableCount).toBe(0);
  });

  it('only a DELIVERED order can be ordered again', async () => {
    const orderId = await seedOrder(
      store.vendorId,
      [{ productId: store.products[0].id, name: 'Milk', price: 3000, qty: 1 }],
      OrderStatus.PLACED,
    );

    const res = await preview(customerToken, orderId);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('ORDER_NOT_DELIVERED');
  });

  it("another customer's order is a 404, exactly like an unknown or malformed id", async () => {
    const orderId = await seedOrder(store.vendorId, [
      { productId: store.products[0].id, name: 'Milk', price: 3000, qty: 1 },
    ]);

    expect((await preview(otherToken, orderId)).status).toBe(404);
    expect((await preview(customerToken, new Types.ObjectId().toString())).status).toBe(404);
    expect((await preview(customerToken, 'not-an-id')).status).toBe(404);
  });

  it('is CUSTOMER only: no token is 401, a vendor token is 403', async () => {
    const orderId = await seedOrder(store.vendorId, [
      { productId: store.products[0].id, name: 'Milk', price: 3000, qty: 1 },
    ]);

    const anonymous = await request(server)
      .get(`/orders/${orderId}/reorder-preview`)
      .set('X-Forwarded-For', nextIp());
    expect(anonymous.status).toBe(401);

    expect((await preview(store.ownerToken, orderId)).status).toBe(403);
  });
});
