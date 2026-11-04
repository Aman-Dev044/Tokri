import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';

import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
  VehicleType,
} from '../../src/database/schemas/delivery-partner.schema';
import {
  ProductReview,
  ProductReviewDocument,
} from '../../src/database/schemas/product-review.schema';
import { Role } from '../../src/common/constants/roles.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { TestContext, closeTestApp, createTestApp, nextIp } from '../utils/test-app';
import { SeededStore, StoreSeeder, runPassword } from '../utils/store-fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  WISHLIST · VERIFIED REVIEWS · ORDER RATINGS
 * ════════════════════════════════════════════════════════════════════════
 *
 * Each block asserts the rule that exists in exactly one place:
 *   - the wishlist is CUSTOMER-only and both writes are idempotent;
 *   - a review needs a DELIVERED order with the product on it, there is
 *     one per customer per product, it can be edited, and a hidden review
 *     drops out of the product's average;
 *   - an order is rated once, only when delivered, only within 14 days,
 *     and the store's and rider's averages are exact running means.
 */
describe('Wishlist, reviews and order ratings (integration)', () => {
  let ctx: TestContext;
  let seed: StoreSeeder;
  let orders: Model<OrderDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let reviews: Model<ProductReviewDocument>;

  let store: SeededStore;
  let mango: string;
  let rice: string;
  let withdrawn: string;

  let customerA: { id: string; token: string };
  let customerB: { id: string; token: string };
  let adminToken: string;
  let riderPartnerId: Types.ObjectId;

  let orderCounter = 0;

  async function customer(): Promise<{ id: string; token: string }> {
    const user = await seed.user(Role.CUSTOMER, null);
    return { id: user._id.toString(), token: await seed.token(user.phone) };
  }

  /** A finished order, written straight to the collection. */
  async function order(options: {
    customerId: string;
    productIds: string[];
    status?: OrderStatus;
    deliveredAt?: Date | null;
    rider?: Types.ObjectId | null;
    fulfilled?: boolean;
  }): Promise<OrderDocument> {
    const status = options.status ?? OrderStatus.DELIVERED;
    const deliveredAt =
      options.deliveredAt !== undefined
        ? options.deliveredAt
        : status === OrderStatus.DELIVERED
          ? new Date()
          : null;
    const n = String(++orderCounter).padStart(4, '0');

    return orders.create({
      orderNo: `TKR-20261104-R${n}`,
      customerId: new Types.ObjectId(options.customerId),
      vendorId: new Types.ObjectId(store.vendorId),
      deliveryPartnerId: options.rider === undefined ? riderPartnerId : options.rider,
      items: options.productIds.map((productId) => ({
        productId: new Types.ObjectId(productId),
        name: 'Line',
        unit: '500 g',
        price: 10_000,
        qty: 1,
        lineTotal: 10_000,
        fulfilled: options.fulfilled ?? true,
      })),
      pricing: {
        itemsSubtotal: 10_000,
        discount: 0,
        deliveryFee: 0,
        taxes: 0,
        grandTotal: 10_000,
        commissionPct: 12,
        commissionAmount: 1_200,
        vendorPayout: 8_800,
      },
      address: {
        label: 'Home',
        line1: '1 Test Road',
        city: 'Pune',
        pincode: '411001',
        location: { type: 'Point', coordinates: [73.8567, 18.5204] },
        phone: '9000012345',
      },
      payment: { method: PaymentMethod.COD, status: PaymentStatus.PAID },
      status,
      statusHistory: [],
      placedAt: new Date(),
      deliveredAt,
    });
  }

  const anon = (method: 'get' | 'post' | 'delete', path: string) =>
    request(seed.server)[method](path).set('X-Forwarded-For', nextIp());

  beforeAll(async () => {
    ctx = await createTestApp();
    seed = new StoreSeeder(ctx, runPassword());
    orders = ctx.app.get(getModelToken(Order.name));
    partners = ctx.app.get(getModelToken(DeliveryPartner.name));
    reviews = ctx.app.get(getModelToken(ProductReview.name));

    store = await seed.store('Review', [
      { name: 'Alphonso Mango', price: 30_000, mrp: 35_000 },
      { name: 'Sona Masoori Rice', price: 60_000, mrp: 60_000 },
      { name: 'Withdrawn Jam', price: 15_000, mrp: 15_000, isActive: false },
    ]);
    [mango, rice, withdrawn] = store.products.map((p) => p.id) as [string, string, string];

    customerA = await customer();
    customerB = await customer();

    const admin = await seed.user(Role.ADMIN, null);
    adminToken = await seed.token(admin.phone);

    const riderUser = await seed.user(Role.DELIVERY, null);
    const partner = await partners.create({
      userId: riderUser._id,
      vendorId: null,
      vehicleType: VehicleType.SCOOTER,
      status: PartnerStatus.ACTIVE,
      // A seeded "rating" with no count behind it: the first real rating
      // must replace it, not average against it.
      rating: 4.9,
    });
    riderPartnerId = partner._id;
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  1. Wishlist
  // ══════════════════════════════════════════════════════════════════

  describe('wishlist', () => {
    it('is closed to anonymous callers and to every non-customer role', async () => {
      expect((await anon('get', '/wishlist')).status).toBe(401);
      expect((await anon('post', `/wishlist/${mango}`)).status).toBe(401);
      expect((await seed.as(store.ownerToken, 'get', '/wishlist')).status).toBe(403);
      expect((await seed.as(adminToken, 'post', `/wishlist/${mango}`)).status).toBe(403);
    });

    it('saves idempotently — two POSTs, one row', async () => {
      for (let i = 0; i < 2; i += 1) {
        const res = await seed.as(customerA.token, 'post', `/wishlist/${mango}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ productId: mango, saved: true });
      }

      const list = await seed.as(customerA.token, 'get', '/wishlist');
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({
        productId: mango,
        available: true,
        unavailableReason: null,
        name: 'Alphonso Mango',
        product: { id: mango, price: 30_000, inStock: true, isActive: true },
        store: { id: store.vendorId },
      });
    });

    it('removes idempotently — including something never saved', async () => {
      for (let i = 0; i < 2; i += 1) {
        const res = await seed.as(customerA.token, 'delete', `/wishlist/${mango}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ productId: mango, saved: false });
      }
      const res = await seed.as(customerA.token, 'delete', `/wishlist/${rice}`);
      expect(res.status).toBe(200);
      expect((await seed.as(customerA.token, 'get', '/wishlist')).body).toEqual([]);
    });

    it('refuses a NEW save of an inactive or unknown product with 404', async () => {
      expect((await seed.as(customerA.token, 'post', `/wishlist/${withdrawn}`)).status).toBe(404);
      expect(
        (await seed.as(customerA.token, 'post', `/wishlist/${new Types.ObjectId().toString()}`))
          .status,
      ).toBe(404);
      expect((await seed.as(customerA.token, 'post', '/wishlist/not-an-id')).status).toBe(404);
    });

    it('keeps a product withdrawn after saving, marked unavailable — not dropped', async () => {
      await seed.as(customerB.token, 'post', `/wishlist/${rice}`).expect(200);
      await seed.products.updateOne({ _id: rice }, { $set: { isActive: false } }).exec();

      const res = await seed.as(customerB.token, 'get', '/wishlist');
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        productId: rice,
        available: false,
        unavailableReason: 'inactive',
        product: { isActive: false },
      });

      // Deleted outright: still listed, by its snapshot name.
      await seed.products.deleteOne({ _id: rice }).exec();
      const after = await seed.as(customerB.token, 'get', '/wishlist');
      expect(after.body[0]).toMatchObject({
        productId: rice,
        available: false,
        unavailableReason: 'deleted',
        name: 'Sona Masoori Rice',
        product: null,
      });
    });

    it("never shows one customer another's list", async () => {
      await seed.as(customerA.token, 'post', `/wishlist/${mango}`).expect(200);
      const b = await seed.as(customerB.token, 'get', '/wishlist');
      expect(b.body.map((row: { productId: string }) => row.productId)).not.toContain(mango);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  2. Reviews
  // ══════════════════════════════════════════════════════════════════

  describe('reviews', () => {
    it('refuses a review without a delivered order containing the product', async () => {
      // Ordered but cancelled, and delivered but the line was dropped: neither counts.
      await order({ customerId: customerA.id, productIds: [mango], status: OrderStatus.CANCELLED });
      await order({ customerId: customerA.id, productIds: [mango], fulfilled: false });

      const mine = await seed.as(customerA.token, 'get', `/products/${mango}/reviews/mine`);
      expect(mine.body).toMatchObject({ canReview: false, reason: 'NOT_PURCHASED', review: null });

      const res = await seed
        .as(customerA.token, 'post', `/products/${mango}/reviews`)
        .send({ rating: 5 });
      expect(res.status).toBe(403);
      expect(res.body.errors.code).toBe('REVIEW_NEEDS_DELIVERED_ORDER');
    });

    it('accepts one after delivery, once, and reflects it on the product', async () => {
      await order({ customerId: customerA.id, productIds: [mango] });

      expect(
        (await seed.as(customerA.token, 'get', `/products/${mango}/reviews/mine`)).body.canReview,
      ).toBe(true);

      const bad = await seed
        .as(customerA.token, 'post', `/products/${mango}/reviews`)
        .send({ rating: 6 });
      expect(bad.status).toBe(400);
      const long = await seed
        .as(customerA.token, 'post', `/products/${mango}/reviews`)
        .send({ rating: 4, comment: 'x'.repeat(501) });
      expect(long.status).toBe(400);

      const res = await seed
        .as(customerA.token, 'post', `/products/${mango}/reviews`)
        .send({ rating: 4, comment: '  Sweet and ripe.  ' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ rating: 4, comment: 'Sweet and ripe.', verifiedPurchase: true });
      // First name and last initial, never the full name or an id.
      expect(res.body.authorName).toMatch(/^Seed \S\.$/);
      expect(res.body.customerId).toBeUndefined();

      const again = await seed
        .as(customerA.token, 'post', `/products/${mango}/reviews`)
        .send({ rating: 1 });
      expect(again.status).toBe(409);
      expect(again.body.errors.code).toBe('REVIEW_EXISTS');

      const product = await anon('get', `/products/${mango}`);
      expect(product.body).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
    });

    it('lets the author edit, and recomputes the average', async () => {
      await order({ customerId: customerB.id, productIds: [mango] });
      await seed
        .as(customerB.token, 'post', `/products/${mango}/reviews`)
        .send({ rating: 1 })
        .expect(201);

      let page = await anon('get', `/products/${mango}/reviews`);
      expect(page.body.summary).toEqual({ average: 2.5, count: 2 });

      const edit = await seed
        .as(customerB.token, 'patch', `/products/${mango}/reviews/mine`)
        .send({ rating: 2, comment: 'Better second time' });
      expect(edit.status).toBe(200);
      expect(edit.body).toMatchObject({ rating: 2, comment: 'Better second time' });
      expect(edit.body.editedAt).not.toBeNull();

      page = await anon('get', `/products/${mango}/reviews`);
      expect(page.body.summary).toEqual({ average: 3, count: 2 });
      // Newest first.
      expect(page.body.data.map((r: { rating: number }) => r.rating)).toEqual([2, 4]);
      expect(page.body.meta).toMatchObject({ page: 1, total: 2 });
    });

    it('excludes a hidden review from the list and the average, and audits it', async () => {
      const target = await reviews
        .findOne({ customerId: new Types.ObjectId(customerB.id), productId: new Types.ObjectId(mango) })
        .exec();
      const id = (target as ProductReviewDocument)._id.toString();

      // A customer cannot moderate, and a reason is required.
      expect(
        (await seed.as(customerA.token, 'patch', `/admin/reviews/${id}/visibility`).send({
          hidden: true,
          reason: 'Spam',
        })).status,
      ).toBe(403);
      expect(
        (await seed.as(adminToken, 'patch', `/admin/reviews/${id}/visibility`).send({ hidden: true }))
          .status,
      ).toBe(400);

      const hide = await seed
        .as(adminToken, 'patch', `/admin/reviews/${id}/visibility`)
        .send({ hidden: true, reason: 'Contains a phone number' });
      expect(hide.status).toBe(200);
      expect(hide.body).toMatchObject({
        id,
        isHidden: true,
        hiddenReason: 'Contains a phone number',
        productName: 'Alphonso Mango',
      });

      const page = await anon('get', `/products/${mango}/reviews`);
      expect(page.body.summary).toEqual({ average: 4, count: 1 });
      expect(page.body.data).toHaveLength(1);
      expect((await anon('get', `/products/${mango}`)).body).toMatchObject({
        ratingAvg: 4,
        ratingCount: 1,
      });

      // The author still sees their own review, marked hidden.
      const mine = await seed.as(customerB.token, 'get', `/products/${mango}/reviews/mine`);
      expect(mine.body.review).toMatchObject({ rating: 2, isHidden: true });

      const audit = await seed
        .as(adminToken, 'get', '/admin/audit-logs')
        .query({ entity: 'ProductReview', entityId: id });
      expect(audit.status).toBe(200);
      const rows = audit.body.data as { action: string; after: { reason?: string } }[];
      const hidden = rows.find((row) => row.action === 'review.hide');
      expect(hidden?.after.reason).toBe('Contains a phone number');

      const hiddenList = await seed
        .as(adminToken, 'get', '/admin/reviews')
        .query({ status: 'hidden' });
      expect(hiddenList.status).toBe(200);
      expect(hiddenList.body.data.map((r: { id: string }) => r.id)).toEqual([id]);

      // Restoring it brings it back into the average.
      await seed
        .as(adminToken, 'patch', `/admin/reviews/${id}/visibility`)
        .send({ hidden: false, reason: 'Number was a pack size' })
        .expect(200);
      expect((await anon('get', `/products/${mango}/reviews`)).body.summary).toEqual({
        average: 3,
        count: 2,
      });
    });

    it('editing a review that does not exist is a 404', async () => {
      const res = await seed
        .as(customerA.token, 'patch', `/products/${withdrawn}/reviews/mine`)
        .send({ rating: 3 });
      expect(res.status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  3. Order ratings
  // ══════════════════════════════════════════════════════════════════

  describe('order ratings', () => {
    const rate = (token: string, orderId: string, body: Record<string, unknown>) =>
      seed.as(token, 'post', `/orders/${orderId}/rating`).send(body);

    it('refuses an order that is not delivered', async () => {
      const live = await order({ customerId: customerA.id, productIds: [mango], status: OrderStatus.OUT_FOR_DELIVERY });
      const res = await rate(customerA.token, live._id.toString(), { storeRating: 5 });
      expect(res.status).toBe(409);
      expect(res.body.errors.code).toBe('ORDER_NOT_DELIVERED');
    });

    it('refuses once the 14-day window has closed', async () => {
      const old = await order({
        customerId: customerA.id,
        productIds: [mango],
        deliveredAt: new Date(Date.now() - 15 * DAY_MS),
      });
      const detail = await seed.as(customerA.token, 'get', `/orders/${old._id.toString()}`);
      expect(detail.body).toMatchObject({ canRate: false, rating: null });

      const res = await rate(customerA.token, old._id.toString(), { storeRating: 5 });
      expect(res.status).toBe(409);
      expect(res.body.errors.code).toBe('RATING_WINDOW_CLOSED');
    });

    it("is a 404 on another customer's order", async () => {
      const theirs = await order({ customerId: customerB.id, productIds: [mango] });
      expect((await rate(customerA.token, theirs._id.toString(), { storeRating: 5 })).status).toBe(404);
    });

    it('rates once, and keeps exact running means on the store and the rider', async () => {
      const first = await order({ customerId: customerA.id, productIds: [mango] });
      const detail = await seed.as(customerA.token, 'get', `/orders/${first._id.toString()}`);
      expect(detail.body).toMatchObject({ canRate: true, hasRider: true, rating: null });
      expect(detail.body.rateUntil).toBeTruthy();

      const res = await rate(customerA.token, first._id.toString(), {
        storeRating: 5,
        riderRating: 4,
        comment: 'Quick and polite',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ storeRating: 5, riderRating: 4, comment: 'Quick and polite' });

      const twice = await rate(customerA.token, first._id.toString(), { storeRating: 1 });
      expect(twice.status).toBe(409);
      expect(twice.body.errors.code).toBe('ORDER_ALREADY_RATED');

      const second = await order({ customerId: customerB.id, productIds: [mango] });
      await rate(customerB.token, second._id.toString(), { storeRating: 4, riderRating: 1 }).expect(201);

      const third = await order({ customerId: customerB.id, productIds: [mango] });
      // Rider skipped: the store's mean moves, the rider's does not.
      await rate(customerB.token, third._id.toString(), { storeRating: 4 }).expect(201);

      const vendor = await seed.vendors.findById(store.vendorId).lean().exec();
      expect(vendor).toMatchObject({ ratingCount: 3, ratingSum: 13, rating: 4.3 });

      const rider = await partners.findById(riderPartnerId).lean().exec();
      // The seeded 4.9 had no count behind it, so it is replaced, not averaged.
      expect(rider).toMatchObject({ ratingCount: 2, ratingSum: 5, rating: 2.5 });

      const after = await seed.as(customerA.token, 'get', `/orders/${first._id.toString()}`);
      expect(after.body).toMatchObject({
        canRate: false,
        rateUntil: null,
        rating: { storeRating: 5, riderRating: 4, comment: 'Quick and polite' },
      });

      // The public store row reads the same number.
      const stores = await anon('get', `/stores/${store.slug}`);
      expect(stores.body.rating).toBe(4.3);
    });

    it('refuses a rider rating when no rider carried the order', async () => {
      const selfDelivered = await order({ customerId: customerA.id, productIds: [mango], rider: null });
      const res = await rate(customerA.token, selfDelivered._id.toString(), {
        storeRating: 3,
        riderRating: 5,
      });
      expect(res.status).toBe(400);
      expect(res.body.errors.code).toBe('NO_RIDER_TO_RATE');

      // Nothing was claimed by the refusal: the store-only rating still lands.
      await rate(customerA.token, selfDelivered._id.toString(), { storeRating: 3 }).expect(201);
    });

    it('validates the numbers', async () => {
      const o = await order({ customerId: customerA.id, productIds: [mango] });
      expect((await rate(customerA.token, o._id.toString(), { storeRating: 0 })).status).toBe(400);
      expect((await rate(customerA.token, o._id.toString(), {})).status).toBe(400);
      expect(
        (await rate(customerA.token, o._id.toString(), { storeRating: 5, comment: 'y'.repeat(501) }))
          .status,
      ).toBe(400);
    });
  });
});
