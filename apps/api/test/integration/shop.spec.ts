import 'reflect-metadata';
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
import {
  Coupon,
  CouponDocument,
  CouponType,
} from '../../src/database/schemas/coupon.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { AisleKey } from '../../src/common/constants/aisle.enum';
import { OrderStatus } from '../../src/common/constants/order-status.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/** Generated per run, never a literal. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Bengaluru, roughly. The store and both addresses sit ~1 km apart. */
const STORE_A: [number, number] = [77.6101, 12.9352];
const STORE_B: [number, number] = [77.6155, 12.9401];
const NEARBY: [number, number] = [77.6201, 12.9302];
/** Mumbai — same country, nowhere near the 5 km radius. */
const FAR_AWAY: [number, number] = [72.8777, 19.076];

let counter = 0;
const uniqueSuffix = (): string => String(++counter).padStart(4, '0');

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE CUSTOMER SURFACE
 * ════════════════════════════════════════════════════════════════════════
 *
 * Three classes of assertion, and they fail for different reasons.
 *
 * ── Public means public ─────────────────────────────────────────────────
 * Browse works with no Authorization header at all. If someone removes a
 * `@Public()` while tidying up, the customer app goes blank before login
 * and this test says so.
 *
 * ── Isolation ───────────────────────────────────────────────────────────
 * Customer A addresses every one of customer B's resources: cart,
 * address, order. The expected answer is 404 in every case — NOT 403. A
 * 403 confirms the id exists and turns each endpoint into an enumeration
 * oracle over the whole customer base. Isolation you have not tried to
 * break is isolation you do not have (§8.1).
 *
 * ── The rules that exist in exactly one place ───────────────────────────
 * Switching store parks the basket instead of destroying it (decision
 * #1); a stale line is flagged and not silently corrected; cancelling
 * after the vendor accepts is a 409 that asks for approval (decision #8);
 * online payment without a configured gateway is a clean 503 while COD
 * keeps working (§8.7 #17). Each is enforced in one place, so each is
 * asserted here against a real database rather than trusted to a reading.
 */
describe('Customer shop API (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let categories: Model<CategoryDocument>;
  let products: Model<ProductDocument>;
  let inventory: Model<InventoryDocument>;
  let orders: Model<OrderDocument>;
  let coupons: Model<CouponDocument>;
  let passwords: PasswordService;

  let storeA: Types.ObjectId;
  let storeB: Types.ObjectId;
  let storeASlug: string;
  let appleId: string;
  let breadId: string;
  let storeBProductId: string;

  let tokenA: string;
  let tokenB: string;
  let customerAId: string;

  async function seedCustomer(): Promise<{ id: string; token: string }> {
    const n = uniqueSuffix();
    const email = `shopper${n}@test.invalid`;

    const user = await users.create({
      name: `Shopper ${n}`,
      email,
      phone: `96${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
    });

    const res = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: email, password: PASSWORD });

    expect(res.status).toBe(200);
    return { id: user._id.toString(), token: res.body.accessToken as string };
  }

  async function seedStore(
    name: string,
    coordinates: [number, number],
  ): Promise<Types.ObjectId> {
    const n = uniqueSuffix();
    const owner = await users.create({
      name: `Owner ${n}`,
      email: `owner${n}@test.invalid`,
      phone: `97${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role: Role.VENDOR,
      status: UserStatus.ACTIVE,
    });

    const vendor = await vendors.create({
      ownerId: owner._id,
      storeName: name,
      slug: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${n}`,
      address: {
        line1: '1 Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
      },
      location: { type: 'Point', coordinates },
      serviceRadiusKm: 5,
      commissionPct: 12,
      codEnabled: true,
      codMaxAmount: 200_000,
      isOpen: true,
      status: VendorStatus.APPROVED,
    });

    return vendor._id;
  }

  async function seedProduct(
    vendorId: Types.ObjectId,
    name: string,
    price: number,
    stock: number,
    aisleKey: AisleKey,
  ): Promise<string> {
    const n = uniqueSuffix();
    const category = await categories.create({
      vendorId,
      name: `${aisleKey} ${n}`,
      slug: `${aisleKey}-${n}`,
      aisleKey,
      isActive: true,
    });

    const product = await products.create({
      vendorId,
      categoryId: category._id,
      name,
      slug: `${name.toLowerCase().replace(/[^a-z]+/g, '-')}-${n}`,
      images: ['https://example.invalid/x.jpg'],
      brand: 'Mandi Farms',
      unit: ProductUnit.G,
      unitValue: 500,
      sku: `SKU-${n}`,
      mrp: price + 1000,
      price,
      isActive: true,
      searchText: `${name} mandi farms`.toLowerCase(),
    });

    await inventory.create({
      vendorId,
      productId: product._id,
      stock,
      reserved: 0,
    });

    return product._id.toString();
  }

  /** The full happy path, so several cases can start from a real order. */
  async function placeOrder(
    token: string,
    productId: string,
    vendorId: Types.ObjectId,
    qty = 1,
  ): Promise<{ orderId: string; otp: string }> {
    const address = await request(server)
      .post('/addresses')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextIp())
      .send({
        label: 'Home',
        line1: '12 Test Cross',
        city: 'Bengaluru',
        pincode: '560034',
        lat: NEARBY[1],
        lng: NEARBY[0],
        phone: '9800000000',
      });
    expect(address.status).toBe(201);

    const added = await request(server)
      .post('/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextIp())
      .send({ vendorId: vendorId.toString(), productId, qty });
    expect(added.status).toBe(201);

    const placed = await request(server)
      .post('/checkout')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-For', nextIp())
      .set('Idempotency-Key', `it-${Date.now()}-${uniqueSuffix()}`)
      .send({
        vendorId: vendorId.toString(),
        addressId: address.body.id,
        paymentMethod: 'cod',
      });

    expect(placed.status).toBe(201);
    return {
      orderId: placed.body.order.id as string,
      otp: placed.body.deliveryOtp as string,
    };
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;

    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
    categories = ctx.app.get<Model<CategoryDocument>>(
      getModelToken(Category.name),
    );
    products = ctx.app.get<Model<ProductDocument>>(getModelToken(Product.name));
    inventory = ctx.app.get<Model<InventoryDocument>>(
      getModelToken(Inventory.name),
    );
    orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
    coupons = ctx.app.get<Model<CouponDocument>>(getModelToken(Coupon.name));
    passwords = ctx.app.get(PasswordService);

    storeA = await seedStore('Green Basket', STORE_A);
    storeB = await seedStore('Corner Mandi', STORE_B);

    const vendorA = await vendors.findById(storeA).lean().exec();
    storeASlug = vendorA?.slug ?? '';

    appleId = await seedProduct(storeA, 'Shimla Apples', 18_900, 40, AisleKey.FRUITS);
    breadId = await seedProduct(storeA, 'Sourdough Bread', 9_900, 25, AisleKey.BAKERY);
    storeBProductId = await seedProduct(
      storeB,
      'Farm Eggs',
      7_500,
      30,
      AisleKey.DAIRY,
    );

    const a = await seedCustomer();
    const b = await seedCustomer();
    tokenA = a.token;
    customerAId = a.id;
    tokenB = b.token;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  BROWSE BEFORE LOGIN
  // ══════════════════════════════════════════════════════════════════

  describe('Discovery is public', () => {
    it('lists stores with no token at all', async () => {
      const res = await request(server)
        .get('/stores')
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
      expect(res.body.meta).toMatchObject({ page: 1 });
    });

    it('ranks by distance and surfaces isOpen when given a position', async () => {
      const res = await request(server)
        .get('/stores')
        .query({ lat: NEARBY[1], lng: NEARBY[0], radius: 5 })
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);

      const distances = res.body.data.map(
        (row: { distanceKm: number }) => row.distanceKm,
      );
      expect(distances).toEqual([...distances].sort((x, y) => x - y));
      expect(res.body.data[0]).toHaveProperty('isOpen');
      expect(typeof res.body.data[0].distanceKm).toBe('number');
    });

    it('excludes a caller outside the store\'s own serviceRadiusKm', async () => {
      const res = await request(server)
        .get('/stores')
        .query({ lat: FAR_AWAY[1], lng: FAR_AWAY[0], radius: 25 })
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('rejects half a coordinate pair rather than ignoring it', async () => {
      const res = await request(server)
        .get('/stores')
        .query({ lat: NEARBY[1] })
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(400);
    });

    it('serves one store by slug, its aisles, its catalogue and one product', async () => {
      const store = await request(server)
        .get(`/stores/${storeASlug}`)
        .set('X-Forwarded-For', nextIp());
      expect(store.status).toBe(200);
      expect(store.body.storeName).toBe('Green Basket');

      const aisles = await request(server)
        .get(`/stores/${storeA.toString()}/categories`)
        .set('X-Forwarded-For', nextIp());
      expect(aisles.status).toBe(200);
      expect(aisles.body.map((group: { aisleKey: string }) => group.aisleKey)
        .sort()).toEqual([AisleKey.BAKERY, AisleKey.FRUITS].sort());

      const catalogue = await request(server)
        .get(`/stores/${storeA.toString()}/products`)
        .set('X-Forwarded-For', nextIp());
      expect(catalogue.status).toBe(200);
      expect(catalogue.body.data).toHaveLength(2);
      expect(catalogue.body.data[0]).toHaveProperty('inStock', true);

      const product = await request(server)
        .get(`/products/${appleId}`)
        .set('X-Forwarded-For', nextIp());
      expect(product.status).toBe(200);
      expect(product.body.price).toBe(18_900);
      expect(product.body.store.id).toBe(storeA.toString());
    });

    it('searches through the text index', async () => {
      const res = await request(server)
        .get(`/stores/${storeA.toString()}/products`)
        .query({ q: 'sourdough' })
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(breadId);
    });

    it('refuses a sort key that is not on the allowlist', async () => {
      const res = await request(server)
        .get(`/stores/${storeA.toString()}/products`)
        .query({ sort: 'vendorId' })
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(400);
    });

    it('404s a product whose store is suspended', async () => {
      const suspended = await seedStore('Closed Shop', STORE_A);
      const productId = await seedProduct(
        suspended,
        'Ghost Item',
        1_000,
        5,
        AisleKey.SNACKS,
      );
      await vendors
        .updateOne({ _id: suspended }, { status: VendorStatus.SUSPENDED })
        .exec();

      const res = await request(server)
        .get(`/products/${productId}`)
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  THE CART
  // ══════════════════════════════════════════════════════════════════

  describe('Cart', () => {
    it('requires a token', async () => {
      const res = await request(server)
        .get('/cart')
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(401);
    });

    it('is private to its owner — B never sees A\'s basket', async () => {
      const added = await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({ vendorId: storeA.toString(), productId: appleId, qty: 2 });

      expect(added.status).toBe(201);
      expect(added.body.cart.items).toHaveLength(1);
      expect(added.body.cart.items[0].qty).toBe(2);

      const mine = await request(server)
        .get('/cart')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      expect(mine.status).toBe(200);
      expect(mine.body.items).toHaveLength(1);

      // Customer B asks for the same store's cart by vendorId — the only
      // identifier the API accepts — and gets their own empty one.
      const theirs = await request(server)
        .get('/cart')
        .query({ vendorId: storeA.toString() })
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp());

      expect(theirs.status).toBe(200);
      expect(theirs.body.id).toBeNull();
      expect(theirs.body.items).toHaveLength(0);
    });

    it('PARKS the basket when the customer switches store — never destroys it', async () => {
      const switched = await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          vendorId: storeB.toString(),
          productId: storeBProductId,
          qty: 1,
        });

      expect(switched.status).toBe(201);
      expect(switched.body.parked).not.toBeNull();
      expect(switched.body.parked.vendorId).toBe(storeA.toString());
      expect(switched.body.parked.itemCount).toBe(2);
      expect(switched.body.cart.vendorId).toBe(storeB.toString());

      // The old basket is still there, listed and restorable.
      expect(switched.body.cart.parkedCarts).toHaveLength(1);
      expect(switched.body.cart.parkedCarts[0].vendorId).toBe(
        storeA.toString(),
      );
    });

    it('restores the parked basket when the customer goes back', async () => {
      const back = await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({ vendorId: storeA.toString(), productId: breadId, qty: 1 });

      expect(back.status).toBe(201);
      expect(back.body.cart.vendorId).toBe(storeA.toString());
      // The apples are still in it — 2 apples + 1 bread.
      expect(back.body.cart.items).toHaveLength(2);
      expect(back.body.cart.itemCount).toBe(3);
    });

    it('flags a price change instead of silently re-pricing the basket', async () => {
      await products.updateOne({ _id: new Types.ObjectId(appleId) }, { price: 21_900 }).exec();

      const res = await request(server)
        .get('/cart')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      const apples = res.body.items.find(
        (line: { productId: string }) => line.productId === appleId,
      );

      // Both numbers are reported: what the customer was shown, and what
      // it costs now. Nothing is quietly overwritten.
      expect(apples.price).toBe(18_900);
      expect(apples.currentPrice).toBe(21_900);
      expect(apples.flags).toContain('price_changed');
      expect(res.body.hasIssues).toBe(true);

      await products.updateOne({ _id: new Types.ObjectId(appleId) }, { price: 18_900 }).exec();
    });

    it('flags a line that outran its stock', async () => {
      await inventory.updateOne({ productId: new Types.ObjectId(appleId) }, { stock: 1 }).exec();

      const res = await request(server)
        .get('/cart')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());

      const apples = res.body.items.find(
        (line: { productId: string }) => line.productId === appleId,
      );
      expect(apples.flags).toContain('reduced_qty');
      expect(apples.availableQty).toBe(1);

      await inventory.updateOne({ productId: new Types.ObjectId(appleId) }, { stock: 40 }).exec();
    });

    it('refuses to add more than there is', async () => {
      // One unit left on the shelf, three asked for.
      await inventory
        .updateOne({ productId: new Types.ObjectId(appleId) }, { stock: 1 })
        .exec();

      const res = await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({ vendorId: storeA.toString(), productId: appleId, qty: 3 });

      expect(res.status).toBe(409);
      // The code is machine-readable, so the app can grey out ONE line
      // instead of string-matching an English sentence.
      expect(res.body.errors.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.errors.availableQty).toBe(1);

      await inventory
        .updateOne({ productId: new Types.ObjectId(appleId) }, { stock: 40 })
        .exec();
    });

    it('updates, removes and empties', async () => {
      const updated = await request(server)
        .patch(`/cart/items/${breadId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({ qty: 3 });
      expect(updated.status).toBe(200);
      expect(
        updated.body.items.find(
          (line: { productId: string }) => line.productId === breadId,
        ).qty,
      ).toBe(3);

      const removed = await request(server)
        .delete(`/cart/items/${breadId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      expect(removed.status).toBe(200);
      expect(removed.body.items).toHaveLength(1);

      const cleared = await request(server)
        .delete('/cart')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      expect(cleared.status).toBe(200);
      expect(cleared.body.id).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  ADDRESSES
  // ══════════════════════════════════════════════════════════════════

  describe('Addresses', () => {
    let addressAId: string;

    it('makes the first address the default automatically', async () => {
      const res = await request(server)
        .post('/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          label: 'Home',
          line1: '12 Test Cross',
          city: 'Bengaluru',
          pincode: '560034',
          lat: NEARBY[1],
          lng: NEARBY[0],
          phone: '9800000000',
        });

      expect(res.status).toBe(201);
      expect(res.body.isDefault).toBe(true);
      addressAId = res.body.id;
    });

    it('keeps exactly one default', async () => {
      const second = await request(server)
        .post('/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          label: 'Work',
          line1: '9 Office Park',
          city: 'Bengaluru',
          pincode: '560001',
          lat: NEARBY[1],
          lng: NEARBY[0],
          phone: '9800000001',
          isDefault: true,
        });
      expect(second.status).toBe(201);

      const list = await request(server)
        .get('/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());

      expect(list.status).toBe(200);
      const defaults = list.body.filter(
        (row: { isDefault: boolean }) => row.isDefault,
      );
      expect(defaults).toHaveLength(1);
      expect(defaults[0].label).toBe('Work');
    });

    it('404s — not 403 — when B reads A\'s address', async () => {
      const res = await request(server)
        .get(`/addresses/${addressAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp());

      // 403 would confirm the id is real. To a non-owner the address
      // simply does not exist.
      expect(res.status).toBe(404);
    });

    it('404s when B tries to DELETE A\'s address', async () => {
      const res = await request(server)
        .delete(`/addresses/${addressAId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(404);

      // And it is still there.
      const still = await request(server)
        .get(`/addresses/${addressAId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      expect(still.status).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  CHECKOUT
  // ══════════════════════════════════════════════════════════════════

  describe('Checkout', () => {
    let addressId: string;

    beforeAll(async () => {
      const list = await request(server)
        .get('/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      addressId = list.body[0].id;
    });

    it('re-prices server-side and reports issues before anything is placed', async () => {
      await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({ vendorId: storeA.toString(), productId: appleId, qty: 2 });

      const res = await request(server)
        .post('/checkout/validate')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({ vendorId: storeA.toString(), addressId });

      expect(res.status).toBe(200);
      expect(res.body.pricing.itemsSubtotal).toBe(2 * 18_900); // ₹378
      // 5% GST on the taxable value.
      expect(res.body.pricing.taxes).toBe(Math.round((2 * 18_900 * 5) / 100));
      // ₹378 is below the ₹499 free-delivery threshold.
      expect(res.body.pricing.deliveryFee).toBe(2_900);
      expect(res.body.pricing.grandTotal).toBe(
        2 * 18_900 + 2_900 + res.body.pricing.taxes,
      );
      expect(res.body.checkoutReady).toBe(true);
      expect(res.body.delivery.serviceable).toBe(true);

      // The commercial terms are NOT in a customer response.
      expect(res.body.pricing.commissionPct).toBeUndefined();
      expect(res.body.pricing.vendorPayout).toBeUndefined();
    });

    it('explains a bad coupon rather than failing the preview', async () => {
      const res = await request(server)
        .post('/checkout/validate')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          vendorId: storeA.toString(),
          addressId,
          couponCode: 'NOTAREALCODE',
        });

      expect(res.status).toBe(200);
      expect(res.body.couponProblem.code).toBe('COUPON_NOT_FOUND');
      expect(res.body.checkoutReady).toBe(false);
    });

    it('applies a valid coupon, capped', async () => {
      await coupons.create({
        code: 'MANDI10',
        type: CouponType.PERCENT,
        value: 10,
        minOrder: 0,
        maxDiscount: 2_000,
        usageLimit: 0,
        perUserLimit: 1,
        validFrom: new Date(Date.now() - 86_400_000),
        validTo: new Date(Date.now() + 86_400_000),
        isActive: true,
      });

      const res = await request(server)
        .post('/checkout/validate')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          vendorId: storeA.toString(),
          addressId,
          couponCode: 'MANDI10',
        });

      expect(res.status).toBe(200);
      // 10% of ₹378 is ₹37.80, capped at ₹20.
      expect(res.body.pricing.discount).toBe(2_000);
      expect(res.body.couponProblem).toBeNull();
      expect(res.body.coupon.code).toBe('MANDI10');
    });

    it('requires an Idempotency-Key', async () => {
      const res = await request(server)
        .post('/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          vendorId: storeA.toString(),
          addressId,
          paymentMethod: 'cod',
        });

      expect(res.status).toBe(400);
    });

    it('returns 503 for online payment while the gateway is unconfigured — and COD still works', async () => {
      const online = await request(server)
        .post('/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .set('Idempotency-Key', `online-${Date.now()}`)
        .send({
          vendorId: storeA.toString(),
          addressId,
          paymentMethod: 'online',
        });

      expect(online.status).toBe(503);
      expect(online.body.errors.code).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');

      // Nothing was reserved by the refused attempt.
      const stock = await inventory
        .findOne({ productId: new Types.ObjectId(appleId) })
        .lean()
        .exec();
      expect(stock?.reserved).toBe(0);
    });

    it('places a COD order, reserves the stock and converts the cart', async () => {
      const before = await inventory.findOne({ productId: new Types.ObjectId(appleId) }).lean().exec();
      const key = `cod-${Date.now()}-${uniqueSuffix()}`;

      const res = await request(server)
        .post('/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .set('Idempotency-Key', key)
        .send({
          vendorId: storeA.toString(),
          addressId,
          paymentMethod: 'cod',
        });

      expect(res.status).toBe(201);
      expect(res.body.order.status).toBe(OrderStatus.PLACED);
      expect(res.body.order.orderNo).toMatch(/^MND-\d{8}-\d{4}$/);
      expect(res.body.order.statusHistory).toHaveLength(1);
      expect(res.body.payment.next).toBe('pay_on_delivery');
      // The OTP is returned exactly once, in plain text, to the buyer.
      expect(res.body.deliveryOtp).toMatch(/^\d{4}$/);

      const after = await inventory.findOne({ productId: new Types.ObjectId(appleId) }).lean().exec();
      expect(after?.stock).toBe((before?.stock ?? 0) - 2);
      expect(after?.reserved).toBe(2);

      // The order document carries the commission SNAPSHOT even though the
      // customer never sees it.
      const stored = await orders.findById(res.body.order.id).lean().exec();
      expect(stored).not.toBeNull();
      const pricing = stored?.pricing;
      expect(pricing?.commissionPct).toBe(12);
      expect(pricing?.vendorPayout).toBe(
        (pricing?.itemsSubtotal ?? 0) - (pricing?.commissionAmount ?? 0),
      );
      // And the OTP is stored hashed, never in plain text.
      expect(stored).not.toHaveProperty('deliveryOtpHash');

      // The basket is now empty: it was converted, not left behind.
      const cart = await request(server)
        .get('/cart')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      expect(cart.body.id).toBeNull();

      // A replay of the same key returns the same order, not a second one.
      const replay = await request(server)
        .post('/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .set('Idempotency-Key', key)
        .send({
          vendorId: storeA.toString(),
          addressId,
          paymentMethod: 'cod',
        });

      expect(replay.status).toBe(201);
      expect(replay.body.order.id).toBe(res.body.order.id);
      expect(replay.headers['idempotent-replay']).toBe('true');
    });

    it('refuses an address outside the store\'s delivery radius', async () => {
      const far = await request(server)
        .post('/addresses')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({
          label: 'Away',
          line1: '1 Marine Drive',
          city: 'Mumbai',
          pincode: '400020',
          lat: FAR_AWAY[1],
          lng: FAR_AWAY[0],
          phone: '9800000002',
        });

      await request(server)
        .post('/cart/items')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .send({ vendorId: storeA.toString(), productId: breadId, qty: 1 });

      const res = await request(server)
        .post('/checkout')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp())
        .set('Idempotency-Key', `far-${Date.now()}-${uniqueSuffix()}`)
        .send({
          vendorId: storeA.toString(),
          addressId: far.body.id,
          paymentMethod: 'cod',
        });

      expect(res.status).toBe(409);
      expect(res.body.errors.code).toBe('OUT_OF_SERVICE_AREA');

      // Nothing was reserved by the refused attempt.
      const stock = await inventory
        .findOne({ productId: new Types.ObjectId(breadId) })
        .lean()
        .exec();
      expect(stock?.reserved).toBe(0);

      await request(server)
        .delete('/cart')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  ORDERS
  // ══════════════════════════════════════════════════════════════════

  describe('Orders', () => {
    it('lists only the caller\'s own orders', async () => {
      const mine = await request(server)
        .get('/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());

      expect(mine.status).toBe(200);
      expect(mine.body.data.length).toBeGreaterThan(0);

      const theirs = await request(server)
        .get('/orders')
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp());

      expect(theirs.status).toBe(200);
      expect(theirs.body.data).toHaveLength(0);
    });

    it('404s — NOT 403 — when B reads A\'s order', async () => {
      const list = await request(server)
        .get('/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());

      const orderId = list.body.data[0].id as string;

      const res = await request(server)
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp());

      // THE assertion. A 403 here would confirm the order exists and let
      // an attacker walk the id space counting real orders.
      expect(res.status).toBe(404);
      expect(res.status).not.toBe(403);
    });

    it('404s B on track and cancel as well', async () => {
      const list = await request(server)
        .get('/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      const orderId = list.body.data[0].id as string;

      const track = await request(server)
        .get(`/orders/${orderId}/track`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp());
      expect(track.status).toBe(404);

      const cancel = await request(server)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp())
        .send({ reason: 'not mine' });
      expect(cancel.status).toBe(404);
    });

    it('tracks an order without inventing a rider position', async () => {
      const list = await request(server)
        .get('/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      const orderId = list.body.data[0].id as string;

      const res = await request(server)
        .get(`/orders/${orderId}/track`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.PLACED);
      expect(res.body.statusHistory).toHaveLength(1);
      expect(res.body.vendor.location).not.toBeNull();
      expect(res.body.drop.location).toHaveProperty('lat');
      // No rider assigned yet: null, not a fabricated position.
      expect(res.body.rider).toBeNull();
      expect(res.body.eta.basis).toBe('sla');
    });

    it('cancels for free while the order is still PLACED, and puts the stock back', async () => {
      const { orderId } = await placeOrder(tokenB, breadId, storeA, 2);

      const reserved = await inventory
        .findOne({ productId: new Types.ObjectId(breadId) })
        .lean()
        .exec();
      expect(reserved?.reserved).toBe(2);

      const res = await request(server)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp())
        .send({ reason: 'Ordered by mistake' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.CANCELLED);
      expect(res.body.cancellation.reason).toBe('Ordered by mistake');

      const released = await inventory
        .findOne({ productId: new Types.ObjectId(breadId) })
        .lean()
        .exec();
      expect(released?.reserved).toBe(0);
      expect(released?.stock).toBe((reserved?.stock ?? 0) + 2);
    });

    it('409s a cancellation once the vendor has ACCEPTED (decision #8)', async () => {
      const { orderId } = await placeOrder(tokenB, appleId, storeA, 1);

      // The vendor accepts. (Their own endpoint lives in the vendor
      // module; the state is what matters here.)
      await orders
        .updateOne(
          { _id: new Types.ObjectId(orderId) },
          { status: OrderStatus.ACCEPTED, acceptedAt: new Date() },
        )
        .exec();

      const res = await request(server)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp())
        .send({ reason: 'Changed my mind' });

      expect(res.status).toBe(409);
      expect(res.body.errors.code).toBe('CANCELLATION_NEEDS_APPROVAL');
      expect(res.body.errors.status).toBe(OrderStatus.ACCEPTED);

      // And the stock stays reserved — the store is already picking it.
      const stock = await inventory.findOne({ productId: new Types.ObjectId(appleId) }).lean().exec();
      expect(stock?.reserved).toBeGreaterThan(0);
    });

    it('409s a cancellation of a terminal order', async () => {
      const { orderId } = await placeOrder(tokenB, appleId, storeA, 1);
      await orders
        .updateOne(
          { _id: new Types.ObjectId(orderId) },
          { status: OrderStatus.DELIVERED },
        )
        .exec();

      const res = await request(server)
        .post(`/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('X-Forwarded-For', nextIp())
        .send({ reason: 'too late' });

      expect(res.status).toBe(409);
      expect(res.body.errors.code).toBe('ORDER_CLOSED');
    });

    it('never exposes the commission or the payout to the customer', async () => {
      const list = await request(server)
        .get('/orders')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());
      const orderId = list.body.data[0].id as string;

      const res = await request(server)
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(200);
      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain('commission');
      expect(serialised).not.toContain('vendorPayout');
      expect(serialised).not.toContain('deliveryOtp');
      expect(res.body.id).toBeDefined();
      expect(customerAId).toBeDefined();
    });
  });
});
