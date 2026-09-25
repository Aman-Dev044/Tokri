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
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
  VehicleType,
} from '../../src/database/schemas/delivery-partner.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import {
  Product,
  ProductDocument,
  ProductUnit,
} from '../../src/database/schemas/product.schema';
import {
  Category,
  CategoryDocument,
} from '../../src/database/schemas/category.schema';
import {
  Inventory,
  InventoryDocument,
} from '../../src/database/schemas/inventory.schema';
import {
  Issue,
  IssueDocument,
  IssuePriority,
  IssueStatus,
  IssueType,
} from '../../src/database/schemas/issue.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { AisleKey } from '../../src/common/constants/aisle.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/** Generated per run, never a literal. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteInfo {
  method: Verb;
  template: string;
  path: string;
  controller: string;
  handler: string;
  roles: Role[];
  isPublic: boolean;
}

const normalise = (segment: unknown): string =>
  typeof segment === 'string' ? segment.replace(/^\/+|\/+$/g, '') : '';

/** Discovered, never hand-written — a hand-written list goes stale. */
function enumerateOpsRoutes(
  discovery: DiscoveryService,
  reflector: Reflector,
  anyId: string,
): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance;
    const metatype = wrapper.metatype;
    if (!instance || typeof metatype !== 'function') continue;

    const controllerPath = normalise(
      Reflect.getMetadata(PATH_METADATA, metatype),
    );
    if (!`/${controllerPath}`.startsWith('/admin/ops')) continue;

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

      const template = `/${[controllerPath, methodPath].filter(Boolean).join('/')}`;

      routes.push({
        method: RequestMethod[verb ?? RequestMethod.GET].toLowerCase() as Verb,
        template,
        path: template.replace(/:[A-Za-z0-9_]+/g, anyId),
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

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE ADMIN OPERATIONS CONSOLE
 * ════════════════════════════════════════════════════════════════════════
 *
 * Two classes of assertion, and both matter for different reasons.
 *
 * ── Authorisation ───────────────────────────────────────────────────────
 * Every discovered `/admin/ops/*` route, not a sample: anonymous gets 401,
 * a CUSTOMER token gets 403. The ops surface spans every vendor's live
 * orders, every rider's location and the whole support queue.
 *
 * ── The invariants that have no second line of defence ──────────────────
 * The state machine rejects an impossible assignment; a rider cannot hold
 * two orders; an issue cannot be resolved with nothing written down; a
 * vendor cannot be rejected without a reason. Each is enforced in ONE
 * place, so each is asserted here against a real database rather than
 * trusted to a code reading.
 */
describe('Admin operations console (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let orders: Model<OrderDocument>;
  let products: Model<ProductDocument>;
  let categories: Model<CategoryDocument>;
  let inventory: Model<InventoryDocument>;
  let issues: Model<IssueDocument>;
  let passwords: PasswordService;

  let opsRoutes: RouteInfo[];
  let adminToken: string;
  let customerToken: string;

  let vendorId: Types.ObjectId;
  let pendingVendorId: Types.ObjectId;
  let customerId: Types.ObjectId;
  let freeRiderId: Types.ObjectId;
  let busyRiderId: Types.ObjectId;
  let pendingRiderId: Types.ObjectId;
  let readyOrderId: string;
  let deliveredOrderId: string;
  let openIssueId: string;

  let counter = 0;

  const uniquePhone = (): string =>
    `95${String(++counter).padStart(8, '0')}`.slice(0, 10);

  async function seedUser(role: Role): Promise<{ id: string; email: string }> {
    const n = String(++counter).padStart(4, '0');
    const email = `ops${n}@test.invalid`;

    const created = await users.create({
      name: `Ops ${role} ${n}`,
      email,
      phone: `94${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role,
      status: UserStatus.ACTIVE,
    });

    return { id: created._id.toString(), email };
  }

  async function tokenFor(role: Role): Promise<string> {
    const user = await seedUser(role);
    const res = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: user.email, password: PASSWORD });

    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  /** A rider: the login account plus the partner profile they drive on. */
  async function seedRider(
    status: PartnerStatus,
    options: { online?: boolean; available?: boolean } = {},
  ): Promise<Types.ObjectId> {
    const n = String(++counter).padStart(4, '0');
    const user = await users.create({
      name: `Rider ${n}`,
      email: `rider${n}@test.invalid`,
      phone: uniquePhone(),
      passwordHash: await passwords.hash(PASSWORD),
      role: Role.DELIVERY,
      status: UserStatus.ACTIVE,
    });

    const partner = await partners.create({
      userId: user._id,
      vendorId: null,
      vehicleType: VehicleType.SCOOTER,
      isOnline: options.online ?? true,
      isAvailable: options.available ?? true,
      // Near the seeded vendor, so $geoNear has something to find.
      currentLocation: { type: 'Point', coordinates: [77.6101, 12.9352] },
      locationAt: new Date(),
      status,
    });

    return partner._id;
  }

  async function seedOrder(
    status: OrderStatus,
    options: {
      placedMinutesAgo?: number;
      riderId?: Types.ObjectId | null;
    } = {},
  ): Promise<string> {
    const placedAt = new Date(
      Date.now() - (options.placedMinutesAgo ?? 20) * 60_000,
    );
    const n = String(++counter).padStart(4, '0');

    const created = await orders.create({
      orderNo: `MND-TEST-${n}`,
      customerId,
      vendorId,
      deliveryPartnerId: options.riderId ?? null,
      items: [
        {
          productId: new Types.ObjectId(),
          name: 'Tomatoes',
          image: null,
          unit: '1kg',
          price: 4900,
          qty: 2,
          lineTotal: 9800,
          fulfilled: true,
        },
      ],
      pricing: {
        itemsSubtotal: 9800,
        discount: 0,
        deliveryFee: 2900,
        taxes: 490,
        grandTotal: 13190,
        commissionPct: 12,
        commissionAmount: 1176,
        vendorPayout: 8624,
      },
      address: {
        label: 'Home',
        line1: '12 Test Cross',
        line2: null,
        city: 'Bengaluru',
        pincode: '560034',
        location: { type: 'Point', coordinates: [77.6201, 12.9302] },
        phone: '9800000000',
      },
      payment: {
        method: PaymentMethod.ONLINE,
        status: PaymentStatus.PAID,
        provider: 'razorpay',
        refundedAmount: 0,
      },
      status,
      statusHistory: [
        {
          from: null,
          to: OrderStatus.PLACED,
          byUserId: null,
          byRole: Role.CUSTOMER,
          reason: null,
          at: placedAt,
        },
        {
          from: OrderStatus.PLACED,
          to: status,
          byUserId: null,
          byRole: Role.VENDOR,
          reason: null,
          at: new Date(placedAt.getTime() + 60_000),
        },
      ],
      placedAt,
      readyAt:
        status === OrderStatus.READY_FOR_PICKUP
          ? new Date(placedAt.getTime() + 60_000)
          : null,
      deliveredAt:
        status === OrderStatus.DELIVERED
          ? new Date(placedAt.getTime() + 60_000)
          : null,
    });

    return created._id.toString();
  }

  const authed = (method: Verb, path: string, token: string) =>
    request(server)
      [method](path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;

    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
    partners = ctx.app.get<Model<DeliveryPartnerDocument>>(
      getModelToken(DeliveryPartner.name),
    );
    orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
    products = ctx.app.get<Model<ProductDocument>>(getModelToken(Product.name));
    categories = ctx.app.get<Model<CategoryDocument>>(
      getModelToken(Category.name),
    );
    inventory = ctx.app.get<Model<InventoryDocument>>(
      getModelToken(Inventory.name),
    );
    issues = ctx.app.get<Model<IssueDocument>>(getModelToken(Issue.name));
    passwords = ctx.app.get(PasswordService);

    adminToken = await tokenFor(Role.ADMIN);
    customerToken = await tokenFor(Role.CUSTOMER);

    // ── The world the console reads ────────────────────────────────
    const owner = await seedUser(Role.VENDOR);
    const vendor = await vendors.create({
      ownerId: new Types.ObjectId(owner.id),
      storeName: 'Ops Test Stores',
      slug: 'ops-test-stores',
      address: {
        line1: '1 Market Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
      },
      location: { type: 'Point', coordinates: [77.6101, 12.9352] },
      serviceRadiusKm: 5,
      commissionPct: 12,
      status: VendorStatus.APPROVED,
    });
    vendorId = vendor._id;

    const pendingOwner = await seedUser(Role.VENDOR);
    const pendingVendor = await vendors.create({
      ownerId: new Types.ObjectId(pendingOwner.id),
      storeName: 'Awaiting Approval Stores',
      slug: 'awaiting-approval-stores',
      address: {
        line1: '9 New Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      location: { type: 'Point', coordinates: [77.6, 12.93] },
      serviceRadiusKm: 5,
      commissionPct: 15,
      status: VendorStatus.PENDING,
    });
    pendingVendorId = pendingVendor._id;

    const customer = await seedUser(Role.CUSTOMER);
    customerId = new Types.ObjectId(customer.id);

    freeRiderId = await seedRider(PartnerStatus.ACTIVE);
    busyRiderId = await seedRider(PartnerStatus.ACTIVE, { available: false });
    pendingRiderId = await seedRider(PartnerStatus.PENDING, { online: false });

    readyOrderId = await seedOrder(OrderStatus.READY_FOR_PICKUP, {
      placedMinutesAgo: 40,
    });
    deliveredOrderId = await seedOrder(OrderStatus.DELIVERED, {
      placedMinutesAgo: 200,
    });
    // The busy rider genuinely holds an in-flight order, which is what
    // makes the 409 below a real conflict rather than a flag we set.
    const busyOrderId = await seedOrder(OrderStatus.OUT_FOR_DELIVERY, {
      placedMinutesAgo: 30,
      riderId: busyRiderId,
    });
    await partners
      .updateOne(
        { _id: busyRiderId },
        { $set: { activeOrderId: new Types.ObjectId(busyOrderId) } },
      )
      .exec();

    // Catalogue + a low-stock row for the stock alerts.
    const category = await categories.create({
      vendorId: null,
      name: 'Vegetables',
      slug: 'vegetables-ops-test',
      aisleKey: AisleKey.VEGETABLES,
      sortOrder: 1,
    });
    const product = await products.create({
      vendorId,
      categoryId: category._id,
      name: 'Tomatoes',
      slug: 'tomatoes-ops-test',
      unit: ProductUnit.KG,
      unitValue: 1,
      sku: 'OPS-0001',
      mrp: 5900,
      price: 4900,
    });
    await inventory.create({
      vendorId,
      productId: product._id,
      stock: 0,
      reserved: 0,
      lowStockThreshold: 10,
    });

    const issue = await issues.create({
      code: 'ISS-20260101-0001',
      type: IssueType.LATE,
      priority: IssuePriority.HIGH,
      priorityRank: 2,
      status: IssueStatus.OPEN,
      subject: 'Seeded ops test issue',
      description: 'Raised by the integration suite.',
    });
    openIssueId = issue._id.toString();

    opsRoutes = enumerateOpsRoutes(
      ctx.app.get(DiscoveryService),
      ctx.app.get(Reflector),
      readyOrderId,
    );
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  The route inventory
  // ══════════════════════════════════════════════════════════════════

  it('discovers the ops surface (guards the test itself)', () => {
    // Without this, every sweep below would pass vacuously.
    expect(opsRoutes.length).toBeGreaterThanOrEqual(13);

    expect(opsRoutes.map((r) => `${r.method} ${r.template}`)).toEqual(
      expect.arrayContaining([
        'get /admin/ops/summary',
        'get /admin/ops/board',
        'get /admin/ops/stuck',
        'get /admin/ops/approvals',
        'post /admin/ops/approvals/vendors/:id',
        'post /admin/ops/approvals/riders/:id',
        'get /admin/ops/dispatch',
        'post /admin/ops/dispatch/assign',
        'post /admin/ops/dispatch/unassign',
        'get /admin/ops/issues',
        'get /admin/ops/issues/:id',
        'post /admin/ops/issues',
        'patch /admin/ops/issues/:id',
        'post /admin/ops/issues/:id/messages',
        'get /admin/ops/stock-alerts',
        'get /admin/ops/stock-alerts/summary',
      ]),
    );
  });

  it('marks no ops route @Public() and declares a role on every one', () => {
    const leaked = opsRoutes.filter((route) => route.isPublic);
    expect(leaked.map((route) => route.template)).toEqual([]);

    const unroled = opsRoutes.filter((route) => route.roles.length === 0);
    expect(unroled.map((route) => route.template)).toEqual([]);

    // ADMIN is the LOWEST role permitted; SUPER_ADMIN inherits it. None
    // of this moves money or grants privilege, so none of it is
    // SUPER_ADMIN-only — locking operations behind the finance role is
    // how an ops team ends up sharing one login.
    for (const route of opsRoutes) {
      expect([route.template, route.roles]).toEqual([
        route.template,
        [Role.ADMIN],
      ]);
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  1. Anonymous and 2. CUSTOMER
  // ══════════════════════════════════════════════════════════════════

  it('rejects every /admin/ops route with 401 when no token is presented', async () => {
    for (const route of opsRoutes) {
      const res = await request(server)
        [route.method](route.path)
        .set('X-Forwarded-For', nextIp())
        .send({});

      if (res.status !== 401) {
        throw new Error(
          `\n\nUNPROTECTED OPS ROUTE: ${route.method.toUpperCase()} ${route.template} ` +
            `(${route.controller}.${route.handler}) returned ${res.status} ` +
            'to an anonymous request; expected 401.\n',
        );
      }
      expect(res.status).toBe(401);
    }
  }, 120_000);

  it('rejects every /admin/ops route with 403 for a CUSTOMER token', async () => {
    for (const route of opsRoutes) {
      const res = await authed(route.method, route.path, customerToken).send({});

      if (res.status !== 403) {
        throw new Error(
          `\n\nROLE LEAK: ${route.method.toUpperCase()} ${route.template} ` +
            `(${route.controller}.${route.handler}) returned ${res.status} ` +
            'to a CUSTOMER token; expected 403.\n' +
            'The ops surface spans every live order, every rider location ' +
            'and the whole support queue.\n',
        );
      }
      expect(res.status).toBe(403);
    }
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  //  3. ADMIN reads
  // ══════════════════════════════════════════════════════════════════

  it('lets an ADMIN token through every ops read', async () => {
    for (const path of [
      '/admin/ops/summary',
      '/admin/ops/board',
      '/admin/ops/stuck',
      '/admin/ops/approvals',
      '/admin/ops/dispatch',
      '/admin/ops/issues',
      '/admin/ops/stock-alerts',
      '/admin/ops/stock-alerts/summary',
    ]) {
      const res = await authed('get', path, adminToken);
      expect([path, res.status]).toEqual([path, 200]);
    }
  }, 120_000);

  describe('GET /admin/ops/summary', () => {
    it('returns the full landing shape with the seeded work on it', async () => {
      const res = await authed('get', '/admin/ops/summary', adminToken);
      expect(res.status).toBe(200);

      expect(res.body.liveOrders.byStatus).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: OrderStatus.READY_FOR_PICKUP }),
        ]),
      );
      expect(res.body.liveOrders.total).toBeGreaterThanOrEqual(2);

      expect(res.body.needsAction.pendingVendors).toBeGreaterThanOrEqual(1);
      expect(res.body.needsAction.pendingRiders).toBeGreaterThanOrEqual(1);
      expect(res.body.needsAction.unassignedOrders).toBeGreaterThanOrEqual(1);
      // READY_FOR_PICKUP for ~39 minutes, unassigned: past the 15-minute
      // ceiling and past the 10-minute grace.
      expect(res.body.needsAction.stuckOrders).toBeGreaterThanOrEqual(1);
      expect(res.body.needsAction.openIssues).toBeGreaterThanOrEqual(1);
      expect(res.body.needsAction.outOfStockItems).toBeGreaterThanOrEqual(1);

      expect(res.body.dispatch.ridersOnline).toBeGreaterThanOrEqual(2);
      expect(res.body.dispatch.ridersOnDelivery).toBeGreaterThanOrEqual(1);

      // Nothing has been averaged yet, and null is the honest answer —
      // never 0, which reads as "instant".
      expect(
        res.body.dispatch.avgAssignMinutes === null ||
          typeof res.body.dispatch.avgAssignMinutes === 'number',
      ).toBe(true);
      expect(typeof res.body.today.ordersPlaced).toBe('number');
    });
  });

  describe('GET /admin/ops/board', () => {
    it('returns five lanes, capped rather than paginated', async () => {
      const res = await authed('get', '/admin/ops/board', adminToken);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      expect(res.body.map((lane: { lane: string }) => lane.lane)).toEqual([
        'new',
        'preparing',
        'ready',
        'assigned',
        'in_transit',
      ]);

      const ready = res.body.find(
        (lane: { lane: string }) => lane.lane === 'ready',
      );
      expect(ready.total).toBeGreaterThanOrEqual(1);
      expect(ready.truncated).toBe(false);

      const card = ready.orders[0];
      expect(card).toMatchObject({
        orderNo: expect.any(String),
        status: OrderStatus.READY_FOR_PICKUP,
        vendorName: 'Ops Test Stores',
        itemCount: 1,
        grandTotal: 13190,
      });
      expect(card.sla.targetMinutes).toBe(30);
      // Placed 40 minutes ago against a 30-minute promise.
      expect(card.sla.state).toBe('breached');
      expect(card.minutesInStatus).toBeGreaterThanOrEqual(30);
    });

    it('filters by vendorId without leaking another vendor', async () => {
      const res = await authed(
        'get',
        `/admin/ops/board?vendorId=${new Types.ObjectId().toString()}`,
        adminToken,
      );
      expect(res.status).toBe(200);
      for (const lane of res.body) {
        expect(lane.total).toBe(0);
        expect(lane.orders).toEqual([]);
      }
    });
  });

  describe('GET /admin/ops/stuck', () => {
    it('explains each row and paginates', async () => {
      const res = await authed('get', '/admin/ops/stuck', adminToken);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      const row = res.body.data[0];
      expect(typeof row.reason).toBe('string');
      expect(typeof row.suggestedAction).toBe('string');
      expect(row.stuckSinceMinutes).toBeGreaterThanOrEqual(0);
      // The card is still a card — one component renders it everywhere.
      expect(row.orderNo).toEqual(expect.any(String));
      expect(row.sla).toBeDefined();
    });
  });

  describe('GET /admin/ops/dispatch', () => {
    it('lists the unassigned queue with nearest riders, and the fleet', async () => {
      const res = await authed('get', '/admin/ops/dispatch', adminToken);
      expect(res.status).toBe(200);

      expect(res.body.unassigned.length).toBeGreaterThanOrEqual(1);
      const waiting = res.body.unassigned[0];
      expect(waiting.waitingMinutes).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(waiting.nearestRiders)).toBe(true);
      // The riders sit on the store's doorstep, so the 2dsphere search
      // inside the 5 km radius must find them.
      expect(waiting.nearestRiders.length).toBeGreaterThanOrEqual(1);
      expect(waiting.nearestRiders[0]).toMatchObject({
        id: expect.any(String),
        distanceKm: expect.any(Number),
        isAvailable: expect.any(Boolean),
      });
      expect(waiting.nearestRiders.length).toBeLessThanOrEqual(5);

      const busy = res.body.riders.find(
        (rider: { id: string }) => rider.id === busyRiderId.toString(),
      );
      expect(busy.activeOrderNo).toEqual(expect.any(String));
      expect(busy.minutesOnCurrentJob).toBeGreaterThanOrEqual(0);
      expect(typeof busy.distanceToDropKm).toBe('number');
    });
  });

  describe('GET /admin/ops/stock-alerts', () => {
    it('reports the out-of-stock line first and summarises it', async () => {
      const list = await authed('get', '/admin/ops/stock-alerts', adminToken);
      expect(list.status).toBe(200);
      expect(list.body.data[0]).toMatchObject({
        name: 'Tomatoes',
        sku: 'OPS-0001',
        stock: 0,
        lowStockThreshold: 10,
        severity: 'out',
        vendorName: 'Ops Test Stores',
        aisleKey: AisleKey.VEGETABLES,
      });
      expect(list.body.data[0].unitsSold30d).toEqual(expect.any(Number));

      const summary = await authed(
        'get',
        '/admin/ops/stock-alerts/summary',
        adminToken,
      );
      expect(summary.status).toBe(200);
      expect(summary.body.out).toBeGreaterThanOrEqual(1);
      expect(summary.body.byVendor.length).toBeGreaterThanOrEqual(1);
      expect(summary.body.byAisle).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ aisleKey: AisleKey.VEGETABLES }),
        ]),
      );
    });

    it('honours the severity filter', async () => {
      const res = await authed(
        'get',
        '/admin/ops/stock-alerts?severity=low',
        adminToken,
      );
      expect(res.status).toBe(200);
      for (const row of res.body.data) expect(row.severity).toBe('low');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  4. Dispatch — the state machine is the authority
  // ══════════════════════════════════════════════════════════════════

  describe('POST /admin/ops/dispatch/assign', () => {
    it('rejects a transition that is not on the state machine with 409', async () => {
      // DELIVERED is terminal. An admin override that could put a rider
      // back on a completed delivery would let support reopen money that
      // has already moved.
      const res = await authed(
        'post',
        '/admin/ops/dispatch/assign',
        adminToken,
      ).send({ orderId: deliveredOrderId, riderId: freeRiderId.toString() });

      expect(res.status).toBe(409);

      const after = await orders.findById(deliveredOrderId).lean().exec();
      expect(after?.status).toBe(OrderStatus.DELIVERED);
      expect(after?.deliveryPartnerId).toBeNull();
    });

    it('rejects a rider who is already carrying an order with 409', async () => {
      const res = await authed(
        'post',
        '/admin/ops/dispatch/assign',
        adminToken,
      ).send({ orderId: readyOrderId, riderId: busyRiderId.toString() });

      expect(res.status).toBe(409);

      // Nothing moved: the order is still waiting and the rider still
      // holds only their original job.
      const order = await orders.findById(readyOrderId).lean().exec();
      expect(order?.status).toBe(OrderStatus.READY_FOR_PICKUP);
      expect(order?.deliveryPartnerId).toBeNull();
    });

    it('404s on an unknown order and an unknown rider', async () => {
      const unknown = new Types.ObjectId().toString();

      const noOrder = await authed(
        'post',
        '/admin/ops/dispatch/assign',
        adminToken,
      ).send({ orderId: unknown, riderId: freeRiderId.toString() });
      expect(noOrder.status).toBe(404);

      const noRider = await authed(
        'post',
        '/admin/ops/dispatch/assign',
        adminToken,
      ).send({ orderId: readyOrderId, riderId: unknown });
      expect(noRider.status).toBe(404);
    });

    it('assigns a free rider and holds them, in one transaction', async () => {
      const res = await authed(
        'post',
        '/admin/ops/dispatch/assign',
        adminToken,
      ).send({
        orderId: readyOrderId,
        riderId: freeRiderId.toString(),
        reason: 'Closest rider on shift',
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.ASSIGNED);
      expect(res.body.riderId).toBe(freeRiderId.toString());
      expect(res.body.riderName).toEqual(expect.any(String));

      const order = await orders.findById(readyOrderId).lean().exec();
      expect(order?.status).toBe(OrderStatus.ASSIGNED);
      expect(order?.deliveryPartnerId?.toString()).toBe(
        freeRiderId.toString(),
      );
      // Both halves landed, or neither should have.
      const rider = await partners.findById(freeRiderId).lean().exec();
      expect(rider?.activeOrderId?.toString()).toBe(readyOrderId);
      expect(rider?.isAvailable).toBe(false);

      const last = order?.statusHistory.at(-1);
      expect(last?.to).toBe(OrderStatus.ASSIGNED);
      expect(last?.reason).toBe('Closest rider on shift');
    });

    it('then refuses to double-assign the same rider', async () => {
      const second = await seedOrder(OrderStatus.READY_FOR_PICKUP, {
        placedMinutesAgo: 5,
      });

      const res = await authed(
        'post',
        '/admin/ops/dispatch/assign',
        adminToken,
      ).send({ orderId: second, riderId: freeRiderId.toString() });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /admin/ops/dispatch/unassign', () => {
    it('demands a reason', async () => {
      const res = await authed(
        'post',
        '/admin/ops/dispatch/unassign',
        adminToken,
      ).send({ orderId: readyOrderId });

      expect(res.status).toBe(400);
    });

    it('returns the order to the pool and frees the rider', async () => {
      const res = await authed(
        'post',
        '/admin/ops/dispatch/unassign',
        adminToken,
      ).send({ orderId: readyOrderId, reason: 'Rider went off shift' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(OrderStatus.READY_FOR_PICKUP);
      expect(res.body.riderId).toBeNull();

      const rider = await partners.findById(freeRiderId).lean().exec();
      expect(rider?.activeOrderId).toBeNull();
      expect(rider?.isAvailable).toBe(true);
    });

    it('409s on an order that has already been picked up', async () => {
      const gone = await seedOrder(OrderStatus.OUT_FOR_DELIVERY, {
        placedMinutesAgo: 15,
        riderId: freeRiderId,
      });

      const res = await authed(
        'post',
        '/admin/ops/dispatch/unassign',
        adminToken,
      ).send({ orderId: gone, reason: 'Too late to recall' });

      expect(res.status).toBe(409);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  5. Issues
  // ══════════════════════════════════════════════════════════════════

  describe('PATCH /admin/ops/issues/:id', () => {
    it('refuses to resolve an issue with no resolution', async () => {
      const res = await authed(
        'patch',
        `/admin/ops/issues/${openIssueId}`,
        adminToken,
      ).send({ status: IssueStatus.RESOLVED });

      expect(res.status).toBe(400);

      const after = await issues.findById(openIssueId).lean().exec();
      expect(after?.status).toBe(IssueStatus.OPEN);
      expect(after?.resolvedAt).toBeNull();
    });

    it('resolves when a resolution is supplied, and stamps who did it', async () => {
      const res = await authed(
        'patch',
        `/admin/ops/issues/${openIssueId}`,
        adminToken,
      ).send({
        status: IssueStatus.RESOLVED,
        resolution: 'Refunded the delivery fee and apologised.',
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(IssueStatus.RESOLVED);
      expect(res.body.resolution).toBe(
        'Refunded the delivery fee and apologised.',
      );
      expect(res.body.resolvedAt).toEqual(expect.any(String));
      expect(res.body.resolvedBy).toEqual(expect.any(String));
    });
  });

  describe('POST /admin/ops/issues', () => {
    it('allocates a human code and returns the detail shape', async () => {
      const res = await authed('post', '/admin/ops/issues', adminToken).send({
        type: IssueType.MISSING_ITEM,
        priority: IssuePriority.URGENT,
        subject: 'Two lines missing',
        description: 'Customer received four of six lines.',
        orderId: readyOrderId,
      });

      expect(res.status).toBe(201);
      expect(res.body.code).toMatch(/^ISS-\d{8}-\d{4}$/);
      expect(res.body.status).toBe(IssueStatus.OPEN);
      expect(res.body.order.orderNo).toEqual(expect.any(String));
      expect(res.body.messages).toEqual([]);
    });

    it('never issues the same code twice', async () => {
      const codes = new Set<string>();
      for (let n = 0; n < 3; n += 1) {
        const res = await authed('post', '/admin/ops/issues', adminToken).send({
          type: IssueType.OTHER,
          subject: `Sequential ticket ${n}`,
          description: 'Checking the per-day sequence.',
        });
        expect(res.status).toBe(201);
        codes.add(res.body.code as string);
      }
      expect(codes.size).toBe(3);
    });
  });

  describe('POST /admin/ops/issues/:id/messages', () => {
    it('appends to the thread and picks the ticket up', async () => {
      const created = await authed(
        'post',
        '/admin/ops/issues',
        adminToken,
      ).send({
        type: IssueType.DAMAGED,
        subject: 'Thread test',
        description: 'A ticket to reply on.',
      });
      const id = created.body.id as string;

      const res = await authed(
        'post',
        `/admin/ops/issues/${id}/messages`,
        adminToken,
      ).send({ body: 'Called the store, awaiting the packing photo.' });

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(1);
      expect(res.body.messages[0].byRole).toBe(Role.ADMIN);
      // A reply IS the moment somebody picked it up.
      expect(res.body.status).toBe(IssueStatus.IN_PROGRESS);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  6. Approvals
  // ══════════════════════════════════════════════════════════════════

  describe('/admin/ops/approvals', () => {
    it('lists only what is actually pending', async () => {
      const res = await authed('get', '/admin/ops/approvals', adminToken);
      expect(res.status).toBe(200);

      expect(res.body.counts.vendors).toBeGreaterThanOrEqual(1);
      expect(res.body.counts.riders).toBeGreaterThanOrEqual(1);
      for (const vendor of res.body.vendors) {
        expect(vendor.status).toBe(VendorStatus.PENDING);
      }
      for (const rider of res.body.riders) {
        expect(rider.status).toBe(PartnerStatus.PENDING);
      }
    });

    it('refuses to reject a vendor without a reason', async () => {
      const res = await authed(
        'post',
        `/admin/ops/approvals/vendors/${pendingVendorId.toString()}`,
        adminToken,
      ).send({ decision: 'reject' });

      expect(res.status).toBe(400);

      const after = await vendors.findById(pendingVendorId).lean().exec();
      expect(after?.status).toBe(VendorStatus.PENDING);
    });

    it('refuses to reject a rider without a reason', async () => {
      const res = await authed(
        'post',
        `/admin/ops/approvals/riders/${pendingRiderId.toString()}`,
        adminToken,
      ).send({ decision: 'reject' });

      expect(res.status).toBe(400);

      const after = await partners.findById(pendingRiderId).lean().exec();
      expect(after?.status).toBe(PartnerStatus.PENDING);
    });

    it('rejects a garbled decision outright', async () => {
      // `decision` is a closed set and the global ValidationPipe runs
      // with forbidNonWhitelisted, so neither a bad value nor a smuggled
      // `status` field gets through.
      const bad = await authed(
        'post',
        `/admin/ops/approvals/vendors/${pendingVendorId.toString()}`,
        adminToken,
      ).send({ decision: 'maybe' });
      expect(bad.status).toBe(400);

      const smuggled = await authed(
        'post',
        `/admin/ops/approvals/vendors/${pendingVendorId.toString()}`,
        adminToken,
      ).send({ decision: 'approve', status: VendorStatus.SUSPENDED });
      expect(smuggled.status).toBe(400);
    });

    it('approves a vendor through the existing status logic', async () => {
      const res = await authed(
        'post',
        `/admin/ops/approvals/vendors/${pendingVendorId.toString()}`,
        adminToken,
      ).send({ decision: 'approve' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(VendorStatus.APPROVED);

      const after = await vendors.findById(pendingVendorId).lean().exec();
      expect(after?.status).toBe(VendorStatus.APPROVED);
      expect(after?.isOpen).toBe(true);
    });

    it('approves a rider and moves their login account in step', async () => {
      const partner = await partners.findById(pendingRiderId).lean().exec();

      const res = await authed(
        'post',
        `/admin/ops/approvals/riders/${pendingRiderId.toString()}`,
        adminToken,
      ).send({ decision: 'approve' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(PartnerStatus.ACTIVE);

      // The delegation is the point: a rider whose partner record is
      // active but whose User is still PENDING cannot log in.
      const account = await users.findById(partner?.userId).lean().exec();
      expect(account?.status).toBe(UserStatus.ACTIVE);
    });

    it('rejects a vendor WITH a reason, and records it', async () => {
      const owner = await seedUser(Role.VENDOR);
      const doomed = await vendors.create({
        ownerId: new Types.ObjectId(owner.id),
        storeName: 'Unverified Stores',
        slug: 'unverified-stores',
        address: {
          line1: '3 Back Lane',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560002',
        },
        location: { type: 'Point', coordinates: [77.59, 12.92] },
        serviceRadiusKm: 5,
        commissionPct: 10,
        status: VendorStatus.PENDING,
      });

      const res = await authed(
        'post',
        `/admin/ops/approvals/vendors/${doomed._id.toString()}`,
        adminToken,
      ).send({ decision: 'reject', reason: 'FSSAI licence could not be verified' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(VendorStatus.SUSPENDED);
      expect(res.body.statusReason).toBe(
        'FSSAI licence could not be verified',
      );

      const after = await vendors.findById(doomed._id).lean().exec();
      // A store that was never approved must not be taking orders.
      expect(after?.isOpen).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  7. Every mutation lands an audit row
  // ══════════════════════════════════════════════════════════════════

  it('writes an audit entry for the dispatch and issue mutations', async () => {
    const res = await authed(
      'get',
      '/admin/audit-logs?limit=100',
      adminToken,
    );
    expect(res.status).toBe(200);

    const actions = new Set(
      (res.body.data as { action: string }[]).map((row) => row.action),
    );

    // Both the precise, service-written entries and the interceptor's
    // safety net land in the same collection; what matters is that no
    // mutation above passed through leaving nothing behind.
    expect(actions.has('ops.dispatch.assign')).toBe(true);
    expect(actions.has('ops.dispatch.unassign')).toBe(true);
    expect(actions.has('ops.issue.create')).toBe(true);
    expect(actions.has('ops.issue.update')).toBe(true);
    expect(actions.has('ops.issue.message')).toBe(true);
  }, 60_000);
});
