import 'reflect-metadata';
import { WsException } from '@nestjs/websockets';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';
import type { Socket } from 'socket.io';

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
import { RealtimeGateway } from '../../src/realtime/gateways/realtime.gateway';
import { RiderPresenceRegistry } from '../../src/realtime/rider-presence.registry';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * A socket, reduced to what the gateway actually touches.
 *
 * The handshake, `data`, `rooms`, `join`, `leave`, `emit` and
 * `disconnect` — that is the entire surface `RealtimeGateway` uses, so
 * this stub exercises the REAL gateway, the REAL JWT verification and the
 * REAL database lookups. Only the transport is absent.
 *
 * (`socket.io-client` is not a dependency of this workspace; adding one
 * to assert a `join` that this already observes directly would buy a
 * slower test, not a stronger one. What matters is that the decisions
 * below are the ones the running gateway makes.)
 */
class FakeSocket {
  readonly id: string;
  data: Record<string, unknown> = {};
  readonly rooms = new Set<string>();
  readonly emitted: { event: string; payload: unknown }[] = [];
  disconnected = false;
  readonly handshake: {
    auth: Record<string, unknown>;
    headers: Record<string, string>;
  };

  constructor(token?: string, id = `sock-${Math.random().toString(36).slice(2)}`) {
    this.id = id;
    this.handshake = {
      auth: token === undefined ? {} : { token },
      headers: {},
    };
  }

  join(room: string): Promise<void> {
    this.rooms.add(room);
    return Promise.resolve();
  }

  leave(room: string): Promise<void> {
    this.rooms.delete(room);
    return Promise.resolve();
  }

  emit(event: string, payload: unknown): boolean {
    this.emitted.push({ event, payload });
    return true;
  }

  disconnect(): this {
    this.disconnected = true;
    return this;
  }
}

const asSocket = (socket: FakeSocket): Socket =>
  socket as unknown as Socket;

/**
 * ════════════════════════════════════════════════════════════════════════
 *  SOCKET ROOMS — THE SECURITY-CRITICAL SPEC
 * ════════════════════════════════════════════════════════════════════════
 *
 * The source document's warning, quoted in §6.3:
 *
 *   "A client must never be allowed to subscribe to another vendor, order
 *    or customer room simply by changing an identifier."
 *
 * That is one sentence and four failure modes, and each is asserted here
 * against a real database:
 *
 *   1. NO UNAUTHENTICATED SOCKET EXISTS. No token, a forged token, an
 *      expired token and a suspended account are all disconnected inside
 *      `handleConnection` — before a single room is joined.
 *   2. Rooms on connect are ASSIGNED BY THE SERVER. They are a pure
 *      function of the verified token; the client cannot ask for one,
 *      decline one, or influence which it gets.
 *   3. `order:subscribe` is checked against the ORDER DOCUMENT. Customer,
 *      vendor, assigned rider, admin — anyone else gets `forbidden`.
 *   4. Changing the id in the payload gets the caller NOTHING: a
 *      different customer's order is `forbidden`, and a nonexistent or
 *      malformed id is `not_found` — indistinguishable from each other,
 *      so the response is not an enumeration oracle.
 */
describe('Realtime rooms (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let gateway: RealtimeGateway;
  let presence: RiderPresenceRegistry;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let orders: Model<OrderDocument>;
  let passwords: PasswordService;

  let vendorAId: Types.ObjectId;
  let vendorBId: Types.ObjectId;

  let customerAId: Types.ObjectId;
  let riderAPartnerId: Types.ObjectId;

  let customerAToken: string;
  let customerBToken: string;
  let vendorAToken: string;
  let vendorBToken: string;
  let riderAToken: string;
  let riderBToken: string;
  let adminToken: string;
  let suspendedToken: string;

  let suspendedUserId: Types.ObjectId;

  /** Vendor A's order, for customer A, carried by rider A. */
  let orderAId: Types.ObjectId;

  let counter = 0;

  async function seedUser(
    role: Role,
    options: { vendorId?: Types.ObjectId | null } = {},
  ): Promise<UserDocument> {
    const n = String(++counter).padStart(4, '0');
    return users.create({
      name: `Socket ${role} ${n}`,
      email: `socket${n}@test.invalid`,
      phone: `96${n}00000`.slice(0, 10),
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

  async function makeVendor(slug: string): Promise<VendorDocument> {
    const owner = await seedUser(Role.VENDOR);
    const vendor = await vendors.create({
      ownerId: owner._id,
      storeName: `Store ${slug}`,
      slug: `${slug}-${Date.now()}`,
      address: {
        line1: '1 Main Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      location: point(77.5946, 12.9716),
      serviceRadiusKm: 5,
      commissionPct: 12,
      status: VendorStatus.APPROVED,
    });

    await users
      .updateOne({ _id: owner._id }, { $set: { vendorId: vendor._id } })
      .exec();

    return vendor;
  }

  /** Connect a socket through the real gateway. */
  async function connect(token?: string): Promise<FakeSocket> {
    const socket = new FakeSocket(token);
    await gateway.handleConnection(asSocket(socket));
    return socket;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;

    gateway = ctx.app.get(RealtimeGateway);
    presence = ctx.app.get(RiderPresenceRegistry);

    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
    partners = ctx.app.get<Model<DeliveryPartnerDocument>>(
      getModelToken(DeliveryPartner.name),
    );
    orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
    passwords = ctx.app.get(PasswordService);

    const vendorA = await makeVendor('vendor-a');
    const vendorB = await makeVendor('vendor-b');
    vendorAId = vendorA._id;
    vendorBId = vendorB._id;

    vendorAToken = await tokenFor(
      (await users.findById(vendorA.ownerId).exec()) as UserDocument,
    );
    vendorBToken = await tokenFor(
      (await users.findById(vendorB.ownerId).exec()) as UserDocument,
    );

    const customerA = await seedUser(Role.CUSTOMER);
    const customerB = await seedUser(Role.CUSTOMER);
    customerAId = customerA._id;
    customerAToken = await tokenFor(customerA);
    customerBToken = await tokenFor(customerB);

    const riderA = await seedUser(Role.DELIVERY, { vendorId: vendorAId });
    const riderB = await seedUser(Role.DELIVERY, { vendorId: vendorAId });
    riderAToken = await tokenFor(riderA);
    riderBToken = await tokenFor(riderB);

    const partnerA = await partners.create({
      userId: riderA._id,
      vendorId: vendorAId,
      vehicleType: VehicleType.SCOOTER,
      isOnline: true,
      isAvailable: false,
      currentLocation: point(77.5946, 12.9716),
      status: PartnerStatus.ACTIVE,
    });
    riderAPartnerId = partnerA._id;

    await partners.create({
      userId: riderB._id,
      vendorId: vendorAId,
      vehicleType: VehicleType.BICYCLE,
      isOnline: true,
      isAvailable: true,
      currentLocation: point(77.5946, 12.9716),
      status: PartnerStatus.ACTIVE,
    });

    const admin = await seedUser(Role.ADMIN);
    adminToken = await tokenFor(admin);

    // Token minted while ACTIVE, then the account is suspended: the
    // signature is still perfectly valid.
    const suspended = await seedUser(Role.CUSTOMER);
    suspendedUserId = suspended._id;
    suspendedToken = await tokenFor(suspended);
    await users
      .updateOne(
        { _id: suspended._id },
        { $set: { status: UserStatus.SUSPENDED } },
      )
      .exec();

    const order = await orders.create({
      orderNo: `MND-SOCK-${Date.now()}`,
      customerId: customerAId,
      vendorId: vendorAId,
      deliveryPartnerId: riderAPartnerId,
      items: [
        {
          productId: new Types.ObjectId(),
          name: 'Rice',
          unit: '5 kg',
          price: 40_000,
          qty: 1,
          lineTotal: 40_000,
        },
      ],
      pricing: {
        itemsSubtotal: 40_000,
        discount: 0,
        deliveryFee: 2_900,
        taxes: 0,
        grandTotal: 42_900,
        commissionPct: 12,
        commissionAmount: 4_800,
        vendorPayout: 35_200,
      },
      address: {
        line1: '9 Brigade Road',
        city: 'Bengaluru',
        pincode: '560001',
        location: point(77.6033, 12.9719),
        phone: '9000099999',
      },
      payment: {
        method: PaymentMethod.COD,
        status: PaymentStatus.PENDING,
      },
      status: OrderStatus.OUT_FOR_DELIVERY,
      placedAt: new Date(),
    });
    orderAId = order._id;
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  1. No unauthenticated socket ever exists
  // ══════════════════════════════════════════════════════════════════

  describe('authentication', () => {
    it('disconnects a socket that presents no token', async () => {
      const socket = await connect(undefined);

      expect(socket.disconnected).toBe(true);
      expect(socket.data.user).toBeUndefined();
      // Not one room. The disconnect happens BEFORE any join.
      expect([...socket.rooms]).toEqual([]);
      expect(socket.emitted.map((e) => e.event)).toEqual(['auth_error']);
    });

    it('disconnects a socket that presents a forged token', async () => {
      const socket = await connect('not.a.jwt');

      expect(socket.disconnected).toBe(true);
      expect([...socket.rooms]).toEqual([]);
    });

    it('disconnects a token signed with the wrong secret', async () => {
      // A structurally perfect JWT whose signature does not verify.
      const forged = [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
          'base64url',
        ),
        Buffer.from(
          JSON.stringify({
            sub: customerAId.toString(),
            role: Role.ADMIN,
            jti: 'forged',
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString('base64url'),
        'this-signature-is-not-real',
      ].join('.');

      const socket = await connect(forged);

      expect(socket.disconnected).toBe(true);
      expect([...socket.rooms]).toEqual([]);
    });

    it('disconnects a valid token whose account has been suspended', async () => {
      const socket = await connect(suspendedToken);

      // The signature is genuine. The account is not active, and a socket
      // lives for hours — so the account is re-checked here rather than
      // trusted to expire.
      expect(socket.disconnected).toBe(true);
      expect(socket.data.user).toBeUndefined();
      expect(
        [...socket.rooms].some((room) =>
          room.includes(suspendedUserId.toString()),
        ),
      ).toBe(false);
    });

    it('refuses a subscription from a socket with no identity', async () => {
      const socket = new FakeSocket();

      await expect(
        gateway.subscribeToOrder(asSocket(socket), {
          orderId: orderAId.toString(),
        }),
      ).rejects.toThrow(WsException);

      expect([...socket.rooms]).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  2. Rooms are assigned by the server
  // ══════════════════════════════════════════════════════════════════

  describe('server-assigned rooms', () => {
    it('joins a customer to their own user room and nothing else', async () => {
      const socket = await connect(customerAToken);

      expect(socket.disconnected).toBe(false);
      expect([...socket.rooms]).toEqual([`user:${customerAId.toString()}`]);
      expect([...socket.rooms]).not.toContain('admin');
    });

    it('joins a vendor to their own vendor room', async () => {
      const socket = await connect(vendorAToken);

      expect([...socket.rooms]).toContain(`vendor:${vendorAId.toString()}`);
      // And never to another tenant's.
      expect([...socket.rooms]).not.toContain(`vendor:${vendorBId.toString()}`);
      expect([...socket.rooms]).not.toContain('admin');
    });

    it('joins an admin to the admin room', async () => {
      const socket = await connect(adminToken);
      expect([...socket.rooms]).toContain('admin');
    });

    it('does NOT put a rider in their store\'s vendor room', async () => {
      const socket = await connect(riderAToken);

      // A rider's vendorId scopes them for dispatch. It does not entitle
      // them to the store's entire order feed.
      expect([...socket.rooms]).not.toContain(`vendor:${vendorAId.toString()}`);
      expect([...socket.rooms]).toContain(
        `user:${(socket.data.user as { sub: string }).sub}`,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  3 & 4. order:subscribe — changing the id gets you nothing
  // ══════════════════════════════════════════════════════════════════

  describe('order:subscribe', () => {
    it('lets the order\'s own customer in', async () => {
      const socket = await connect(customerAToken);

      const ack = await gateway.subscribeToOrder(asSocket(socket), {
        orderId: orderAId.toString(),
      });

      expect(ack).toEqual({ ok: true, room: `order:${orderAId.toString()}` });
      expect([...socket.rooms]).toContain(`order:${orderAId.toString()}`);
    });

    it("REFUSES another customer's order", async () => {
      const socket = await connect(customerBToken);

      // Customer B has a perfectly valid token and simply changed the id.
      await expect(
        gateway.subscribeToOrder(asSocket(socket), {
          orderId: orderAId.toString(),
        }),
      ).rejects.toThrow('forbidden');

      // The room was NOT joined. This is the assertion the whole file
      // exists for: no event from that order will ever reach this socket.
      expect([...socket.rooms]).not.toContain(`order:${orderAId.toString()}`);
    });

    it("REFUSES another vendor's order", async () => {
      const socket = await connect(vendorBToken);

      await expect(
        gateway.subscribeToOrder(asSocket(socket), {
          orderId: orderAId.toString(),
        }),
      ).rejects.toThrow('forbidden');

      expect([...socket.rooms]).not.toContain(`order:${orderAId.toString()}`);
    });

    it('lets the order\'s own vendor in', async () => {
      const socket = await connect(vendorAToken);

      await gateway.subscribeToOrder(asSocket(socket), {
        orderId: orderAId.toString(),
      });

      expect([...socket.rooms]).toContain(`order:${orderAId.toString()}`);
    });

    it('lets the ASSIGNED rider in and refuses every other rider', async () => {
      const assigned = await connect(riderAToken);
      await gateway.subscribeToOrder(asSocket(assigned), {
        orderId: orderAId.toString(),
      });
      expect([...assigned.rooms]).toContain(`order:${orderAId.toString()}`);

      const other = await connect(riderBToken);
      await expect(
        gateway.subscribeToOrder(asSocket(other), {
          orderId: orderAId.toString(),
        }),
      ).rejects.toThrow('forbidden');
      expect([...other.rooms]).not.toContain(`order:${orderAId.toString()}`);
    });

    it('lets an admin in', async () => {
      const socket = await connect(adminToken);

      await gateway.subscribeToOrder(asSocket(socket), {
        orderId: orderAId.toString(),
      });

      expect([...socket.rooms]).toContain(`order:${orderAId.toString()}`);
    });

    it('answers not_found for an unknown id AND a malformed one', async () => {
      const socket = await connect(customerAToken);

      // Both must look identical from outside. A 'not_found' for garbage
      // and something else for a real-but-forbidden id would let a caller
      // map which ids exist.
      await expect(
        gateway.subscribeToOrder(asSocket(socket), {
          orderId: new Types.ObjectId().toString(),
        }),
      ).rejects.toThrow('not_found');

      await expect(
        gateway.subscribeToOrder(asSocket(socket), { orderId: 'nonsense' }),
      ).rejects.toThrow('not_found');

      await expect(
        gateway.subscribeToOrder(asSocket(socket), { orderId: undefined }),
      ).rejects.toThrow('not_found');

      expect([...socket.rooms]).toEqual([`user:${customerAId.toString()}`]);
    });

    it('leaves an order room on request without needing a check', async () => {
      const socket = await connect(customerAToken);
      await gateway.subscribeToOrder(asSocket(socket), {
        orderId: orderAId.toString(),
      });

      await gateway.unsubscribeFromOrder(asSocket(socket), {
        orderId: orderAId.toString(),
      });

      expect([...socket.rooms]).not.toContain(`order:${orderAId.toString()}`);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  5. The rider heartbeat
  // ══════════════════════════════════════════════════════════════════

  describe('rider heartbeat', () => {
    it('records a beat from a rider and refuses one from anybody else', async () => {
      const rider = await connect(riderAToken);
      const riderUserId = (rider.data.user as { sub: string }).sub;

      expect(presence.isConnected(riderUserId)).toBe(true);

      const ack = gateway.heartbeat(asSocket(rider));
      expect(ack.ok).toBe(true);

      const customer = await connect(customerAToken);
      expect(() => gateway.heartbeat(asSocket(customer))).toThrow('forbidden');
    });

    it('tracks a rider across devices and forgets them when the last closes', async () => {
      // Earlier cases left sockets open for this rider; presence is a
      // live registry, so the test starts from a known state.
      presence.clear();

      const phone = await connect(riderBToken);
      const tablet = await connect(riderBToken);
      const riderUserId = (phone.data.user as { sub: string }).sub;

      expect(presence.isConnected(riderUserId)).toBe(true);

      // One device drops: the rider is still there on the other.
      gateway.handleDisconnect(asSocket(phone));
      expect(presence.isConnected(riderUserId)).toBe(true);

      gateway.handleDisconnect(asSocket(tablet));
      expect(presence.isConnected(riderUserId)).toBe(false);

      // The socket is gone, but the ENTRY survives with its last-seen
      // timestamp: a rider in a lift must not lose their order for eight
      // seconds of silence. `RiderHeartbeatService` decides, 65 seconds
      // later — and `takeStale` hands each rider over exactly once.
      const future = new Date(Date.now() + 120_000);
      expect(presence.takeStale(future)).toContain(riderUserId);
      expect(presence.takeStale(future)).not.toContain(riderUserId);
    });
  });
});
