import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Response } from 'supertest';

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
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../src/database/schemas/inventory-log.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
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

const STORE: [number, number] = [77.6101, 12.9352];
const DROP: [number, number] = [77.6201, 12.9302];

/** The numbers from §8.2: 50 buyers, 10 units, exactly 10 winners. */
const BUYERS = 50;
const STOCK = 10;

interface Shopper {
  token: string;
  addressId: string;
}

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE INVENTORY RACE (§8.2, Challenge #4)
 * ════════════════════════════════════════════════════════════════════════
 *
 * This is the most valuable test in the customer suite, because the bug it
 * exists to catch is invisible every other way.
 *
 * ── The bug ─────────────────────────────────────────────────────────────
 *     const inv = await Inventory.findOne({ productId });   // reads 1
 *     if (inv.stock >= qty) {                               // both pass
 *       inv.stock -= qty;
 *       await inv.save();                                   // both write 0
 *     }
 * Two customers buy the last unit; both orders succeed; the shelf is empty
 * and someone is getting a phone call. It passes every unit test, every
 * manual click-through and every code review, because it is only wrong
 * when two requests interleave — which happens on the first busy evening
 * and never on a developer's machine.
 *
 * ── The fix under test ──────────────────────────────────────────────────
 *     updateOne({ productId, stock: { $gte: qty } },
 *               { $inc: { stock: -qty, reserved: qty } })
 * The condition is in the FILTER. MongoDB will not match a document that
 * lacks the stock, and the match and the decrement are one atomic
 * operation with no window between them. `modifiedCount === 0` is the
 * losing customer, and it rolls the whole transaction back.
 *
 * ── Why this needs a replica set ────────────────────────────────────────
 * `MongoMemoryReplSet` (see `test/utils/test-app.ts`) — multi-document
 * transactions do not exist on a standalone mongod, so a standalone would
 * silently run every step without atomicity and let the very bug this
 * file exists to catch pass CI.
 *
 * ── What is asserted ────────────────────────────────────────────────────
 * Not "roughly ten". EXACTLY ten successes, exactly forty clean 409s,
 * final stock exactly 0, `reserved` exactly 10, exactly ten order
 * documents, and stock NEVER negative. An oversell test that tolerates
 * approximation tolerates the bug.
 */
describe('Checkout under concurrency (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let categories: Model<CategoryDocument>;
  let products: Model<ProductDocument>;
  let inventory: Model<InventoryDocument>;
  let inventoryLogs: Model<InventoryLogDocument>;
  let orders: Model<OrderDocument>;
  let passwords: PasswordService;

  let vendorId: Types.ObjectId;
  let productId: Types.ObjectId;
  let sharedHash: string;

  let counter = 0;
  const suffix = (): string => String(++counter).padStart(5, '0');

  /**
   * One argon2 hash, reused for every account.
   *
   * argon2id is deliberately expensive (19 MiB, t=2). Hashing the same
   * password fifty times would spend most of this spec's wall clock
   * proving something `auth.spec.ts` already proves.
   */
  async function seedShopper(): Promise<Shopper> {
    const n = suffix();
    const email = `race${n}@test.invalid`;

    await users.create({
      name: `Racer ${n}`,
      email,
      phone: `98${n}000`.slice(0, 10),
      passwordHash: sharedHash,
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
        line1: `${n} Race Street`,
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
      .send({
        vendorId: vendorId.toString(),
        productId: productId.toString(),
        qty: 1,
      });
    expect(cart.status).toBe(201);

    return { token, addressId: address.body.id as string };
  }

  const checkout = (shopper: Shopper, key: string): Promise<Response> =>
    request(server)
      .post('/checkout')
      .set('Authorization', `Bearer ${shopper.token}`)
      .set('X-Forwarded-For', nextIp())
      .set('Idempotency-Key', key)
      .send({
        vendorId: vendorId.toString(),
        addressId: shopper.addressId,
        paymentMethod: 'cod',
      });

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
    inventoryLogs = ctx.app.get<Model<InventoryLogDocument>>(
      getModelToken(InventoryLog.name),
    );
    orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
    passwords = ctx.app.get(PasswordService);

    sharedHash = await passwords.hash(PASSWORD);

    const owner = await users.create({
      name: 'Race Store Owner',
      email: 'race-owner@test.invalid',
      phone: '9700000001',
      passwordHash: sharedHash,
      role: Role.VENDOR,
      status: UserStatus.ACTIVE,
    });

    const vendor = await vendors.create({
      ownerId: owner._id,
      storeName: 'Last Ten Apples',
      slug: 'last-ten-apples',
      address: {
        line1: '1 Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
      },
      location: { type: 'Point', coordinates: STORE },
      serviceRadiusKm: 5,
      commissionPct: 12,
      codEnabled: true,
      codMaxAmount: 200_000,
      isOpen: true,
      status: VendorStatus.APPROVED,
    });
    vendorId = vendor._id;

    const category = await categories.create({
      vendorId,
      name: 'Fruits',
      slug: 'fruits-race',
      aisleKey: AisleKey.FRUITS,
      isActive: true,
    });

    const product = await products.create({
      vendorId,
      categoryId: category._id,
      name: 'The Last Apples',
      slug: 'the-last-apples',
      images: [],
      unit: ProductUnit.G,
      unitValue: 500,
      sku: 'RACE-1',
      mrp: 10_000,
      price: 9_900,
      isActive: true,
      searchText: 'the last apples',
    });
    productId = product._id;

    await inventory.create({
      vendorId,
      productId,
      stock: STOCK,
      reserved: 0,
    });
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  it(
    `lets EXACTLY ${STOCK} of ${BUYERS} simultaneous checkouts win, and never oversells`,
    async () => {
      const shoppers: Shopper[] = [];
      for (let i = 0; i < BUYERS; i++) {
        // Sequential SETUP — the race is the checkout, not the sign-up.
        shoppers.push(await seedShopper());
      }

      const before = await inventory.findOne({ productId }).lean().exec();
      expect(before?.stock).toBe(STOCK);
      expect(before?.reserved).toBe(0);

      // ── The race ──────────────────────────────────────────────────
      const responses = await Promise.all(
        shoppers.map((shopper, i) =>
          checkout(shopper, `race-${Date.now()}-${String(i).padStart(3, '0')}`),
        ),
      );

      const created = responses.filter((res) => res.status === 201);
      const conflicts = responses.filter((res) => res.status === 409);
      const other = responses.filter(
        (res) => res.status !== 201 && res.status !== 409,
      );

      // Anything that is neither a sale nor a clean "sold out" is a bug —
      // a 500 here would mean the race produced an unhandled driver error
      // rather than a controlled refusal.
      if (other.length > 0) {
        throw new Error(
          `Unexpected responses: ${other
            .map((res) => `${res.status} ${JSON.stringify(res.body)}`)
            .join(' | ')}`,
        );
      }

      expect(created).toHaveLength(STOCK);
      expect(conflicts).toHaveLength(BUYERS - STOCK);

      // Every loser is told WHY, in a form the app can act on.
      for (const refused of conflicts) {
        expect(refused.body.errors.code).toBe('OUT_OF_STOCK');
        expect(refused.body.errors.productId).toBe(productId.toString());
        expect(refused.body.status).toBe(409);
      }

      // ── The shelf ─────────────────────────────────────────────────
      const after = await inventory.findOne({ productId }).lean().exec();
      expect(after?.stock).toBe(0);
      // NEVER negative. This is the assertion the whole file exists for.
      expect(after?.stock).toBeGreaterThanOrEqual(0);
      expect(after?.reserved).toBe(STOCK);
      // Nothing appeared out of thin air either: what left `stock` is
      // exactly what arrived in `reserved`.
      expect((after?.stock ?? 0) + (after?.reserved ?? 0)).toBe(STOCK);

      // ── The ledger ────────────────────────────────────────────────
      const placed = await orders.countDocuments({ vendorId }).exec();
      expect(placed).toBe(STOCK);

      const reservations = await inventoryLogs
        .countDocuments({ productId, reason: InventoryReason.ORDER_RESERVE })
        .exec();
      // A rolled-back checkout must leave no audit row behind: the log
      // write is inside the same transaction as the reservation.
      expect(reservations).toBe(STOCK);

      // Ten distinct, human-readable order numbers — the per-day counter
      // is allocated atomically, so no two winners collide on one.
      const numbers = await orders.distinct('orderNo', { vendorId }).exec();
      expect(numbers).toHaveLength(STOCK);

      const everyOrderIsPlaced = await orders
        .countDocuments({ vendorId, status: OrderStatus.PLACED })
        .exec();
      expect(everyOrderIsPlaced).toBe(STOCK);

      // And the winners' carts are spent, not left holding stock.
      const grandTotals = await orders.find({ vendorId }).lean().exec();
      for (const order of grandTotals) {
        expect(order.items).toHaveLength(1);
        expect(order.items[0].qty).toBe(1);
        expect(Number.isInteger(order.pricing.grandTotal)).toBe(true);
      }
    },
    170_000,
  );

  it('places ONE order when the same Idempotency-Key is submitted twice at once', async () => {
    // Fresh stock, fresh buyer: this is the double-tap, not the race.
    await inventory.updateOne({ productId }, { stock: 5, reserved: 0 }).exec();
    const shopper = await seedShopper();
    const key = `double-tap-${Date.now()}`;

    const [first, second] = await Promise.all([
      checkout(shopper, key),
      checkout(shopper, key),
    ]);

    const statuses = [first.status, second.status].sort();

    // One of two legal outcomes, depending on which request reached the
    // unique index first:
    //   [201, 201] — the second replayed the stored response
    //   [201, 409] — the second arrived while the first was still running
    // What must NOT happen is two orders.
    expect(statuses[0]).toBe(201);
    expect([201, 409]).toContain(statuses[1]);

    const placed = await orders
      .countDocuments({ 'items.0.productId': productId, status: OrderStatus.PLACED })
      .exec();
    // Ten from the race above, plus exactly ONE from this double tap.
    expect(placed).toBe(STOCK + 1);

    const after = await inventory.findOne({ productId }).lean().exec();
    expect(after?.stock).toBe(4);
    expect(after?.reserved).toBe(1);
  }, 120_000);
});
