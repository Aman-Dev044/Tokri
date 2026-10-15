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
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { AisleKey } from '../../src/common/constants/aisle.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { TestContext, closeTestApp, createTestApp, nextIp } from '../utils/test-app';

const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Matches the `560001` entry in `pincode-table.ts` — Bengaluru GPO. */
const KNOWN_PINCODE = '560001';
const KNOWN_PINCODE_COORDS: [number, number] = [77.5946, 12.9716]; // [lng, lat]
const UNKNOWN_PINCODE = '999999';

let counter = 0;
const uniqueSuffix = (): string => String(++counter).padStart(4, '0');

describe('Market-wide discovery search (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let categories: Model<CategoryDocument>;
  let products: Model<ProductDocument>;
  let inventory: Model<InventoryDocument>;
  let passwords: PasswordService;

  async function seedStore(
    name: string,
    coordinates: [number, number],
    status: VendorStatus = VendorStatus.APPROVED,
  ): Promise<Types.ObjectId> {
    const n = uniqueSuffix();
    const owner = await users.create({
      name: `Market Owner ${n}`,
      email: `mowner${n}@test.invalid`,
      phone: `95${n}00000`.slice(0, 10),
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
      status,
    });

    return vendor._id;
  }

  async function seedProduct(
    vendorId: Types.ObjectId,
    name: string,
    searchTerm: string,
    aisleKey: AisleKey = AisleKey.STAPLES,
  ): Promise<Types.ObjectId> {
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
      brand: 'Tokri Farms',
      unit: ProductUnit.G,
      unitValue: 500,
      sku: `MKT-${n}`,
      mrp: 20000,
      price: 18000,
      isActive: true,
      searchText: `${searchTerm}`.toLowerCase(),
    });

    await inventory.create({
      vendorId,
      productId: product._id,
      stock: 50,
      reserved: 0,
      lowStockThreshold: 5,
    });

    return product._id;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;

    users = ctx.app.get(getModelToken(User.name));
    vendors = ctx.app.get(getModelToken(Vendor.name));
    categories = ctx.app.get(getModelToken(Category.name));
    products = ctx.app.get(getModelToken(Product.name));
    inventory = ctx.app.get(getModelToken(Inventory.name));
    passwords = ctx.app.get(PasswordService);

    // `Model.init()` resolves once Mongoose's autoIndex build has
    // actually finished. Without waiting for it, the FIRST `$text`
    // query in this file can race the `searchText` text index's
    // creation on a fresh in-memory replica set and fail with "text
    // index required for $text query" — a false negative, not a real
    // product of the code under test.
    await Promise.all([
      users.init(),
      vendors.init(),
      categories.init(),
      products.init(),
      inventory.init(),
    ]);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  it('is reachable with no Authorization header at all (public)', async () => {
    const res = await request(server)
      .get('/products')
      .query({ q: 'nonexistentxyz' })
      .set('X-Forwarded-For', nextIp());
    expect(res.status).toBe(200);
  });

  it('finds a product across two different vendors\' stores by one search term', async () => {
    const term = `marketsearch${uniqueSuffix()}`;

    const storeA = await seedStore('Market Store A', [77.6101, 12.9352]);
    const storeB = await seedStore('Market Store B', [77.6155, 12.9401]);

    await seedProduct(storeA, 'Term Product A', `${term} vendor a`);
    await seedProduct(storeB, 'Term Product B', `${term} vendor b`);

    const res = await request(server).get('/products').query({ q: term });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);

    const storeIds = res.body.data.map((row: { store: { id: string } }) => row.store.id);
    expect(new Set(storeIds).size).toBe(2);

    for (const row of res.body.data) {
      expect(row.store.slug).toBeTruthy();
      expect(row.store.storeName).toBeTruthy();
      // No lat/lng was supplied on this request.
      expect(row.store.distanceKm).toBeNull();
    }
  });

  it("a SUSPENDED vendor's products are invisible to market-wide search", async () => {
    const term = `suspendedcheck${uniqueSuffix()}`;

    const openStore = await seedStore('Open Store', [77.61, 12.93]);
    const suspendedStore = await seedStore(
      'Suspended Store',
      [77.611, 12.931],
      VendorStatus.SUSPENDED,
    );

    await seedProduct(openStore, 'Visible Product', `${term} visible`);
    await seedProduct(suspendedStore, 'Hidden Product', `${term} hidden`);

    const res = await request(server).get('/products').query({ q: term });

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].name).toBe('Visible Product');
  });

  it('market-wide aisle browsing (?aisleKey=) also spans every store', async () => {
    const aisle = AisleKey.FROZEN;
    const storeA = await seedStore('Aisle Store A', [77.62, 12.94]);
    const storeB = await seedStore('Aisle Store B', [77.63, 12.95]);

    const before = await request(server).get('/products').query({ aisleKey: aisle });
    const baseline = before.body.meta.total as number;

    await seedProduct(storeA, `Frozen Peas ${uniqueSuffix()}`, 'frozen peas', aisle);
    await seedProduct(storeB, `Frozen Corn ${uniqueSuffix()}`, 'frozen corn', aisle);

    const after = await request(server).get('/products').query({ aisleKey: aisle });
    expect(after.status).toBe(200);
    expect(after.body.meta.total).toBe(baseline + 2);
  });

  it('distanceKm is populated (not null) once lat/lng are supplied', async () => {
    const term = `distancecheck${uniqueSuffix()}`;
    const store = await seedStore('Distance Store', [77.6101, 12.9352]);
    await seedProduct(store, 'Distance Product', `${term} product`);

    const res = await request(server)
      .get('/products')
      .query({ q: term, lat: 12.9352, lng: 77.6101 });

    expect(res.status).toBe(200);
    expect(res.body.data[0].store.distanceKm).not.toBeNull();
    expect(typeof res.body.data[0].store.distanceKm).toBe('number');
  });

  // ── PIN code fallback on GET /stores ────────────────────────────────

  it('resolves a known pincode to a centre and returns serviceable stores', async () => {
    await seedStore('Pincode Store', KNOWN_PINCODE_COORDS);

    const res = await request(server)
      .get('/stores')
      .query({ pincode: KNOWN_PINCODE });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Every returned row is within its own serviceRadiusKm — geo math is
    // already covered by shop.spec.ts; here we only assert the pincode
    // path doesn't 500 and produces a normal, distance-annotated list.
    for (const row of res.body.data) {
      expect(typeof row.distanceKm).toBe('number');
    }
  });

  it('an unrecognised pincode is a clean 400, never a 500', async () => {
    const res = await request(server)
      .get('/stores')
      .query({ pincode: UNKNOWN_PINCODE });

    expect(res.status).toBe(400);
  });

  it('a malformed pincode (not 6 digits) is a 400 from validation', async () => {
    const res = await request(server).get('/stores').query({ pincode: '123' });
    expect(res.status).toBe(400);
  });

  it('a real lat/lng takes precedence over pincode when both are sent', async () => {
    // Far from the pincode's centre — if pincode won, this would 200
    // with an empty (or very different) result set than a lat/lng
    // covering the seeded store above.
    const res = await request(server).get('/stores').query({
      lat: 12.9352,
      lng: 77.6101,
      pincode: UNKNOWN_PINCODE, // would 400 alone — must be ignored here
    });

    expect(res.status).toBe(200);
  });

  // ── PIN code fallback on GET /products ──────────────────────────────
  //
  // `GET /products` used to accept only `lat`/`lng`. The web app holds ONE
  // location object which is either a device fix or a typed PIN, so the
  // moment a customer who denied geolocation typed a PIN, the entire
  // product grid answered `400 property pincode should not exist` —
  // `forbidNonWhitelisted` is on, and an unknown param is a hard refusal.
  // These four cases are that bug, nailed down.

  it('accepts a pincode and measures distance from its centre', async () => {
    const term = `pincodemarket${uniqueSuffix()}`;
    const store = await seedStore('Pincode Market Store', KNOWN_PINCODE_COORDS);
    await seedProduct(store, 'Pincode Product', `${term} product`);

    const res = await request(server)
      .get('/products')
      .query({ q: term, pincode: KNOWN_PINCODE });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(typeof res.body.data[0].store.distanceKm).toBe('number');
  });

  it('a pincode only MEASURES on /products — it never filters a store out', async () => {
    const term = `pincodenofilter${uniqueSuffix()}`;
    // Kolkata, ~1,500 km from the Bengaluru PIN below. `GET /stores`
    // would drop it; `GET /products` must not, because a market-wide
    // search is "does anyone sell this", not "what is near me".
    const faraway = await seedStore('Faraway Store', [88.3697, 22.5697]);
    await seedProduct(faraway, 'Faraway Product', `${term} faraway`);

    const res = await request(server)
      .get('/products')
      .query({ q: term, pincode: KNOWN_PINCODE });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].store.distanceKm).toBeGreaterThan(1000);
  });

  it('an unserviceable pincode on /products 400s with the serviceable list', async () => {
    const res = await request(server)
      .get('/products')
      .query({ pincode: UNKNOWN_PINCODE });

    expect(res.status).toBe(400);
    // The code is what the client switches on; the list is what the UI
    // shows instead of making the customer guess PINs at random.
    expect(res.body.errors.code).toBe('PINCODE_NOT_SERVICEABLE');
    expect(Array.isArray(res.body.errors.serviceable)).toBe(true);
    expect(res.body.errors.serviceable.length).toBeGreaterThan(0);
    expect(res.body.errors.serviceable[0]).toHaveProperty('city');
    expect(res.body.errors.serviceable[0]).toHaveProperty('pincodes');
  });

  it('rejects `radius` on /products — it filters on /stores and would lie here', async () => {
    const res = await request(server)
      .get('/products')
      .query({ lat: 12.9352, lng: 77.6101, radius: 5 });

    expect(res.status).toBe(400);
  });

  // ── ELECTRONICS: a real aisle with a real category and NO products ───

  it('ELECTRONICS is a valid aisleKey and answers an honest empty page', async () => {
    // The demo catalogue was wiped deliberately. This aisle exists so the
    // rail is complete; seeding products into it would put invented rows
    // back in front of the user. An empty 200 is the correct answer, and
    // it must NOT be the 400 an unknown enum value would produce.
    const res = await request(server)
      .get('/products')
      .query({ aisleKey: AisleKey.ELECTRONICS });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('an aisleKey outside the enum is still a 400, not an unfiltered page', async () => {
    const res = await request(server)
      .get('/products')
      .query({ aisleKey: 'furniture' });

    expect(res.status).toBe(400);
  });

  // ── GET /pincodes/:pincode — the non-map lat/lng fallback ───────────
  //
  // `CreateAddressDto` requires lat/lng, and the web app normally takes
  // them from a Google map pin. With Maps billing off the map is a
  // placeholder, the pin cannot be dropped, and a customer who also
  // denied geolocation could save no address at all — locking them out
  // of checkout on a screen that otherwise looked fine. This route is
  // that customer's way through.

  it('resolves a serviceable pincode to a centre with real coordinates', async () => {
    const res = await request(server)
      .get(`/pincodes/${KNOWN_PINCODE}`)
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
    expect(res.body.pincode).toBe(KNOWN_PINCODE);
    expect(res.body.city).toBeTruthy();
    // [lng, lat] in the GeoJSON fixture; the response is {lat, lng}.
    expect(res.body.lat).toBeCloseTo(KNOWN_PINCODE_COORDS[1], 3);
    expect(res.body.lng).toBeCloseTo(KNOWN_PINCODE_COORDS[0], 3);
  });

  it('is public — no Authorization header required', async () => {
    const res = await request(server)
      .get(`/pincodes/${KNOWN_PINCODE}`)
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
  });

  it('refuses an unserviceable pincode with the same code and list as the browse routes', async () => {
    const res = await request(server)
      .get(`/pincodes/${UNKNOWN_PINCODE}`)
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(400);
    expect(res.body.errors.code).toBe('PINCODE_NOT_SERVICEABLE');
    expect(Array.isArray(res.body.errors.serviceable)).toBe(true);
  });
});
