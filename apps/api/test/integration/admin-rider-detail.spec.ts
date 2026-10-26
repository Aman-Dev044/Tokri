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
  DeliveryPartner,
  DeliveryPartnerDocument,
  KycStatus,
  PartnerStatus,
  VehicleType,
} from '../../src/database/schemas/delivery-partner.schema';
import {
  AssignmentStatus,
  DeliveryAssignment,
  DeliveryAssignmentDocument,
} from '../../src/database/schemas/delivery-assignment.schema';
import {
  RiderWallet,
  RiderWalletDocument,
} from '../../src/database/schemas/rider-wallet.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import { point } from '../../src/database/schemas/geo-point';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
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

/** Fictional, generated per run — the same rule as rider-wallet-kyc.spec. */
const AADHAAR = `8${String(Date.now()).slice(-11)}`.slice(0, 12);
const PAN = 'PQRSX6789K';
const DL = `MH12${String(Date.now()).slice(-11)}`.slice(0, 15);

const STORE = { lat: 12.9716, lng: 77.5946 };
const DROP = { lat: 12.9784, lng: 77.6408 };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Verb = 'get' | 'post' | 'patch';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  ADMIN — RIDER LIST AND DETAIL
 * ════════════════════════════════════════════════════════════════════════
 *
 * The console's rider screens were built against fixtures and crashed on
 * the real payload. These assert the payload the screens now read:
 *
 *   • THE ROW     — `activeOrderNo` is resolved; `isOnline=false` and
 *                   `fleet` filter what they say.
 *   • THE DETAIL  — every performance figure is derived from seeded
 *                   orders and offers, and a rider with no history gets
 *                   NULL, never a zero that reads like a measurement.
 *   • MASKING     — the detail carries KYC numbers masked to the last
 *                   four; the whole numbers appear nowhere in it.
 *   • THE GUARDS  — KYC decisions are ADMIN; the wallet credit stays
 *                   SUPER_ADMIN-only.
 */
describe('Admin rider list & detail (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let orders: Model<OrderDocument>;
  let assignments: Model<DeliveryAssignmentDocument>;
  let wallets: Model<RiderWalletDocument>;
  let passwords: PasswordService;

  let vendorId: Types.ObjectId;
  let customerId: Types.ObjectId;
  let riderUserId: Types.ObjectId;
  let riderPartnerId: Types.ObjectId;
  let idlePartnerId: Types.ObjectId;
  let otherPartnerId: Types.ObjectId;
  let activeOrderNo: string;

  let riderToken: string;
  let customerToken: string;
  let adminToken: string;
  let superAdminToken: string;

  let counter = 0;

  async function seedUser(
    role: Role,
    options: { vendorId?: Types.ObjectId | null } = {},
  ): Promise<UserDocument> {
    const n = String(++counter).padStart(4, '0');
    return users.create({
      name: `Detail ${role} ${n}`,
      email: `riderdetail${n}@test.invalid`,
      phone: `95${n}00000`.slice(0, 10),
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

  async function seedOrder(fields: {
    status: OrderStatus;
    deliveryPartnerId: Types.ObjectId | null;
    pickedUpAt?: Date | null;
    deliveredAt?: Date | null;
    statusHistory?: {
      from: OrderStatus | null;
      to: OrderStatus;
      at: Date;
      byUserId?: Types.ObjectId | null;
    }[];
  }): Promise<OrderDocument> {
    const n = String(++counter).padStart(4, '0');
    return orders.create({
      orderNo: `TKR-20261020-${n}`,
      customerId,
      vendorId,
      items: [
        {
          productId: new Types.ObjectId(),
          name: 'Tomatoes',
          unit: '1 kg',
          price: 4_000,
          qty: 1,
          lineTotal: 4_000,
        },
      ],
      pricing: {
        itemsSubtotal: 4_000,
        discount: 0,
        deliveryFee: 2_500,
        taxes: 0,
        grandTotal: 6_500,
        commissionPct: 10,
        commissionAmount: 400,
        vendorPayout: 3_600,
      },
      address: {
        label: 'Home',
        line1: '7 Brigade Road',
        city: 'Bengaluru',
        pincode: '560001',
        location: point(DROP.lng, DROP.lat),
        phone: '9000054321',
      },
      payment: { method: PaymentMethod.COD, status: PaymentStatus.PENDING },
      placedAt: new Date(Date.now() - DAY),
      statusHistory: [],
      ...fields,
    });
  }

  async function seedOffer(
    partnerId: Types.ObjectId,
    status: AssignmentStatus,
  ): Promise<void> {
    const order = await seedOrder({
      status: OrderStatus.READY_FOR_PICKUP,
      deliveryPartnerId: null,
    });
    const offeredAt = new Date(Date.now() - 2 * DAY);
    await assignments.create({
      orderId: order._id,
      partnerId,
      status,
      offeredAt,
      expiresAt: new Date(offeredAt.getTime() + 45_000),
      respondedAt: status === AssignmentStatus.OFFERED ? null : offeredAt,
    });
  }

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
    partners = ctx.app.get<Model<DeliveryPartnerDocument>>(
      getModelToken(DeliveryPartner.name),
    );
    orders = ctx.app.get<Model<OrderDocument>>(getModelToken(Order.name));
    assignments = ctx.app.get<Model<DeliveryAssignmentDocument>>(
      getModelToken(DeliveryAssignment.name),
    );
    wallets = ctx.app.get<Model<RiderWalletDocument>>(
      getModelToken(RiderWallet.name),
    );
    passwords = ctx.app.get(PasswordService);

    const owner = await seedUser(Role.VENDOR);
    const vendor = await vendors.create({
      ownerId: owner._id,
      storeName: 'Detail Fresh',
      slug: `detail-fresh-${Date.now()}`,
      address: {
        line1: '1 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      location: point(STORE.lng, STORE.lat),
      serviceRadiusKm: 5,
      commissionPct: 10,
      status: VendorStatus.APPROVED,
    });
    vendorId = vendor._id;

    const customer = await seedUser(Role.CUSTOMER);
    customerId = customer._id;
    customerToken = await tokenFor(customer);

    // ── The rider under test: vendor fleet, online, mid-run ───────────
    const rider = await seedUser(Role.DELIVERY, { vendorId });
    riderUserId = rider._id;
    riderToken = await tokenFor(rider);

    const partner = await partners.create({
      userId: rider._id,
      vendorId,
      vehicleType: VehicleType.MOTORCYCLE,
      isOnline: true,
      isAvailable: false,
      currentLocation: point(STORE.lng, STORE.lat),
      locationAt: new Date(),
      status: PartnerStatus.ACTIVE,
      completedCount: 2,
      kycStatus: KycStatus.SUBMITTED,
      kycSubmittedAt: new Date(),
      kycSlaDueAt: new Date(Date.now() + DAY),
      aadhaarNumber: AADHAAR,
      panNumber: PAN,
      drivingLicenceNumber: DL,
    });
    riderPartnerId = partner._id;

    // ── A pool rider with no history at all ───────────────────────────
    const idle = await seedUser(Role.DELIVERY);
    const idlePartner = await partners.create({
      userId: idle._id,
      vendorId: null,
      vehicleType: VehicleType.BICYCLE,
      isOnline: false,
      isAvailable: false,
      status: PartnerStatus.ACTIVE,
    });
    idlePartnerId = idlePartner._id;

    // ── The rider a failed order was re-dispatched to ─────────────────
    const other = await seedUser(Role.DELIVERY);
    const otherPartner = await partners.create({
      userId: other._id,
      vendorId: null,
      vehicleType: VehicleType.SCOOTER,
      isOnline: false,
      isAvailable: false,
      status: PartnerStatus.ACTIVE,
    });
    otherPartnerId = otherPartner._id;

    const now = Date.now();

    // Two delivered runs: 10 and 20 minutes, this week and two weeks ago.
    await seedOrder({
      status: OrderStatus.DELIVERED,
      deliveryPartnerId: riderPartnerId,
      pickedUpAt: new Date(now - DAY - 10 * MINUTE),
      deliveredAt: new Date(now - DAY),
    });
    await seedOrder({
      status: OrderStatus.DELIVERED,
      deliveryPartnerId: riderPartnerId,
      pickedUpAt: new Date(now - 15 * DAY - 20 * MINUTE),
      deliveredAt: new Date(now - 15 * DAY),
    });

    // A failure THIS rider recorded, since re-dispatched to another one.
    await seedOrder({
      status: OrderStatus.ASSIGNED,
      deliveryPartnerId: otherPartnerId,
      statusHistory: [
        {
          from: OrderStatus.OUT_FOR_DELIVERY,
          to: OrderStatus.DELIVERY_FAILED,
          at: new Date(now - 3 * DAY),
          byUserId: riderUserId,
        },
      ],
    });

    // The order the rider is carrying right now.
    const active = await seedOrder({
      status: OrderStatus.OUT_FOR_DELIVERY,
      deliveryPartnerId: riderPartnerId,
      pickedUpAt: new Date(now - 5 * MINUTE),
      statusHistory: [
        {
          from: OrderStatus.READY_FOR_PICKUP,
          to: OrderStatus.ASSIGNED,
          at: new Date(now - 12 * MINUTE),
          byUserId: riderUserId,
        },
      ],
    });
    activeOrderNo = active.orderNo;
    await partners
      .updateOne({ _id: riderPartnerId }, { $set: { activeOrderId: active._id } })
      .exec();

    // Offers: 3 accepted, 1 rejected, 1 expired → 60.0%. The live and the
    // withdrawn offer are not the rider's choice and must not count.
    for (const status of [
      AssignmentStatus.ACCEPTED,
      AssignmentStatus.ACCEPTED,
      AssignmentStatus.ACCEPTED,
      AssignmentStatus.REJECTED,
      AssignmentStatus.EXPIRED,
      AssignmentStatus.OFFERED,
      AssignmentStatus.CANCELLED,
    ]) {
      await seedOffer(riderPartnerId, status);
    }

    await wallets.create({ partnerId: riderPartnerId, balancePaise: 12_345 });

    adminToken = await tokenFor(await seedUser(Role.ADMIN));
    superAdminToken = await tokenFor(await seedUser(Role.SUPER_ADMIN));
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  The list
  // ══════════════════════════════════════════════════════════════════

  describe('GET /admin/delivery-partners', () => {
    it('resolves the active order number, and carries no identifier', async () => {
      const res = await as(adminToken, 'get', '/admin/delivery-partners');
      expect(res.status).toBe(200);

      const row = (res.body.data as Record<string, unknown>[]).find(
        (entry) => entry.id === riderPartnerId.toString(),
      );
      expect(row).toBeDefined();
      expect(row?.activeOrderNo).toBe(activeOrderNo);
      expect(row?.locationAt).toEqual(expect.any(String));
      expect(row).not.toHaveProperty('city');

      const idle = (res.body.data as Record<string, unknown>[]).find(
        (entry) => entry.id === idlePartnerId.toString(),
      );
      expect(idle?.activeOrderNo).toBeNull();
      expect(idle?.locationAt).toBeNull();

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(AADHAAR);
      expect(body).not.toContain(PAN);
    });

    it('reads isOnline=false as false', async () => {
      const res = await as(
        adminToken,
        'get',
        '/admin/delivery-partners?isOnline=false',
      );
      expect(res.status).toBe(200);

      const ids = (res.body.data as { id: string }[]).map((row) => row.id);
      expect(ids).toContain(idlePartnerId.toString());
      // Before the fix this was Boolean("false") — true — and the
      // "Offline" filter listed exactly the riders who were online.
      expect(ids).not.toContain(riderPartnerId.toString());

      const online = await as(adminToken, 'get', '/admin/delivery-partners?isOnline=true');
      expect((online.body.data as { id: string }[]).map((row) => row.id)).toEqual([
        riderPartnerId.toString(),
      ]);

      const garbage = await as(adminToken, 'get', '/admin/delivery-partners?isOnline=maybe');
      expect(garbage.status).toBe(400);
    });

    it('filters by fleet', async () => {
      const pool = await as(adminToken, 'get', '/admin/delivery-partners?fleet=pool');
      const poolIds = (pool.body.data as { id: string }[]).map((row) => row.id);
      expect(poolIds).toContain(idlePartnerId.toString());
      expect(poolIds).not.toContain(riderPartnerId.toString());

      const fleet = await as(adminToken, 'get', '/admin/delivery-partners?fleet=vendor');
      const fleetIds = (fleet.body.data as { id: string }[]).map((row) => row.id);
      expect(fleetIds).toEqual([riderPartnerId.toString()]);

      const bad = await as(adminToken, 'get', '/admin/delivery-partners?fleet=moon');
      expect(bad.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  The detail
  // ══════════════════════════════════════════════════════════════════

  describe('GET /admin/delivery-partners/:id', () => {
    it('derives every performance figure from orders and offers', async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/delivery-partners/${riderPartnerId.toString()}`,
      );
      expect(res.status).toBe(200);

      expect(res.body.performance).toEqual({
        deliveredCount: 2,
        // Counted from the history, though another rider now holds it.
        failedCount: 1,
        avgRunMinutes: 15,
        offers: { accepted: 3, rejected: 1, expired: 1 },
        acceptRatePct: 60,
        weeklyDelivered: [0, 0, 0, 0, 0, 1, 0, 1],
      });
      expect(res.body.walletBalancePaise).toBe(12_345);
    });

    it('describes the order the rider is carrying', async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/delivery-partners/${riderPartnerId.toString()}`,
      );

      expect(res.body.activeOrderNo).toBe(activeOrderNo);
      expect(res.body.currentAssignment).toMatchObject({
        orderNo: activeOrderNo,
        status: OrderStatus.OUT_FOR_DELIVERY,
        customerName: expect.stringContaining('Detail customer'),
        pickup: 'Detail Fresh',
        dropCity: 'Bengaluru',
        dropPincode: '560001',
        assignedAt: expect.any(String),
      });
    });

    it('lists finished runs, newest first, with real run times', async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/delivery-partners/${riderPartnerId.toString()}`,
      );

      const runs = res.body.deliveries as {
        status: string;
        runMinutes: number | null;
        endedAt: string | null;
        vendorName: string | null;
      }[];
      expect(runs).toHaveLength(2);
      expect(runs.every((run) => run.status === OrderStatus.DELIVERED)).toBe(true);
      expect(runs.map((run) => run.runMinutes).sort()).toEqual([10, 20]);
      expect(runs[0].vendorName).toBe('Detail Fresh');
      expect(runs.every((run) => typeof run.endedAt === 'string')).toBe(true);
    });

    it('masks every KYC number, and never carries one whole', async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/delivery-partners/${riderPartnerId.toString()}`,
      );

      expect(res.body.kyc).toMatchObject({
        status: KycStatus.SUBMITTED,
        breached: false,
        aadhaarNumberMasked: `XXXX XXXX ${AADHAAR.slice(-4)}`,
        panNumberMasked: `XXXXXX${PAN.slice(-4)}`,
      });
      expect(res.body.kyc.drivingLicenceNumberMasked).toMatch(
        new RegExp(`^X+${DL.slice(-4)}$`),
      );

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(AADHAAR);
      expect(body).not.toContain(PAN);
      expect(body).not.toContain(DL);
    });

    it('gives a rider with no history nulls, not zeros', async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/delivery-partners/${idlePartnerId.toString()}`,
      );
      expect(res.status).toBe(200);

      expect(res.body.performance).toEqual({
        deliveredCount: 0,
        failedCount: 0,
        avgRunMinutes: null,
        offers: { accepted: 0, rejected: 0, expired: 0 },
        acceptRatePct: null,
        weeklyDelivered: [0, 0, 0, 0, 0, 0, 0, 0],
      });
      expect(res.body.currentAssignment).toBeNull();
      expect(res.body.deliveries).toEqual([]);
      expect(res.body.kyc.status).toBe(KycStatus.NOT_STARTED);
      expect(res.body.kyc.aadhaarNumberMasked).toBeNull();
      expect(res.body.walletBalancePaise).toBe(0);
      // A read must not create the wallet it reports on.
      expect(await wallets.countDocuments({ partnerId: idlePartnerId })).toBe(0);
    });

    it('404s for a malformed or unknown id', async () => {
      for (const id of ['not-an-id', new Types.ObjectId().toString()]) {
        const res = await as(adminToken, 'get', `/admin/delivery-partners/${id}`);
        expect(res.status).toBe(404);
      }
    });

    it('is refused to a rider and to a customer', async () => {
      for (const token of [riderToken, customerToken]) {
        const res = await as(
          token,
          'get',
          `/admin/delivery-partners/${riderPartnerId.toString()}`,
        );
        expect(res.status).toBe(403);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  The two actions the detail screen now offers
  // ══════════════════════════════════════════════════════════════════

  describe('KYC and wallet guards, as the detail screen calls them', () => {
    it('keeps the wallet credit SUPER_ADMIN-only', async () => {
      const path = `/admin/riders/${riderPartnerId.toString()}/wallet/credit`;
      const body = { amountPaise: 50_000, note: 'Cash received at the office' };

      for (const token of [adminToken, riderToken, customerToken]) {
        const refused = await as(token, 'post', path).send(body);
        expect(refused.status).toBe(403);
      }

      const res = await as(superAdminToken, 'post', path).send(body);
      expect(res.status).toBe(201);

      const detail = await as(
        superAdminToken,
        'get',
        `/admin/delivery-partners/${riderPartnerId.toString()}`,
      );
      expect(detail.body.walletBalancePaise).toBe(12_345 + 50_000);
    });

    it('refuses a KYC decision to a rider and a customer', async () => {
      for (const token of [riderToken, customerToken]) {
        const res = await as(
          token,
          'post',
          `/admin/riders/${riderPartnerId.toString()}/kyc/verify`,
        ).send({});
        expect(res.status).toBe(403);
      }
    });

    it('lets an ADMIN reject (reason required) and then verify', async () => {
      const base = `/admin/riders/${riderPartnerId.toString()}/kyc`;

      const empty = await as(adminToken, 'post', `${base}/reject`).send({ reason: '' });
      expect(empty.status).toBe(400);

      const rejected = await as(adminToken, 'post', `${base}/reject`).send({
        reason: 'The licence photo is cropped.',
      });
      expect(rejected.status).toBe(200);

      const afterReject = await as(
        adminToken,
        'get',
        `/admin/delivery-partners/${riderPartnerId.toString()}`,
      );
      expect(afterReject.body.kyc.status).toBe(KycStatus.REJECTED);
      expect(afterReject.body.kyc.rejectedReason).toContain('cropped');

      const verified = await as(adminToken, 'post', `${base}/verify`).send({});
      expect(verified.status).toBe(200);

      const afterVerify = await as(
        adminToken,
        'get',
        `/admin/delivery-partners/${riderPartnerId.toString()}`,
      );
      expect(afterVerify.body.kyc.status).toBe(KycStatus.VERIFIED);
      expect(afterVerify.body.kyc.verifiedAt).toEqual(expect.any(String));
    });
  });
});
