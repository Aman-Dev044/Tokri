import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';
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
import {
  InventoryLog,
  InventoryLogDocument,
} from '../../src/database/schemas/inventory-log.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
  VehicleType,
} from '../../src/database/schemas/delivery-partner.schema';
import {
  Settlement,
  SettlementDocument,
  SettlementStatus,
} from '../../src/database/schemas/settlement.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
  LedgerEntryType,
} from '../../src/database/schemas/ledger-entry.schema';
import { AisleKey } from '../../src/common/constants/aisle.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  MULTI-TENANT ISOLATION  (Challenge #1, §8.1)
 * ════════════════════════════════════════════════════════════════════════
 *
 * The risk in one sentence: vendor A changes an id in a URL and reads
 * vendor B's orders, stock or revenue.
 *
 * This suite is the fourth layer of §8.1 — "isolation you have not tried
 * to break is isolation you do not have". It authenticates as vendor A
 * and then addresses EVERY ONE of vendor B's resources by id: their
 * order, their product, their inventory row, their category, their
 * delivery partner and their settlement. Every single one must come back
 * 404 or 403, and none may leak a field.
 *
 * ── Why 404 and not 403 for a cross-tenant id ───────────────────────────
 * A 403 confirms the document EXISTS and is simply not yours, which turns
 * every endpoint into an enumeration oracle: walk the id space and each
 * 403 marks a real order. To a non-owner the resource must simply not
 * exist.
 *
 * ── Why the route list is DISCOVERED ────────────────────────────────────
 * A hand-written list goes stale. Somebody adds `GET /vendor/payouts`,
 * forgets this file, and the one route nothing asserts on is the new one.
 * Every `/vendor/*` route Nest actually registered is swept below.
 */

/** Generated per run, never a literal. Long enough for every DTO. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** An id that is well-formed and belongs to nobody. */
const GHOST_ID = new Types.ObjectId().toString();

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteInfo {
  method: Verb;
  /** `/vendor/orders/:id/accept` — as declared. */
  template: string;
  /** The same path with a real ObjectId substituted for every param. */
  path: string;
  controller: string;
  handler: string;
  roles: Role[];
  isPublic: boolean;
}

const normalise = (segment: unknown): string =>
  typeof segment === 'string' ? segment.replace(/^\/+|\/+$/g, '') : '';

function enumerateRoutes(
  discovery: DiscoveryService,
  reflector: Reflector,
): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance;
    const metatype = wrapper.metatype;
    if (!instance || typeof metatype !== 'function') continue;

    const controllerPath = normalise(
      Reflect.getMetadata(PATH_METADATA, metatype),
    );
    const prototype = Object.getPrototypeOf(instance) as object;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;

      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      const handler = descriptor.value as (...args: unknown[]) => unknown;
      if (!Reflect.hasMetadata(PATH_METADATA, handler)) continue;

      const methodPath = normalise(Reflect.getMetadata(PATH_METADATA, handler));
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;

      const segments = [controllerPath, methodPath].filter(Boolean);
      const template = `/${segments.join('/')}`;

      routes.push({
        method: RequestMethod[verb ?? RequestMethod.GET].toLowerCase() as Verb,
        template,
        path: template.replace(/:[A-Za-z0-9_]+/g, GHOST_ID),
        controller: metatype.name,
        handler: name,
        roles:
          reflector.getAllAndOverride<Role[]>(ROLES_KEY, [handler, metatype]) ??
          [],
        isPublic:
          reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            handler,
            metatype,
          ]) === true,
      });
    }
  }

  return routes;
}

/** Everything one seeded store owns, by id. */
interface Tenant {
  vendorId: string;
  ownerId: string;
  token: string;
  categoryId: string;
  productId: string;
  orderId: string;
  partnerId: string;
  settlementId: string;
}

describe('Vendor multi-tenant isolation (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let categories: Model<CategoryDocument>;
  let products: Model<ProductDocument>;
  let inventory: Model<InventoryDocument>;
  let inventoryLogs: Model<InventoryLogDocument>;
  let orders: Model<OrderDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let settlements: Model<SettlementDocument>;
  let ledger: Model<LedgerEntryDocument>;
  let passwords: PasswordService;

  let vendorRoutes: RouteInfo[];
  let alpha: Tenant;
  let bravo: Tenant;
  let customerToken: string;

  let counter = 0;

  const phone = (): string => `98${String(++counter).padStart(8, '0')}`;

  async function seedUser(
    role: Role,
    vendorId: Types.ObjectId | null,
  ): Promise<UserDocument> {
    const n = ++counter;
    return users.create({
      name: `Isolation ${role} ${n}`,
      email: `isolation-${n}-${Date.now()}@test.invalid`,
      phone: `97${String(n).padStart(8, '0')}`,
      passwordHash: await passwords.hash(PASSWORD),
      role,
      status: UserStatus.ACTIVE,
      vendorId,
    });
  }

  async function login(email: string): Promise<string> {
    // A distinct source IP per login: /auth/login is rate-limited to 5
    // per minute per IP, and that limit is a feature under test
    // elsewhere — not an obstacle to disable here.
    const res = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: email, password: PASSWORD });

    expect([email, res.status]).toEqual([email, 200]);
    return res.body.accessToken as string;
  }

  /** A complete, self-consistent store: owner, catalogue, stock, orders, money. */
  async function seedTenant(label: string): Promise<Tenant> {
    const vendorId = new Types.ObjectId();
    const owner = await seedUser(Role.VENDOR, vendorId);

    await vendors.create({
      _id: vendorId,
      ownerId: owner._id,
      storeName: `${label} Mandi`,
      slug: `${label.toLowerCase()}-mandi-${Date.now()}-${counter}`,
      address: {
        line1: '1 Market Lane',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      },
      location: { type: 'Point', coordinates: [73.8567, 18.5204] },
      commissionPct: 12,
      status: VendorStatus.APPROVED,
      isOpen: true,
    });

    const category = await categories.create({
      vendorId,
      name: `${label} Greens`,
      slug: `${label.toLowerCase()}-greens`,
      aisleKey: AisleKey.VEGETABLES,
    });

    const product = await products.create({
      vendorId,
      categoryId: category._id,
      name: `${label} Spinach`,
      slug: `${label.toLowerCase()}-spinach`,
      unit: ProductUnit.G,
      unitValue: 250,
      sku: `${label.toUpperCase()}-SKU-1`,
      mrp: 5_000,
      price: 4_000,
      searchText: `${label} spinach`.toLowerCase(),
    });

    await inventory.create({
      vendorId,
      productId: product._id,
      stock: 40,
      reserved: 0,
      lowStockThreshold: 10,
    });

    const customer = await seedUser(Role.CUSTOMER, null);

    const order = await orders.create({
      orderNo: `MND-ISO-${label}-${Date.now()}-${counter}`,
      customerId: customer._id,
      vendorId,
      items: [
        {
          productId: product._id,
          name: `${label} Spinach`,
          unit: '250g',
          price: 4_000,
          qty: 3,
          lineTotal: 12_000,
          fulfilled: true,
        },
        {
          productId: product._id,
          name: `${label} Coriander`,
          unit: '100g',
          price: 2_000,
          qty: 4,
          lineTotal: 8_000,
          fulfilled: true,
        },
      ],
      pricing: {
        itemsSubtotal: 20_000,
        discount: 2_000,
        deliveryFee: 3_000,
        taxes: 1_000,
        grandTotal: 22_000,
        commissionPct: 12,
        commissionAmount: 2_400,
        vendorPayout: 17_600,
      },
      address: {
        line1: '9 Customer Street',
        city: 'Pune',
        pincode: '411002',
        location: { type: 'Point', coordinates: [73.86, 18.52] },
        phone: phone(),
      },
      payment: {
        method: PaymentMethod.ONLINE,
        status: PaymentStatus.PAID,
      },
      status: OrderStatus.PLACED,
      statusHistory: [],
      placedAt: new Date(),
    });

    const riderUser = await seedUser(Role.DELIVERY, vendorId);
    const partner = await partners.create({
      userId: riderUser._id,
      vendorId,
      vehicleType: VehicleType.SCOOTER,
      status: PartnerStatus.ACTIVE,
    });

    const settlement = await settlements.create({
      vendorId,
      periodStart: new Date(Date.now() - 7 * 86_400_000),
      periodEnd: new Date(),
      grossSales: 20_000,
      totalCommission: 2_400,
      refunds: 0,
      netPayable: 17_600,
      orderCount: 1,
      status: SettlementStatus.PENDING,
    });

    await ledger.create({
      vendorId,
      orderId: order._id,
      type: LedgerEntryType.SALE,
      amount: 20_000,
      at: new Date(),
    });

    return {
      vendorId: vendorId.toString(),
      ownerId: owner._id.toString(),
      token: await login(owner.email as string),
      categoryId: category._id.toString(),
      productId: product._id.toString(),
      orderId: order._id.toString(),
      partnerId: partner._id.toString(),
      settlementId: settlement._id.toString(),
    };
  }

  const send = (route: RouteInfo, token?: string) => {
    const req = request(server)
      [route.method](route.path)
      .set('X-Forwarded-For', nextIp());
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send({});
  };

  const as = (token: string, method: Verb, path: string) =>
    request(server)
      [method](path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);

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
    partners = ctx.app.get<Model<DeliveryPartnerDocument>>(
      getModelToken(DeliveryPartner.name),
    );
    settlements = ctx.app.get<Model<SettlementDocument>>(
      getModelToken(Settlement.name),
    );
    ledger = ctx.app.get<Model<LedgerEntryDocument>>(
      getModelToken(LedgerEntry.name),
    );
    passwords = ctx.app.get(PasswordService);

    vendorRoutes = enumerateRoutes(
      ctx.app.get(DiscoveryService),
      ctx.app.get(Reflector),
    ).filter((route) => route.template.startsWith('/vendor'));

    alpha = await seedTenant('Alpha');
    bravo = await seedTenant('Bravo');

    const customer = await seedUser(Role.CUSTOMER, null);
    customerToken = await login(customer.email as string);
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  The route inventory itself
  // ══════════════════════════════════════════════════════════════════

  it('discovers the vendor surface (guards the test itself)', () => {
    // If discovery silently returned nothing, every sweep below would
    // pass vacuously. This is the canary for that.
    expect(vendorRoutes.length).toBeGreaterThan(20);

    expect(
      vendorRoutes.map((route) => `${route.method} ${route.template}`),
    ).toEqual(
      expect.arrayContaining([
        'get /vendor/profile',
        'put /vendor/profile',
        'patch /vendor/store/status',
        'put /vendor/store/hours',
        'get /vendor/dashboard',
        'get /vendor/categories',
        'post /vendor/categories',
        'get /vendor/products',
        'post /vendor/products',
        'post /vendor/products/:id/images',
        'get /vendor/inventory',
        'patch /vendor/inventory/:productId',
        'post /vendor/inventory/bulk',
        'get /vendor/orders',
        'get /vendor/orders/:id',
        'patch /vendor/orders/:id/accept',
        'patch /vendor/orders/:id/reject',
        'patch /vendor/orders/:id/status',
        'patch /vendor/orders/:id/items',
        'post /vendor/orders/:id/assign',
        'get /vendor/delivery-partners',
        'post /vendor/delivery-partners',
        'patch /vendor/delivery-partners/:id/status',
        'get /vendor/earnings',
        'get /vendor/earnings/ledger',
        'get /vendor/settlements',
        'get /vendor/reports/sales',
        'get /vendor/reports/top-products',
      ]),
    );
  });

  it('marks no vendor route @Public()', () => {
    // `public-routes.spec.ts` pins the complete allowlist; this is the
    // local restatement of it. Every route here reads or writes a
    // store's own commercial data.
    const leaked = vendorRoutes.filter((route) => route.isPublic);
    expect(leaked.map((route) => route.template)).toEqual([]);
  });

  it('declares @Roles(VENDOR) on every vendor route', () => {
    const unroled = vendorRoutes.filter(
      (route) => !route.roles.includes(Role.VENDOR),
    );

    if (unroled.length > 0) {
      throw new Error(
        '\n\nVENDOR ROUTE(S) WITHOUT @Roles(Role.VENDOR):\n' +
          unroled
            .map(
              (route) =>
                `    ${route.method.toUpperCase()} ${route.template}   (${route.controller}.${route.handler})`,
            )
            .join('\n') +
          '\n  Without it a route is merely "authenticated", which means any\n' +
          '  customer with a valid token can reach it.\n',
      );
    }
    expect(unroled).toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════
  //  1. Anonymous  →  401
  // ══════════════════════════════════════════════════════════════════

  it('rejects every /vendor route with 401 when no token is presented', async () => {
    for (const route of vendorRoutes) {
      const res = await send(route);

      if (res.status !== 401) {
        throw new Error(
          `\n\nUNPROTECTED VENDOR ROUTE: ${route.method.toUpperCase()} ${route.template} ` +
            `(${route.controller}.${route.handler}) returned ${res.status} to an ` +
            'anonymous request; expected 401.\n',
        );
      }
      expect(res.status).toBe(401);
    }
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  //  2. A CUSTOMER token  →  403
  // ══════════════════════════════════════════════════════════════════

  it('rejects every /vendor route with 403 for a CUSTOMER token', async () => {
    for (const route of vendorRoutes) {
      const res = await send(route, customerToken);

      if (res.status !== 403) {
        throw new Error(
          `\n\nROLE LEAK: ${route.method.toUpperCase()} ${route.template} ` +
            `(${route.controller}.${route.handler}) returned ${res.status} to a ` +
            'CUSTOMER token; expected 403.\n' +
            'Authenticated is not authorised: the vendor surface is a ' +
            "store's stock, orders and revenue.\n",
        );
      }
      expect(res.status).toBe(403);
    }
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  //  3. ★ Vendor A addressing every one of vendor B's resources
  // ══════════════════════════════════════════════════════════════════

  it("never leaks vendor B's ORDER to vendor A", async () => {
    const attempts: [Verb, string, object][] = [
      ['get', `/vendor/orders/${bravo.orderId}`, {}],
      ['patch', `/vendor/orders/${bravo.orderId}/accept`, {}],
      ['patch', `/vendor/orders/${bravo.orderId}/reject`, { reason: 'stolen' }],
      [
        'patch',
        `/vendor/orders/${bravo.orderId}/status`,
        { status: OrderStatus.ACCEPTED },
      ],
      [
        'patch',
        `/vendor/orders/${bravo.orderId}/items`,
        { items: [{ productId: bravo.productId, fulfilled: false }] },
      ],
      [
        'post',
        `/vendor/orders/${bravo.orderId}/assign`,
        { partnerId: alpha.partnerId },
      ],
    ];

    for (const [method, path, body] of attempts) {
      const res = await as(alpha.token, method, path).send(body);

      expect([path, res.status]).toEqual([path, 404]);
      // Not one field of the foreign order may appear in the response.
      expect(JSON.stringify(res.body)).not.toContain('Bravo');
    }

    // And the write must not have happened.
    const untouched = await orders.findById(bravo.orderId).lean().exec();
    expect(untouched?.status).toBe(OrderStatus.PLACED);
  }, 60_000);

  it("never leaks vendor B's PRODUCT to vendor A", async () => {
    const attempts: [Verb, string, object][] = [
      ['get', `/vendor/products/${bravo.productId}`, {}],
      ['patch', `/vendor/products/${bravo.productId}`, { price: 1 }],
      ['delete', `/vendor/products/${bravo.productId}`, {}],
      [
        'post',
        `/vendor/products/${bravo.productId}/images`,
        { contentType: 'image/webp', sizeBytes: 1024 },
      ],
    ];

    for (const [method, path, body] of attempts) {
      const res = await as(alpha.token, method, path).send(body);
      expect([path, res.status]).toEqual([path, 404]);
      expect(JSON.stringify(res.body)).not.toContain('Bravo');
    }

    const untouched = await products.findById(bravo.productId).lean().exec();
    expect(untouched?.price).toBe(4_000);
  }, 60_000);

  it("never leaks vendor B's INVENTORY ROW to vendor A", async () => {
    const before = await inventory
      .findOne({ productId: new Types.ObjectId(bravo.productId) })
      .lean()
      .exec();
    const logsBefore = await inventoryLogs
      .countDocuments({ productId: new Types.ObjectId(bravo.productId) })
      .exec();

    const read = await as(
      alpha.token,
      'get',
      `/vendor/inventory/${bravo.productId}`,
    ).send({});
    expect(read.status).toBe(404);

    const write = await as(
      alpha.token,
      'patch',
      `/vendor/inventory/${bravo.productId}`,
    ).send({ delta: -40, reason: 'manual' });
    expect(write.status).toBe(404);

    const bulk = await as(alpha.token, 'post', '/vendor/inventory/bulk').send({
      adjustments: [{ productId: bravo.productId, delta: -40 }],
      reason: 'manual',
    });
    expect(bulk.status).toBe(404);

    // The stock and the append-only log are both exactly as they were:
    // a cross-tenant write that "fails" but still moves a number is not
    // a failure, it is a silent success.
    const after = await inventory
      .findOne({ productId: new Types.ObjectId(bravo.productId) })
      .lean()
      .exec();
    expect(after?.stock).toBe(before?.stock);
    expect(
      await inventoryLogs
        .countDocuments({ productId: new Types.ObjectId(bravo.productId) })
        .exec(),
    ).toBe(logsBefore);
  }, 60_000);

  it("never leaks vendor B's CATEGORY to vendor A", async () => {
    const update = await as(
      alpha.token,
      'patch',
      `/vendor/categories/${bravo.categoryId}`,
    ).send({ name: 'Hijacked' });
    expect(update.status).toBe(404);

    const remove = await as(
      alpha.token,
      'delete',
      `/vendor/categories/${bravo.categoryId}`,
    ).send({});
    expect(remove.status).toBe(404);

    const still = await categories.findById(bravo.categoryId).lean().exec();
    expect(still?.name).toContain('Bravo');
  }, 60_000);

  it("never leaks vendor B's DELIVERY PARTNER to vendor A", async () => {
    const attempts: [Verb, string, object][] = [
      ['get', `/vendor/delivery-partners/${bravo.partnerId}`, {}],
      [
        'patch',
        `/vendor/delivery-partners/${bravo.partnerId}`,
        { name: 'Hijacked' },
      ],
      [
        'patch',
        `/vendor/delivery-partners/${bravo.partnerId}/status`,
        { status: PartnerStatus.SUSPENDED },
      ],
      ['delete', `/vendor/delivery-partners/${bravo.partnerId}`, {}],
    ];

    for (const [method, path, body] of attempts) {
      const res = await as(alpha.token, method, path).send(body);
      expect([path, res.status]).toEqual([path, 404]);
    }

    const untouched = await partners.findById(bravo.partnerId).lean().exec();
    expect(untouched?.status).toBe(PartnerStatus.ACTIVE);
  }, 60_000);

  it("never conscripts vendor B's RIDER onto vendor A's order", async () => {
    // Make A's order assignable first, through the real state machine.
    await as(alpha.token, 'patch', `/vendor/orders/${alpha.orderId}/accept`)
      .send({ etaMinutes: 20 })
      .expect(200);
    await as(alpha.token, 'patch', `/vendor/orders/${alpha.orderId}/status`)
      .send({ status: OrderStatus.PACKING })
      .expect(200);
    await as(alpha.token, 'patch', `/vendor/orders/${alpha.orderId}/status`)
      .send({ status: OrderStatus.READY_FOR_PICKUP })
      .expect(200);

    const stolen = await as(
      alpha.token,
      'post',
      `/vendor/orders/${alpha.orderId}/assign`,
    ).send({ partnerId: bravo.partnerId });

    // 404 on the PARTNER, not 409 and not 200: to vendor A, vendor B's
    // rider does not exist.
    expect(stolen.status).toBe(404);

    const rider = await partners.findById(bravo.partnerId).lean().exec();
    expect(rider?.activeOrderId ?? null).toBeNull();

    // A's own rider still works — proving the 404 above was tenancy and
    // not a broken endpoint.
    const ok = await as(
      alpha.token,
      'post',
      `/vendor/orders/${alpha.orderId}/assign`,
    ).send({ partnerId: alpha.partnerId });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe(OrderStatus.ASSIGNED);
  }, 60_000);

  it("never leaks vendor B's SETTLEMENT to vendor A", async () => {
    const direct = await as(
      alpha.token,
      'get',
      `/vendor/settlements/${bravo.settlementId}`,
    ).send({});
    expect(direct.status).toBe(404);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  4. Lists carry only the caller's own rows
  // ══════════════════════════════════════════════════════════════════

  it('returns only the caller’s own rows from every list endpoint', async () => {
    const lists: [string, (body: Record<string, unknown>) => string[]][] = [
      [
        '/vendor/products',
        (body) =>
          (body.data as { id: string }[]).map((row) => row.id),
      ],
      [
        '/vendor/inventory',
        (body) =>
          (body.data as { productId: string }[]).map((row) => row.productId),
      ],
      [
        '/vendor/orders',
        (body) => (body.data as { id: string }[]).map((row) => row.id),
      ],
      [
        '/vendor/delivery-partners',
        (body) => (body.data as { id: string }[]).map((row) => row.id),
      ],
      [
        '/vendor/settlements',
        (body) => (body.data as { id: string }[]).map((row) => row.id),
      ],
      [
        '/vendor/earnings/ledger',
        (body) => (body.data as { id: string }[]).map((row) => row.id),
      ],
    ];

    const foreign = new Set([
      bravo.productId,
      bravo.orderId,
      bravo.partnerId,
      bravo.settlementId,
    ]);

    for (const [path, ids] of lists) {
      const res = await as(alpha.token, 'get', path).send({});
      expect([path, res.status]).toEqual([path, 200]);

      const returned = ids(res.body as Record<string, unknown>);
      for (const id of returned) {
        expect([path, foreign.has(id)]).toEqual([path, false]);
      }
      expect([path, JSON.stringify(res.body).includes('Bravo')]).toEqual([
        path,
        false,
      ]);
    }
  }, 60_000);

  it('scopes the dashboard and the earnings summary to the caller', async () => {
    const dashboard = await as(alpha.token, 'get', '/vendor/dashboard').send({});
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.vendorId).toBe(alpha.vendorId);
    expect(dashboard.body.storeName).toContain('Alpha');
    expect(dashboard.body.sparkline).toHaveLength(7);

    const profile = await as(alpha.token, 'get', '/vendor/profile').send({});
    expect(profile.status).toBe(200);
    expect(profile.body.id).toBe(alpha.vendorId);

    // B's own numbers are B's: A's ledger sale of 20,000 paise must not
    // appear in B's summary, and vice versa.
    const earningsA = await as(alpha.token, 'get', '/vendor/earnings').send({});
    const earningsB = await as(bravo.token, 'get', '/vendor/earnings').send({});
    expect(earningsA.status).toBe(200);
    expect(earningsB.status).toBe(200);
    expect(earningsA.body.payoutPending).toBe(17_600);
    expect(earningsB.body.payoutPending).toBe(17_600);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  5. The state machine
  // ══════════════════════════════════════════════════════════════════

  it('returns 409 for a transition that is not on the state machine', async () => {
    // Bravo's order is PLACED. PLACED → DELIVERED is not an edge on the
    // §5.3 graph, so this is a conflict — never a silent success.
    const res = await as(
      bravo.token,
      'patch',
      `/vendor/orders/${bravo.orderId}/status`,
    ).send({ status: OrderStatus.DELIVERED });

    expect(res.status).toBe(409);

    const untouched = await orders.findById(bravo.orderId).lean().exec();
    expect(untouched?.status).toBe(OrderStatus.PLACED);
  }, 60_000);

  it('returns 409 for an edge that exists but is not a vendor action', async () => {
    // A's order is ASSIGNED by now. ASSIGNED → PICKED_UP is on the
    // graph, but ALLOWED_ACTOR gives it to the DELIVERY role: a vendor
    // who could drive it would mark goods collected that are still on
    // their own shelf.
    const res = await as(
      alpha.token,
      'patch',
      `/vendor/orders/${alpha.orderId}/status`,
    ).send({ status: OrderStatus.PICKED_UP });

    expect(res.status).toBe(409);
  }, 60_000);

  it('returns 400 when a rejection carries no reason', async () => {
    const res = await as(
      bravo.token,
      'patch',
      `/vendor/orders/${bravo.orderId}/reject`,
    ).send({});

    expect(res.status).toBe(400);

    const untouched = await orders.findById(bravo.orderId).lean().exec();
    expect(untouched?.status).toBe(OrderStatus.PLACED);
  }, 60_000);

  it('rejects an order when a reason IS given, and records it', async () => {
    const res = await as(
      bravo.token,
      'patch',
      `/vendor/orders/${bravo.orderId}/reject`,
    ).send({ reason: 'Out of stock on two lines' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(OrderStatus.REJECTED);
    expect(res.body.cancellation.reason).toBe('Out of stock on two lines');
    expect(
      res.body.statusHistory[res.body.statusHistory.length - 1].to,
    ).toBe(OrderStatus.REJECTED);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  6. Stock, the log, and the negative-stock guard
  // ══════════════════════════════════════════════════════════════════

  it('writes an InventoryLog row in the same transaction as every adjustment', async () => {
    const productId = alpha.productId;
    const before = await inventoryLogs
      .countDocuments({ productId: new Types.ObjectId(productId) })
      .exec();

    const res = await as(
      alpha.token,
      'patch',
      `/vendor/inventory/${productId}`,
    ).send({ delta: 25, reason: 'restock' });

    expect(res.status).toBe(200);
    expect(res.body.stock).toBe(65); // 40 + 25

    const after = await inventoryLogs
      .find({ productId: new Types.ObjectId(productId) })
      .sort({ at: -1 })
      .lean()
      .exec();

    expect(after.length).toBe(before + 1);
    expect(after[0].delta).toBe(25);
    expect(after[0].reason).toBe('restock');

    // The log reconstructs the value: 40 opening + every logged delta.
    const fromLog = after.reduce((sum, row) => sum + row.delta, 40);
    expect(fromLog).toBe(65);
  }, 60_000);

  it('refuses to drive stock negative, and leaves no log row behind', async () => {
    const productId = alpha.productId;
    const before = await inventoryLogs
      .countDocuments({ productId: new Types.ObjectId(productId) })
      .exec();

    const res = await as(
      alpha.token,
      'patch',
      `/vendor/inventory/${productId}`,
    ).send({ delta: -10_000, reason: 'manual' });

    expect(res.status).toBe(409);

    const row = await inventory
      .findOne({ productId: new Types.ObjectId(productId) })
      .lean()
      .exec();
    expect(row?.stock).toBe(65);

    expect(
      await inventoryLogs
        .countDocuments({ productId: new Types.ObjectId(productId) })
        .exec(),
    ).toBe(before);
  }, 60_000);

  it('applies a bulk adjustment all-or-nothing', async () => {
    const productId = alpha.productId;

    // One good line, one that would go negative. Neither may land.
    const res = await as(alpha.token, 'post', '/vendor/inventory/bulk').send({
      adjustments: [
        { productId, delta: 5 },
        { productId: GHOST_ID, delta: 5 },
      ],
      reason: 'manual',
    });

    expect(res.status).toBe(404);

    const row = await inventory
      .findOne({ productId: new Types.ObjectId(productId) })
      .lean()
      .exec();
    expect(row?.stock).toBe(65);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  7. Image upload is unconfigured, and says so cleanly
  // ══════════════════════════════════════════════════════════════════

  it('returns 503 — not a crash — while object storage is unconfigured', async () => {
    const res = await as(
      alpha.token,
      'post',
      `/vendor/products/${alpha.productId}/images`,
    ).send({ contentType: 'image/webp', sizeBytes: 2048 });

    // 503, not 500: the service is correctly built and temporarily
    // unable to do this one thing. The global filter deliberately
    // replaces every 5xx `detail` with a generic string — the operator
    // gets the specific "set S3_*" line in the log, the caller does not
    // get a map of the deployment's configuration.
    expect(res.status).toBe(503);
    expect(res.body.title).toBe('SERVICE_UNAVAILABLE');

    // The rest of the module is unaffected: a missing bucket must not
    // take the order board down with it.
    const ok = await as(alpha.token, 'get', '/vendor/dashboard').send({});
    expect(ok.status).toBe(200);
  }, 60_000);

  it('rejects a disallowed content type or an oversized file before signing', async () => {
    const badType = await as(
      alpha.token,
      'post',
      `/vendor/products/${alpha.productId}/images`,
    ).send({ contentType: 'application/pdf', sizeBytes: 2048 });
    expect(badType.status).toBe(400);

    const tooBig = await as(
      alpha.token,
      'post',
      `/vendor/products/${alpha.productId}/images`,
    ).send({ contentType: 'image/png', sizeBytes: 6 * 1024 * 1024 });
    expect(tooBig.status).toBe(400);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  8. Partial fulfilment, end to end
  // ══════════════════════════════════════════════════════════════════

  it('re-prices a partially fulfilled order and books the refund to the ledger', async () => {
    // A fresh order for Alpha, taken to PACKING through the real
    // endpoints so nothing here depends on hand-written state.
    const customer = await seedUser(Role.CUSTOMER, null);
    const order = await orders.create({
      orderNo: `MND-ISO-PF-${Date.now()}`,
      customerId: customer._id,
      vendorId: new Types.ObjectId(alpha.vendorId),
      items: [
        {
          productId: new Types.ObjectId(alpha.productId),
          name: 'Alpha Spinach',
          unit: '250g',
          price: 4_000,
          qty: 15,
          lineTotal: 60_000,
          fulfilled: true,
        },
        {
          productId: new Types.ObjectId(bravo.productId),
          name: 'Alpha Coriander',
          unit: '100g',
          price: 4_000,
          qty: 10,
          lineTotal: 40_000,
          fulfilled: true,
        },
      ],
      pricing: {
        itemsSubtotal: 100_000,
        discount: 5_000,
        deliveryFee: 3_000,
        taxes: 5_000,
        grandTotal: 103_000,
        commissionPct: 12,
        commissionAmount: 12_000,
        vendorPayout: 88_000,
      },
      address: {
        line1: '9 Customer Street',
        city: 'Pune',
        pincode: '411002',
        location: { type: 'Point', coordinates: [73.86, 18.52] },
        phone: phone(),
      },
      payment: { method: PaymentMethod.ONLINE, status: PaymentStatus.PAID },
      status: OrderStatus.PLACED,
      statusHistory: [],
      placedAt: new Date(),
    });

    const id = order._id.toString();

    await as(alpha.token, 'patch', `/vendor/orders/${id}/accept`)
      .send({})
      .expect(200);

    const res = await as(alpha.token, 'patch', `/vendor/orders/${id}/items`)
      .send({
        items: [{ productId: bravo.productId, fulfilled: false }],
        reason: 'Coriander not available',
      });

    expect(res.status).toBe(200);
    expect(res.body.droppedLineCount).toBe(1);
    // ratio 0.6 — see test/unit/vendor-pricing.spec.ts for the full table.
    expect(res.body.order.pricing.itemsSubtotal).toBe(60_000);
    expect(res.body.order.pricing.grandTotal).toBe(63_000);
    expect(res.body.order.pricing.commissionAmount).toBe(7_200);
    expect(res.body.order.pricing.vendorPayout).toBe(52_800);
    expect(res.body.refundDelta).toBe(40_000);
    expect(res.body.payoutDelta).toBe(35_200);
    expect(res.body.ledgerEntryId).toEqual(expect.any(String));

    // The refund is on the ledger, signed from the vendor's side.
    const entry = await ledger
      .findById(res.body.ledgerEntryId as string)
      .lean()
      .exec();
    expect(entry?.type).toBe(LedgerEntryType.REFUND);
    expect(entry?.amount).toBe(-40_000);
    expect(entry?.vendorId.toString()).toBe(alpha.vendorId);

    // The captured payment records the refund too.
    const saved = await orders.findById(id).lean().exec();
    expect(saved?.payment.refundedAmount).toBe(40_000);
    expect(saved?.payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
  }, 60_000);

  it('refuses to drop every line — that is a rejection, not a fulfilment', async () => {
    const detail = await as(alpha.token, 'get', '/vendor/orders').send({});
    const packing = (detail.body.data as { id: string; status: string }[]).find(
      (row) => row.status === OrderStatus.ACCEPTED,
    );
    expect(packing).toBeDefined();

    const order = await orders.findById(packing?.id).lean().exec();
    const res = await as(
      alpha.token,
      'patch',
      `/vendor/orders/${packing?.id}/items`,
    ).send({
      items: (order?.items ?? []).map((item) => ({
        productId: item.productId.toString(),
        fulfilled: false,
      })),
    });

    expect(res.status).toBe(400);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  9. The vendor cannot re-price their own commission
  // ══════════════════════════════════════════════════════════════════

  it('refuses a profile update that tries to set commissionPct or status', async () => {
    // `forbidNonWhitelisted: true` on the global ValidationPipe turns an
    // unknown field into a 400 rather than a silently ignored one, so a
    // vendor who tries this is told no instead of believing it worked.
    const res = await as(alpha.token, 'put', '/vendor/profile').send({
      storeName: 'Alpha Mandi',
      commissionPct: 0,
    });
    expect(res.status).toBe(400);

    const vendor = await vendors.findById(alpha.vendorId).lean().exec();
    expect(vendor?.commissionPct).toBe(12);
  }, 60_000);
});
