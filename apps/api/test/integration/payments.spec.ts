import 'reflect-metadata';
import { createHmac } from 'node:crypto';
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
import {
  Inventory,
  InventoryDocument,
} from '../../src/database/schemas/inventory.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { AisleKey } from '../../src/common/constants/aisle.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/** Generated per run, never a literal. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const STORE: [number, number] = [77.6101, 12.9352];
const DROP: [number, number] = [77.6201, 12.9302];

/**
 * ════════════════════════════════════════════════════════════════════════
 *  PAYMENTS — INTEGRATION
 * ════════════════════════════════════════════════════════════════════════
 *
 * Two separate `TestContext`s, deliberately:
 *
 *   `noKeys`      No RAZORPAY_* env at all — proves the platform's
 *                 default posture: online checkout refuses cleanly
 *                 (503), COD is entirely unaffected (201).
 *
 *   `configured`  All three RAZORPAY_* vars set to test-only, generated
 *                 values before this context's Nest app is compiled.
 *                 Nothing in this context ever calls the REAL gateway:
 *                 `verifySignature` and `verifyWebhookSignature` are
 *                 pure HMAC math, and the orders used here are inserted
 *                 directly (bypassing `POST /checkout`, which is the
 *                 only code path that would open a real network
 *                 connection to Razorpay). The two background sweepers
 *                 never run inside Jest (see their own `onModuleInit`),
 *                 so nothing races these assertions either.
 */
describe('Payments (integration)', () => {
  describe('online payment gate — no gateway configured', () => {
    let ctx: TestContext;
    let server: Server;
    let users: Model<UserDocument>;
    let vendors: Model<VendorDocument>;
    let categories: Model<CategoryDocument>;
    let products: Model<ProductDocument>;
    let inventory: Model<InventoryDocument>;
    let passwords: PasswordService;

    let vendorId: Types.ObjectId;
    let productId: Types.ObjectId;

    beforeAll(async () => {
      ctx = await createTestApp();
      server = ctx.app.getHttpServer() as Server;

      users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
      vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
      categories = ctx.app.get<Model<CategoryDocument>>(getModelToken(Category.name));
      products = ctx.app.get<Model<ProductDocument>>(getModelToken(Product.name));
      inventory = ctx.app.get<Model<InventoryDocument>>(getModelToken(Inventory.name));
      passwords = ctx.app.get(PasswordService);

      const hash = await passwords.hash(PASSWORD);

      const owner = await users.create({
        name: 'Pay Store Owner',
        email: 'pay-owner@test.invalid',
        phone: '9700000010',
        passwordHash: hash,
        role: Role.VENDOR,
        status: UserStatus.ACTIVE,
      });

      const vendor = await vendors.create({
        ownerId: owner._id,
        storeName: 'Pay Test Store',
        slug: 'pay-test-store',
        address: { line1: '1 Market Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560034' },
        location: { type: 'Point', coordinates: STORE },
        serviceRadiusKm: 5,
        commissionPct: 10,
        codEnabled: true,
        codMaxAmount: 200_000,
        isOpen: true,
        status: VendorStatus.APPROVED,
      });
      vendorId = vendor._id;

      const category = await categories.create({
        vendorId,
        name: 'Snacks',
        slug: 'snacks-pay',
        aisleKey: AisleKey.SNACKS,
        isActive: true,
      });

      const product = await products.create({
        vendorId,
        categoryId: category._id,
        name: 'Test Chips',
        slug: 'test-chips',
        images: [],
        unit: ProductUnit.G,
        unitValue: 100,
        sku: 'PAY-1',
        mrp: 5_000,
        price: 4_500,
        isActive: true,
        searchText: 'test chips',
      });
      productId = product._id;

      await inventory.create({ vendorId, productId, stock: 20, reserved: 0 });
    }, 180_000);

    afterAll(async () => {
      if (ctx) await closeTestApp(ctx);
    });

    async function customer(): Promise<{ token: string; addressId: string }> {
      const n = Math.random().toString(36).slice(2, 8);
      const email = `payer-${n}@test.invalid`;
      const hash = await passwords.hash(PASSWORD);
      await users.create({
        name: `Payer ${n}`,
        email,
        phone: `98${n}`.padEnd(10, '0').slice(0, 10),
        passwordHash: hash,
        role: Role.CUSTOMER,
        status: UserStatus.ACTIVE,
      });

      const login = await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ identifier: email, password: PASSWORD });
      expect(login.status).toBe(200);
      const token = login.body.accessToken as string;

      const address = await request(server)
        .post('/addresses')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          label: 'Home',
          line1: `${n} Pay Street`,
          city: 'Bengaluru',
          pincode: '560034',
          lat: DROP[1],
          lng: DROP[0],
          phone: '9800000000',
        });
      expect(address.status).toBe(201);

      const cart = await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', nextIp())
        .send({ vendorId: vendorId.toString(), productId: productId.toString(), qty: 1 });
      expect(cart.status).toBe(201);

      return { token, addressId: address.body.id as string };
    }

    it('refuses ONLINE checkout with a clean 503 when the gateway is not configured', async () => {
      const shopper = await customer();

      const res = await request(server)
        .post('/checkout')
        .set('Authorization', `Bearer ${shopper.token}`)
        .set('X-Forwarded-For', nextIp())
        .set('Idempotency-Key', `pay-online-${Date.now()}`)
        .send({ vendorId: vendorId.toString(), addressId: shopper.addressId, paymentMethod: 'online' });

      expect(res.status).toBe(503);
      expect(res.body.errors.code).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
    });

    it('COD checkout is completely unaffected', async () => {
      const shopper = await customer();

      const res = await request(server)
        .post('/checkout')
        .set('Authorization', `Bearer ${shopper.token}`)
        .set('X-Forwarded-For', nextIp())
        .set('Idempotency-Key', `pay-cod-${Date.now()}`)
        .send({ vendorId: vendorId.toString(), addressId: shopper.addressId, paymentMethod: 'cod' });

      expect(res.status).toBe(201);
      expect(res.body.payment.method).toBe('cod');
      expect(res.body.payment.status).toBe('pending');
      expect(res.body.gatewayOrder).toBeNull();
    });

    it('POST /webhooks/razorpay answers 401 when no webhook secret is configured', async () => {
      const res = await request(server)
        .post('/webhooks/razorpay')
        .set('X-Forwarded-For', nextIp())
        .set('x-razorpay-signature', 'irrelevant')
        .send({ id: 'evt_1', event: 'payment.captured' });

      expect(res.status).toBe(401);
    });
  });

  describe('webhook and client verification — gateway configured', () => {
    let ctx: TestContext;
    let server: Server;
    let users: Model<UserDocument>;
    let vendors: Model<VendorDocument>;
    let orders: Model<OrderDocument>;
    let inventory: Model<InventoryDocument>;
    let passwords: PasswordService;

    const WEBHOOK_SECRET = `whsec_${Math.random().toString(36).slice(2)}`;
    const KEY_SECRET = `keysecret_${Math.random().toString(36).slice(2)}`;

    let vendorId: Types.ObjectId;
    let customerId: Types.ObjectId;
    let productId: Types.ObjectId;
    let customerToken: string;

    /** Inserts an ONLINE, PENDING order directly — never through checkout. */
    async function seedOnlineOrder(providerOrderId: string, qty = 2): Promise<Types.ObjectId> {
      const order = await orders.create({
        orderNo: `TKR-TEST-${Math.random().toString(36).slice(2, 8)}`,
        customerId,
        vendorId,
        items: [
          {
            productId,
            name: 'Test Chips',
            unit: '100g',
            price: 4_500,
            qty,
            lineTotal: 4_500 * qty,
            fulfilled: true,
          },
        ],
        pricing: {
          itemsSubtotal: 4_500 * qty,
          discount: 0,
          deliveryFee: 2_000,
          taxes: 0,
          grandTotal: 4_500 * qty + 2_000,
          commissionPct: 10,
          commissionAmount: 450 * qty,
          vendorPayout: 4_050 * qty,
        },
        address: {
          line1: '1 Pay Street',
          city: 'Bengaluru',
          pincode: '560034',
          location: { type: 'Point', coordinates: DROP },
          phone: '9800000000',
        },
        payment: {
          method: PaymentMethod.ONLINE,
          status: PaymentStatus.PENDING,
          provider: 'razorpay',
          providerOrderId,
          refundedAmount: 0,
        },
        status: OrderStatus.PLACED,
        statusHistory: [
          { from: null, to: OrderStatus.PLACED, byUserId: customerId, byRole: Role.CUSTOMER, at: new Date() },
        ],
        deliveryOtpHash: 'x',
        placedAt: new Date(),
      });

      await inventory.updateOne(
        { productId },
        { $inc: { stock: -qty, reserved: qty } },
      ).exec();

      return order._id;
    }

    function sign(secret: string, raw: string): string {
      return createHmac('sha256', secret).update(raw).digest('hex');
    }

    beforeAll(async () => {
      // Set BEFORE createTestApp() compiles the module graph, exactly
      // like `applyTestEnv` sets the JWT secrets.
      process.env.RAZORPAY_KEY_ID = `rzp_test_${Math.random().toString(36).slice(2)}`;
      process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
      process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

      ctx = await createTestApp();
      server = ctx.app.getHttpServer() as Server;

      users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
      vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
      orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
      inventory = ctx.app.get<Model<InventoryDocument>>(getModelToken(Inventory.name));
      passwords = ctx.app.get(PasswordService);

      const productsModel = ctx.app.get<Model<ProductDocument>>(getModelToken(Product.name));
      const categoriesModel = ctx.app.get<Model<CategoryDocument>>(getModelToken(Category.name));

      const hash = await passwords.hash(PASSWORD);

      const owner = await users.create({
        name: 'Webhook Store Owner',
        email: 'webhook-owner@test.invalid',
        phone: '9700000020',
        passwordHash: hash,
        role: Role.VENDOR,
        status: UserStatus.ACTIVE,
      });

      const vendor = await vendors.create({
        ownerId: owner._id,
        storeName: 'Webhook Test Store',
        slug: 'webhook-test-store',
        address: { line1: '1 Market Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560034' },
        location: { type: 'Point', coordinates: STORE },
        serviceRadiusKm: 5,
        commissionPct: 10,
        codEnabled: true,
        codMaxAmount: 200_000,
        isOpen: true,
        status: VendorStatus.APPROVED,
      });
      vendorId = vendor._id;

      const category = await categoriesModel.create({
        vendorId,
        name: 'Snacks',
        slug: 'snacks-webhook',
        aisleKey: AisleKey.SNACKS,
        isActive: true,
      });

      const product = await productsModel.create({
        vendorId,
        categoryId: category._id,
        name: 'Test Chips',
        slug: 'webhook-test-chips',
        images: [],
        unit: ProductUnit.G,
        unitValue: 100,
        sku: 'PAY-2',
        mrp: 5_000,
        price: 4_500,
        isActive: true,
        searchText: 'test chips',
      });
      productId = product._id;

      await inventory.create({ vendorId, productId, stock: 20, reserved: 0 });

      const customerEmail = 'webhook-customer@test.invalid';
      const customerUser = await users.create({
        name: 'Webhook Customer',
        email: customerEmail,
        phone: '9800000099',
        passwordHash: hash,
        role: Role.CUSTOMER,
        status: UserStatus.ACTIVE,
      });
      customerId = customerUser._id;

      const login = await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ identifier: customerEmail, password: PASSWORD });
      expect(login.status).toBe(200);
      customerToken = login.body.accessToken as string;
    }, 180_000);

    afterAll(async () => {
      if (ctx) await closeTestApp(ctx);
    });

    it('rejects a webhook with a bad signature — 401', async () => {
      const payload = JSON.stringify({
        id: `evt_bad_${Date.now()}`,
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x', status: 'captured' } } },
      });

      const res = await request(server)
        .post('/webhooks/razorpay')
        .set('X-Forwarded-For', nextIp())
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', '0'.repeat(64)) // well-formed hex, wrong value
        .send(payload);

      expect(res.status).toBe(401);
    });

    it('payment.captured confirms the order and clears the reservation', async () => {
      const providerOrderId = `order_captured_${Date.now()}`;
      const orderId = await seedOnlineOrder(providerOrderId, 2);

      const before = await inventory.findOne({ productId }).lean().exec();
      expect(before?.reserved).toBeGreaterThanOrEqual(2);

      const payload = JSON.stringify({
        id: `evt_captured_${Date.now()}`,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: `pay_${Date.now()}`, order_id: providerOrderId, status: 'captured' },
          },
        },
      });
      const signature = sign(WEBHOOK_SECRET, payload);

      const res = await request(server)
        .post('/webhooks/razorpay')
        .set('X-Forwarded-For', nextIp())
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });

      const order = await orders.findById(orderId).lean().exec();
      expect(order?.payment.status).toBe(PaymentStatus.PAID);
      expect(order?.status).toBe(OrderStatus.PLACED); // unchanged — payment doesn't move fulfilment state

      const afterInv = await inventory.findOne({ productId }).lean().exec();
      expect(afterInv?.reserved).toBe((before?.reserved ?? 0) - 2);
      expect(afterInv?.stock).toBe(before?.stock); // stock was already decremented at checkout
    });

    it('a replayed event.id is a no-op (dedup on the provider event id, §8.3)', async () => {
      const providerOrderId = `order_replay_${Date.now()}`;
      const orderId = await seedOnlineOrder(providerOrderId, 1);

      const payload = JSON.stringify({
        id: `evt_replay_${Date.now()}`,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: `pay_replay_${Date.now()}`, order_id: providerOrderId, status: 'captured' },
          },
        },
      });
      const signature = sign(WEBHOOK_SECRET, payload);

      const first = await request(server)
        .post('/webhooks/razorpay')
        .set('X-Forwarded-For', nextIp())
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .send(payload);
      expect(first.status).toBe(200);

      const afterFirst = await inventory.findOne({ productId }).lean().exec();

      // Razorpay redelivers the SAME event verbatim — same body, same
      // (therefore still-valid) signature.
      const second = await request(server)
        .post('/webhooks/razorpay')
        .set('X-Forwarded-For', nextIp())
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .send(payload);
      expect(second.status).toBe(200);

      const afterSecond = await inventory.findOne({ productId }).lean().exec();
      // NOT decremented again — the second delivery is a pure no-op.
      expect(afterSecond?.reserved).toBe(afterFirst?.reserved);

      const order = await orders.findById(orderId).lean().exec();
      expect(order?.payment.status).toBe(PaymentStatus.PAID);
    });

    it('payment.failed releases the reservation and marks the payment failed', async () => {
      const providerOrderId = `order_failed_${Date.now()}`;
      const orderId = await seedOnlineOrder(providerOrderId, 3);
      const before = await inventory.findOne({ productId }).lean().exec();

      const payload = JSON.stringify({
        id: `evt_failed_${Date.now()}`,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: { id: `pay_failed_${Date.now()}`, order_id: providerOrderId, status: 'failed' },
          },
        },
      });
      const signature = sign(WEBHOOK_SECRET, payload);

      const res = await request(server)
        .post('/webhooks/razorpay')
        .set('X-Forwarded-For', nextIp())
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', signature)
        .send(payload);
      expect(res.status).toBe(200);

      const order = await orders.findById(orderId).lean().exec();
      expect(order?.payment.status).toBe(PaymentStatus.FAILED);
      expect(order?.status).toBe(OrderStatus.CANCELLED);

      const after = await inventory.findOne({ productId }).lean().exec();
      expect(after?.reserved).toBe((before?.reserved ?? 0) - 3);
      expect(after?.stock).toBe((before?.stock ?? 0) + 3);
    });

    it('POST /payments/:orderId/verify confirms the order when the webhook has not landed yet', async () => {
      const providerOrderId = `order_client_${Date.now()}`;
      const orderId = await seedOnlineOrder(providerOrderId, 1);
      const providerPaymentId = `pay_client_${Date.now()}`;

      const signature = sign(KEY_SECRET, `${providerOrderId}|${providerPaymentId}`);

      const res = await request(server)
        .post(`/payments/${orderId.toString()}/verify`)
        .set('Authorization', `Bearer ${customerToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({ providerOrderId, providerPaymentId, signature });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(PaymentStatus.PAID);

      const order = await orders.findById(orderId).lean().exec();
      expect(order?.payment.status).toBe(PaymentStatus.PAID);
      expect(order?.payment.providerPaymentId).toBe(providerPaymentId);
    });

    it('POST /payments/:orderId/verify rejects a forged signature', async () => {
      const providerOrderId = `order_forged_${Date.now()}`;
      const orderId = await seedOnlineOrder(providerOrderId, 1);

      const res = await request(server)
        .post(`/payments/${orderId.toString()}/verify`)
        .set('Authorization', `Bearer ${customerToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          providerOrderId,
          providerPaymentId: 'pay_forged',
          signature: '0'.repeat(64),
        });

      expect(res.status).toBe(401);

      const order = await orders.findById(orderId).lean().exec();
      expect(order?.payment.status).toBe(PaymentStatus.PENDING);
    });

    it('404s (never 401/403) when another customer tries to verify someone else\'s order', async () => {
      const providerOrderId = `order_notmine_${Date.now()}`;
      const orderId = await seedOnlineOrder(providerOrderId, 1);

      const otherEmail = `not-the-owner-${Date.now()}@test.invalid`;
      await users.create({
        name: 'Not The Owner',
        email: otherEmail,
        phone: '9800000077',
        passwordHash: await passwords.hash(PASSWORD),
        role: Role.CUSTOMER,
        status: UserStatus.ACTIVE,
      });
      const login = await request(server)
        .post('/auth/login')
        .set('X-Forwarded-For', nextIp())
        .send({ identifier: otherEmail, password: PASSWORD });
      const otherToken = login.body.accessToken as string;

      const res = await request(server)
        .post(`/payments/${orderId.toString()}/verify`)
        .set('Authorization', `Bearer ${otherToken}`)
        .set('X-Forwarded-For', nextIp())
        .send({ providerOrderId, providerPaymentId: 'pay_x', signature: '0'.repeat(64) });

      expect(res.status).toBe(404);
    });
  });
});
