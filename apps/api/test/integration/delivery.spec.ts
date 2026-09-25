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
import { point } from '../../src/database/schemas/geo-point';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { AssignmentService } from '../../src/modules/delivery/assignment.service';
import { MAX_OTP_ATTEMPTS } from '../../src/modules/delivery/delivery.constants';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/** Generated per run, never a literal. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** The store is here; both riders are within its 5 km radius. */
const STORE = { lat: 12.9716, lng: 77.5946 };
const CUSTOMER_DROP = { lat: 12.9784, lng: 77.6408 };

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
function enumerateDeliveryRoutes(
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
    if (!`/${controllerPath}`.startsWith('/delivery')) continue;

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
 *  THE RIDER API
 * ════════════════════════════════════════════════════════════════════════
 *
 * Asserted against a real replica set, because every property below is a
 * property of the data rather than of the code reading it.
 *
 *   • Authorisation — a CUSTOMER token reaches nothing under `/delivery`,
 *     on every discovered route rather than a sample.
 *   • Isolation — a rider addressing another rider's order gets 404, not
 *     403: a 403 would confirm the order exists and turn the endpoint
 *     into an enumeration oracle.
 *   • The OTP — wrong codes decrement, the fifth LOCKS the delivery, and
 *     the code never appears in a response.
 *   • Location — refused outright unless something is OUT_FOR_DELIVERY.
 *   • The state machine — an impossible transition is 409.
 *
 * Plus the full journey: offer → accept → picked up → out for delivery →
 * ping → delivered, which is the only way to know the pieces compose.
 */
describe('Delivery / rider API (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let orders: Model<OrderDocument>;
  let passwords: PasswordService;
  let assignments: AssignmentService;

  let deliveryRoutes: RouteInfo[];

  let vendorId: Types.ObjectId;
  let customerId: Types.ObjectId;

  let riderOneUserId: Types.ObjectId;
  let riderOnePartnerId: Types.ObjectId;
  let riderTwoPartnerId: Types.ObjectId;

  let riderOneToken: string;
  let riderTwoToken: string;
  let customerToken: string;

  let counter = 0;

  async function seedUser(
    role: Role,
    options: { vendorId?: Types.ObjectId | null } = {},
  ): Promise<UserDocument> {
    const n = String(++counter).padStart(4, '0');
    return users.create({
      name: `Delivery ${role} ${n}`,
      email: `delivery${n}@test.invalid`,
      phone: `98${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role,
      status: UserStatus.ACTIVE,
      vendorId: options.vendorId ?? null,
    });
  }

  async function tokenFor(user: UserDocument): Promise<string> {
    const res = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: user.email, password: PASSWORD });

    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  /** An order in whatever state the test needs, priced in integer paise. */
  async function createOrder(options: {
    status: OrderStatus;
    partnerId?: Types.ObjectId | null;
    otp?: string;
  }): Promise<OrderDocument> {
    const n = String(++counter).padStart(4, '0');

    return orders.create({
      orderNo: `MND-20260925-${n}`,
      customerId,
      vendorId,
      deliveryPartnerId: options.partnerId ?? null,
      items: [
        {
          productId: new Types.ObjectId(),
          name: 'Tomatoes',
          unit: '1 kg',
          price: 4_000,
          qty: 2,
          lineTotal: 8_000,
        },
      ],
      pricing: {
        itemsSubtotal: 8_000,
        discount: 0,
        deliveryFee: 2_900,
        taxes: 0,
        grandTotal: 10_900,
        commissionPct: 12,
        commissionAmount: 960,
        vendorPayout: 7_040,
      },
      address: {
        label: 'Home',
        line1: '12 Residency Road',
        city: 'Bengaluru',
        pincode: '560025',
        location: point(CUSTOMER_DROP.lng, CUSTOMER_DROP.lat),
        phone: '9000012345',
      },
      payment: {
        method: PaymentMethod.COD,
        status: PaymentStatus.PENDING,
      },
      status: options.status,
      statusHistory: [],
      deliveryOtpHash: options.otp ? await passwords.hash(options.otp) : null,
      placedAt: new Date(),
      readyAt: new Date(),
    });
  }

  /**
   * Both riders free, online, available and back where they started.
   *
   * The location reset matters: a delivery moves a rider, and the next
   * test's `$geoNear` would otherwise pick a different winner depending
   * on which tests ran before it.
   */
  async function resetRiders(): Promise<void> {
    const common = {
      isOnline: true,
      isAvailable: true,
      activeOrderId: null,
      status: PartnerStatus.ACTIVE,
    };

    await partners
      .updateOne(
        { _id: riderOnePartnerId },
        { $set: { ...common, currentLocation: point(STORE.lng, STORE.lat) } },
      )
      .exec();

    await partners
      .updateOne(
        { _id: riderTwoPartnerId },
        {
          $set: {
            ...common,
            currentLocation: point(STORE.lng + 0.01, STORE.lat + 0.01),
          },
        },
      )
      .exec();
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;

    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
    partners = ctx.app.get<Model<DeliveryPartnerDocument>>(
      getModelToken(DeliveryPartner.name),
    );
    orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
    passwords = ctx.app.get(PasswordService);
    assignments = ctx.app.get(AssignmentService);

    deliveryRoutes = enumerateDeliveryRoutes(
      ctx.app.get(DiscoveryService),
      ctx.app.get(Reflector),
      new Types.ObjectId().toString(),
    );

    const owner = await seedUser(Role.VENDOR);
    const vendor = await vendors.create({
      ownerId: owner._id,
      storeName: 'Ramesh Fresh',
      slug: `ramesh-fresh-${Date.now()}`,
      address: {
        line1: '4 Church Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      location: point(STORE.lng, STORE.lat),
      serviceRadiusKm: 5,
      commissionPct: 12,
      status: VendorStatus.APPROVED,
    });
    vendorId = vendor._id;

    const customer = await seedUser(Role.CUSTOMER);
    customerId = customer._id;
    customerToken = await tokenFor(customer);

    // A DELIVERY user carries a vendorId: `VendorScopeGuard` rejects a
    // delivery token without one outright, which is the platform's
    // tenant model, not a choice this module makes.
    const riderOne = await seedUser(Role.DELIVERY, { vendorId });
    riderOneUserId = riderOne._id;
    riderOneToken = await tokenFor(riderOne);

    const riderTwo = await seedUser(Role.DELIVERY, { vendorId });
    riderTwoToken = await tokenFor(riderTwo);

    // Rider one is at the shop door, rider two a few hundred metres
    // away — so `$geoNear` has a deterministic winner.
    const partnerOne = await partners.create({
      userId: riderOne._id,
      vendorId,
      vehicleType: VehicleType.SCOOTER,
      isOnline: true,
      isAvailable: true,
      currentLocation: point(STORE.lng, STORE.lat),
      locationAt: new Date(),
      status: PartnerStatus.ACTIVE,
    });
    riderOnePartnerId = partnerOne._id;

    const partnerTwo = await partners.create({
      userId: riderTwo._id,
      // The shared platform pool: `vendorId: null` on the PARTNER, which
      // is a different thing from the user's tenant scope.
      vendorId: null,
      vehicleType: VehicleType.MOTORCYCLE,
      isOnline: true,
      isAvailable: true,
      currentLocation: point(STORE.lng + 0.01, STORE.lat + 0.01),
      locationAt: new Date(),
      status: PartnerStatus.ACTIVE,
    });
    riderTwoPartnerId = partnerTwo._id;
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  beforeEach(async () => {
    await resetRiders();
  });

  const as = (token: string, method: Verb, path: string) =>
    request(server)
      [method](path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);

  // ══════════════════════════════════════════════════════════════════
  //  1. The route inventory
  // ══════════════════════════════════════════════════════════════════

  it('discovers the rider surface (guards the test itself)', () => {
    // Without this, every assertion below could pass vacuously.
    expect(deliveryRoutes.length).toBeGreaterThanOrEqual(12);
    expect(
      deliveryRoutes.map((route) => `${route.method} ${route.template}`),
    ).toEqual(
      expect.arrayContaining([
        'get /delivery/me',
        'patch /delivery/availability',
        'get /delivery/offers',
        'post /delivery/offers/:id/accept',
        'post /delivery/offers/:id/reject',
        'get /delivery/orders/active',
        'patch /delivery/orders/:id/picked-up',
        'patch /delivery/orders/:id/out-for-delivery',
        'post /delivery/orders/:id/deliver',
        'post /delivery/orders/:id/failed',
        'post /delivery/location',
        'get /delivery/history',
        'get /delivery/earnings',
      ]),
    );
  });

  it('marks no rider route @Public() and declares a role on every one', () => {
    const leaked = deliveryRoutes.filter((route) => route.isPublic);
    expect(leaked.map((route) => route.template)).toEqual([]);

    const unroled = deliveryRoutes.filter(
      (route) => !route.roles.includes(Role.DELIVERY),
    );
    expect(unroled.map((route) => route.template)).toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════
  //  2. Authorisation
  // ══════════════════════════════════════════════════════════════════

  it('rejects every /delivery route with 401 when no token is presented', async () => {
    for (const route of deliveryRoutes) {
      const res = await request(server)
        [route.method](route.path)
        .set('X-Forwarded-For', nextIp())
        .send({});

      expect([route.template, res.status]).toEqual([route.template, 401]);
    }
  }, 60_000);

  it('rejects every /delivery route with 403 for a CUSTOMER token', async () => {
    for (const route of deliveryRoutes) {
      const res = await as(customerToken, route.method, route.path).send({});

      if (res.status !== 403) {
        throw new Error(
          `\n\nROLE LEAK: ${route.method.toUpperCase()} ${route.template} ` +
            `returned ${res.status} to a CUSTOMER token; expected 403.\n` +
            "A customer must never reach the rider surface — it carries other " +
            "people's addresses, phone numbers and delivery codes.\n",
        );
      }
      expect(res.status).toBe(403);
    }
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  3. The journey
  // ══════════════════════════════════════════════════════════════════

  it('runs offer → accept → picked up → out for delivery → ping → delivered', async () => {
    const OTP = '4321';
    const order = await createOrder({
      status: OrderStatus.READY_FOR_PICKUP,
      otp: OTP,
    });

    // The engine, driven directly: the vendor module calls exactly this
    // when an order reaches READY_FOR_PICKUP.
    const outcome = await assignments.dispatch(order._id);
    expect(outcome.result).toBe('offered');

    // ── The offer ──
    const offers = await as(riderOneToken, 'get', '/delivery/offers');
    expect(offers.status).toBe(200);
    expect(offers.body).toHaveLength(1);
    expect(offers.body[0].orderId).toBe(order._id.toString());
    expect(offers.body[0].payoutPaise).toBeGreaterThan(0);
    expect(offers.body[0].expiresInMs).toBeGreaterThan(0);
    // COD, unpaid: the rider is told what to collect, in paise.
    expect(offers.body[0].codAmountPaise).toBe(10_900);

    // ── Accept ──
    const accepted = await as(
      riderOneToken,
      'post',
      `/delivery/offers/${offers.body[0].id}/accept`,
    ).send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe(OrderStatus.ASSIGNED);

    const afterAccept = await orders.findById(order._id).exec();
    expect(afterAccept?.deliveryPartnerId?.toString()).toBe(
      riderOnePartnerId.toString(),
    );
    // Held: the assignment engine must stop offering this rider work.
    const heldRider = await partners.findById(riderOnePartnerId).exec();
    expect(heldRider?.isAvailable).toBe(false);
    expect(heldRider?.activeOrderId?.toString()).toBe(order._id.toString());

    // ── The active order carries what the rider needs at the door ──
    const active = await as(riderOneToken, 'get', '/delivery/orders/active');
    expect(active.status).toBe(200);
    expect(active.body.customerPhone).toBe('9000012345');
    expect(active.body.drop.lat).toBeCloseTo(CUSTOMER_DROP.lat, 4);
    expect(active.body.pickup.lng).toBeCloseTo(STORE.lng, 4);
    expect(active.body.otp.attemptsRemaining).toBe(MAX_OTP_ATTEMPTS);
    // The code itself is never in a response body.
    expect(JSON.stringify(active.body)).not.toContain(OTP);

    // ── A ping before OUT_FOR_DELIVERY is refused ──
    const earlyPing = await as(riderOneToken, 'post', '/delivery/location').send(
      { lat: STORE.lat, lng: STORE.lng },
    );
    expect(earlyPing.status).toBe(400);

    // ── Picked up, then out for delivery ──
    const pickedUp = await as(
      riderOneToken,
      'patch',
      `/delivery/orders/${order._id.toString()}/picked-up`,
    ).send({});
    expect(pickedUp.status).toBe(200);
    expect(pickedUp.body.status).toBe(OrderStatus.PICKED_UP);

    const out = await as(
      riderOneToken,
      'patch',
      `/delivery/orders/${order._id.toString()}/out-for-delivery`,
    ).send({});
    expect(out.status).toBe(200);

    // ── Now the ping is accepted and moves the rider's position ──
    const ping = await as(riderOneToken, 'post', '/delivery/location').send({
      lat: 12.975,
      lng: 77.61,
      accuracy: 12,
      heading: 90,
    });
    expect(ping.status).toBe(200);
    expect(ping.body.accepted).toBe(true);
    expect(ping.body.etaMinutes).toBeGreaterThan(0);

    const moved = await partners.findById(riderOnePartnerId).exec();
    expect(moved?.currentLocation?.coordinates[0]).toBeCloseTo(77.61, 4);

    // ── Delivered, with the customer's code ──
    const delivered = await as(
      riderOneToken,
      'post',
      `/delivery/orders/${order._id.toString()}/deliver`,
    ).send({ otp: OTP });
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe(OrderStatus.DELIVERED);

    const finished = await orders.findById(order._id).exec();
    expect(finished?.status).toBe(OrderStatus.DELIVERED);
    expect(finished?.deliveredAt).toBeTruthy();
    expect(finished?.proof?.otpVerifiedAt).toBeTruthy();

    // Freed and credited in the same transaction as the delivery.
    const freed = await partners.findById(riderOnePartnerId).exec();
    expect(freed?.activeOrderId).toBeNull();
    expect(freed?.isAvailable).toBe(true);
    expect(freed?.completedCount).toBe(1);

    // And it shows up in the rider's own history and earnings.
    const history = await as(riderOneToken, 'get', '/delivery/history');
    expect(history.status).toBe(200);
    expect(history.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(history.body.data[0].payoutPaise).toBeGreaterThan(0);

    const earnings = await as(riderOneToken, 'get', '/delivery/earnings');
    expect(earnings.status).toBe(200);
    expect(earnings.body.deliveries).toBeGreaterThanOrEqual(1);
    expect(earnings.body.codCollectedPaise).toBeGreaterThanOrEqual(10_900);
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  //  4. Isolation
  // ══════════════════════════════════════════════════════════════════

  it("answers 404 — never 403 — when a rider addresses another rider's order", async () => {
    const order = await createOrder({
      status: OrderStatus.ASSIGNED,
      partnerId: riderTwoPartnerId,
    });

    for (const path of [
      `/delivery/orders/${order._id.toString()}/picked-up`,
      `/delivery/orders/${order._id.toString()}/out-for-delivery`,
    ]) {
      const res = await as(riderOneToken, 'patch', path).send({});
      // A 403 would confirm the order exists and is simply somebody
      // else's — an enumeration oracle for order ids.
      expect([path, res.status]).toEqual([path, 404]);
    }

    const deliver = await as(
      riderOneToken,
      'post',
      `/delivery/orders/${order._id.toString()}/deliver`,
    ).send({ otp: '0000' });
    expect(deliver.status).toBe(404);

    // The other rider's order was not touched.
    const untouched = await orders.findById(order._id).exec();
    expect(untouched?.status).toBe(OrderStatus.ASSIGNED);
  }, 60_000);

  it("answers 404 when a rider accepts an offer that is not theirs", async () => {
    const order = await createOrder({ status: OrderStatus.READY_FOR_PICKUP });
    // Rider one is at the door, so the offer goes to them.
    const outcome = await assignments.dispatch(order._id);
    expect(outcome.result).toBe('offered');

    const offers = await as(riderOneToken, 'get', '/delivery/offers');
    const offerId = offers.body[0].id as string;

    const stolen = await as(
      riderTwoToken,
      'post',
      `/delivery/offers/${offerId}/accept`,
    ).send({});
    expect(stolen.status).toBe(404);

    const still = await orders.findById(order._id).exec();
    expect(still?.status).toBe(OrderStatus.READY_FOR_PICKUP);
    expect(still?.deliveryPartnerId).toBeNull();
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  5. The state machine
  // ══════════════════════════════════════════════════════════════════

  it('answers 409 on a transition that is not on the state machine', async () => {
    const order = await createOrder({
      status: OrderStatus.ASSIGNED,
      partnerId: riderOnePartnerId,
      otp: '1111',
    });

    // ASSIGNED → OUT_FOR_DELIVERY skips PICKED_UP.
    const skipped = await as(
      riderOneToken,
      'patch',
      `/delivery/orders/${order._id.toString()}/out-for-delivery`,
    ).send({});
    expect(skipped.status).toBe(409);

    // ASSIGNED → DELIVERED is not on the map at all, and the OTP is
    // never even consulted.
    const jumped = await as(
      riderOneToken,
      'post',
      `/delivery/orders/${order._id.toString()}/deliver`,
    ).send({ otp: '1111' });
    expect(jumped.status).toBe(409);

    const unchanged = await orders.findById(order._id).exec();
    expect(unchanged?.status).toBe(OrderStatus.ASSIGNED);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  6. The OTP
  // ══════════════════════════════════════════════════════════════════

  it('decrements attempts on a wrong OTP and locks the delivery at the cap', async () => {
    const order = await createOrder({
      status: OrderStatus.OUT_FOR_DELIVERY,
      partnerId: riderTwoPartnerId,
      otp: '7777',
    });

    const path = `/delivery/orders/${order._id.toString()}/deliver`;

    for (let attempt = 1; attempt <= MAX_OTP_ATTEMPTS; attempt += 1) {
      const res = await as(riderTwoToken, 'post', path).send({ otp: '0000' });

      expect([attempt, res.status]).toEqual([attempt, 400]);
      expect(res.body.errors.attemptsRemaining).toBe(
        MAX_OTP_ATTEMPTS - attempt,
      );
      // Never echoed, never hinted at.
      expect(JSON.stringify(res.body)).not.toContain('7777');
    }

    // The cap is reached: the delivery is LOCKED, and even the CORRECT
    // code no longer completes it. Clearing that is a human decision.
    const locked = await as(riderTwoToken, 'post', path).send({ otp: '7777' });
    expect(locked.status).toBe(423);

    const stillOut = await orders.findById(order._id).exec();
    expect(stillOut?.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
  }, 180_000);

  it('completes the delivery when the code is right', async () => {
    const order = await createOrder({
      status: OrderStatus.OUT_FOR_DELIVERY,
      partnerId: riderTwoPartnerId,
      otp: '2468',
    });

    const wrong = await as(
      riderTwoToken,
      'post',
      `/delivery/orders/${order._id.toString()}/deliver`,
    ).send({ otp: '1357' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors.attemptsRemaining).toBe(MAX_OTP_ATTEMPTS - 1);

    const right = await as(
      riderTwoToken,
      'post',
      `/delivery/orders/${order._id.toString()}/deliver`,
    ).send({ otp: '2468' });
    expect(right.status).toBe(200);
    expect(right.body.status).toBe(OrderStatus.DELIVERED);
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  //  7. Location
  // ══════════════════════════════════════════════════════════════════

  it('refuses a location ping when nothing is out for delivery', async () => {
    const res = await as(riderOneToken, 'post', '/delivery/location').send({
      lat: STORE.lat,
      lng: STORE.lng,
    });

    // 400, not 404: the request is well-formed and the rider exists —
    // there is simply nothing in flight for the fix to belong to.
    expect(res.status).toBe(400);
  });

  it('rejects a malformed coordinate before it reaches the database', async () => {
    const res = await as(riderOneToken, 'post', '/delivery/location').send({
      lat: 999,
      lng: 77.5946,
    });
    expect(res.status).toBe(400);

    // Unknown fields are REJECTED by the global pipe, not silently
    // dropped — no mass assignment through this endpoint.
    const extra = await as(riderOneToken, 'post', '/delivery/location').send({
      lat: 12.9,
      lng: 77.5,
      partnerId: riderTwoPartnerId.toString(),
    });
    expect(extra.status).toBe(400);
  });

  // ══════════════════════════════════════════════════════════════════
  //  8. Availability
  // ══════════════════════════════════════════════════════════════════

  it('will not let a rider go offline while carrying an order', async () => {
    const order = await createOrder({
      status: OrderStatus.ASSIGNED,
      partnerId: riderOnePartnerId,
    });
    await partners
      .updateOne(
        { _id: riderOnePartnerId },
        { $set: { activeOrderId: order._id, isAvailable: false } },
      )
      .exec();

    const res = await as(riderOneToken, 'patch', '/delivery/availability').send(
      { isOnline: false, isAvailable: false },
    );
    expect(res.status).toBe(409);

    const stillOnline = await partners.findById(riderOnePartnerId).exec();
    expect(stillOnline?.isOnline).toBe(true);
  });

  it('never marks a rider available while they are carrying an order', async () => {
    const order = await createOrder({
      status: OrderStatus.ASSIGNED,
      partnerId: riderOnePartnerId,
    });
    await partners
      .updateOne(
        { _id: riderOnePartnerId },
        { $set: { activeOrderId: order._id } },
      )
      .exec();

    const res = await as(riderOneToken, 'patch', '/delivery/availability').send(
      { isOnline: true, isAvailable: true },
    );

    expect(res.status).toBe(200);
    // Availability is what the dispatch `$geoNear` pool filters on: a
    // busy rider in that pool receives offers they cannot take.
    expect(res.body.isAvailable).toBe(false);
    expect(res.body.isOnline).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════
  //  9. Profile
  // ══════════════════════════════════════════════════════════════════

  it('returns the rider profile with today\'s figures', async () => {
    const res = await as(riderOneToken, 'get', '/delivery/me');

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(riderOneUserId.toString());
    expect(res.body.partnerId).toBe(riderOnePartnerId.toString());
    expect(res.body.today).toEqual(
      expect.objectContaining({
        deliveries: expect.any(Number),
        earningsPaise: expect.any(Number),
        onlineMinutes: expect.any(Number),
      }),
    );
    // Nothing from the account beyond name and phone.
    expect(res.body.passwordHash).toBeUndefined();
  });
});
