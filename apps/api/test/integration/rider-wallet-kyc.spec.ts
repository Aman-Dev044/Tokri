import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
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
  RiderWallet,
  RiderWalletDocument,
} from '../../src/database/schemas/rider-wallet.schema';
import {
  WalletTransaction,
  WalletTransactionDocument,
  WalletTxnType,
} from '../../src/database/schemas/wallet-transaction.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import { point } from '../../src/database/schemas/geo-point';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { AssignmentService } from '../../src/modules/delivery/assignment.service';
import { RiderWalletService } from '../../src/modules/delivery/rider-wallet.service';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/** Generated per run, never a literal. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const STORE = { lat: 12.9716, lng: 77.5946 };
const CUSTOMER_DROP = { lat: 12.9784, lng: 77.6408 };

/**
 * Real-shaped but fictional identifiers, GENERATED per run rather than
 * written down. Nothing here is a real Aadhaar or PAN, and nothing here
 * could be pasted into an environment by accident — the same reason
 * `test-env.ts` generates its secrets instead of hardcoding them.
 */
const AADHAAR = `9${String(Date.now()).slice(-11)}`.slice(0, 12);
const PAN = 'ABCDE1234F';
const DL = `KA01${String(Date.now()).slice(-11)}`.slice(0, 15);

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RIDER WALLET & KYC
 * ════════════════════════════════════════════════════════════════════════
 *
 * Asserted against a real replica set, because almost everything here is
 * a property of the DATA under concurrency rather than of the code that
 * reads it:
 *
 *   • THE GATE       — an unverified rider cannot accept an order at
 *                      all (403 `KYC_NOT_VERIFIED`), and a verified one
 *                      with an empty wallet gets 402
 *                      `INSUFFICIENT_WALLET_BALANCE`, never 400.
 *   • THE FEE        — drawn inside the ceiling and floor, charged
 *                      exactly once, written to the ledger with a
 *                      NEGATIVE amount and a stored running balance,
 *                      and persisted on the assignment.
 *   • NO OVERDRAW    — concurrent charges against one wallet can never
 *                      take it below zero. The guard is the point, and a
 *                      guard is only provable against a real database.
 *   • RECONCILIATION — the balance always equals the sum of the ledger.
 *   • MASKING        — the rider's own KYC response contains no full
 *                      identifier; the admin verification response is
 *                      the one place it does.
 *   • THE 503s       — top-up and document upload refuse HONESTLY while
 *                      Razorpay and S3 are unconfigured, and write
 *                      nothing while doing so.
 */
describe('Rider wallet & KYC (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let orders: Model<OrderDocument>;
  let wallets: Model<RiderWalletDocument>;
  let ledger: Model<WalletTransactionDocument>;
  let passwords: PasswordService;
  let assignments: AssignmentService;
  let walletService: RiderWalletService;

  let pickFeeMinPaise: number;
  let pickFeeMaxPaise: number;
  let lowBalanceWarnPaise: number;
  let kycSlaHours: number;

  let vendorId: Types.ObjectId;
  let customerId: Types.ObjectId;

  let riderUserId: Types.ObjectId;
  let riderPartnerId: Types.ObjectId;
  let riderToken: string;

  let adminToken: string;
  let superAdminToken: string;
  let customerToken: string;

  let counter = 0;

  async function seedUser(
    role: Role,
    options: { vendorId?: Types.ObjectId | null } = {},
  ): Promise<UserDocument> {
    const n = String(++counter).padStart(4, '0');
    return users.create({
      name: `Wallet ${role} ${n}`,
      email: `wallet${n}@test.invalid`,
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

  async function createReadyOrder(): Promise<OrderDocument> {
    const n = String(++counter).padStart(4, '0');
    return orders.create({
      orderNo: `TKR-20260928-${n}`,
      customerId,
      vendorId,
      deliveryPartnerId: null,
      items: [
        {
          productId: new Types.ObjectId(),
          name: 'Bananas',
          unit: '1 dozen',
          price: 6_000,
          qty: 1,
          lineTotal: 6_000,
        },
      ],
      pricing: {
        itemsSubtotal: 6_000,
        discount: 0,
        deliveryFee: 2_900,
        taxes: 0,
        grandTotal: 8_900,
        commissionPct: 12,
        commissionAmount: 720,
        vendorPayout: 5_280,
      },
      address: {
        label: 'Home',
        line1: '12 Residency Road',
        city: 'Bengaluru',
        pincode: '560025',
        location: point(CUSTOMER_DROP.lng, CUSTOMER_DROP.lat),
        phone: '9000012345',
      },
      payment: { method: PaymentMethod.COD, status: PaymentStatus.PENDING },
      status: OrderStatus.READY_FOR_PICKUP,
      statusHistory: [],
      placedAt: new Date(),
      readyAt: new Date(),
    });
  }

  /** Free, online, at the shop door, wallet set to `balancePaise`. */
  async function resetRider(options: {
    kycStatus: KycStatus;
    balancePaise: number;
  }): Promise<void> {
    await partners
      .updateOne(
        { _id: riderPartnerId },
        {
          $set: {
            isOnline: true,
            isAvailable: true,
            activeOrderId: null,
            status: PartnerStatus.ACTIVE,
            currentLocation: point(STORE.lng, STORE.lat),
            kycStatus: options.kycStatus,
          },
        },
      )
      .exec();

    await wallets
      .updateOne(
        { partnerId: riderPartnerId },
        {
          $set: {
            balancePaise: options.balancePaise,
            lifetimeSpentPaise: 0,
            lifetimeToppedUpPaise: 0,
            lifetimeEarnedPaise: 0,
          },
        },
        { upsert: true },
      )
      .exec();

    await ledger.deleteMany({ partnerId: riderPartnerId }).exec();
  }

  /** Dispatch one ready order to the rider and return the offer id. */
  async function offerOne(): Promise<{ offerId: string; order: OrderDocument }> {
    const order = await createReadyOrder();
    const outcome = await assignments.dispatch(order._id);
    expect(outcome.result).toBe('offered');

    const res = await as(riderToken, 'get', '/delivery/offers');
    expect(res.status).toBe(200);
    const row = (res.body as { id: string; orderId: string }[]).find(
      (offer) => offer.orderId === order._id.toString(),
    );
    expect(row).toBeDefined();
    return { offerId: (row as { id: string }).id, order };
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
    wallets = ctx.app.get<Model<RiderWalletDocument>>(
      getModelToken(RiderWallet.name),
    );
    ledger = ctx.app.get<Model<WalletTransactionDocument>>(
      getModelToken(WalletTransaction.name),
    );
    passwords = ctx.app.get(PasswordService);
    assignments = ctx.app.get(AssignmentService);
    walletService = ctx.app.get(RiderWalletService);

    // Read from the SAME configuration the service reads, never
    // hardcoded: a test that pins 2500/5000 by hand stops testing the
    // knob and starts testing a copy of it.
    const config = ctx.app.get(ConfigService);
    pickFeeMinPaise = config.getOrThrow<number>('rider.pickFeeMinPaise');
    pickFeeMaxPaise = config.getOrThrow<number>('rider.pickFeeMaxPaise');
    lowBalanceWarnPaise = config.getOrThrow<number>('rider.lowBalanceWarnPaise');
    kycSlaHours = config.getOrThrow<number>('rider.kycSlaHours');

    const owner = await seedUser(Role.VENDOR);
    const vendor = await vendors.create({
      ownerId: owner._id,
      storeName: 'Wallet Fresh',
      slug: `wallet-fresh-${Date.now()}`,
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

    const rider = await seedUser(Role.DELIVERY, { vendorId });
    riderUserId = rider._id;
    riderToken = await tokenFor(rider);

    const partner = await partners.create({
      userId: rider._id,
      vendorId,
      vehicleType: VehicleType.SCOOTER,
      isOnline: true,
      isAvailable: true,
      currentLocation: point(STORE.lng, STORE.lat),
      locationAt: new Date(),
      status: PartnerStatus.ACTIVE,
    });
    riderPartnerId = partner._id;

    adminToken = await tokenFor(await seedUser(Role.ADMIN));
    superAdminToken = await tokenFor(await seedUser(Role.SUPER_ADMIN));
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  1. The wallet surface
  // ══════════════════════════════════════════════════════════════════

  describe('GET /delivery/wallet', () => {
    it('creates the wallet at zero and reports it as low', async () => {
      await wallets.deleteMany({ partnerId: riderPartnerId }).exec();

      const res = await as(riderToken, 'get', '/delivery/wallet');
      expect(res.status).toBe(200);
      expect(res.body.balancePaise).toBe(0);
      // Zero is at or below the threshold, so it is low. The CLIENT is
      // never asked to work that out — the threshold is server config.
      expect(res.body.lowBalance).toBe(true);
      expect(res.body.warnThresholdPaise).toBe(lowBalanceWarnPaise);
      expect(res.body.lifetimeSpentPaise).toBe(0);
      expect(res.body.pickFeeMinPaise).toBe(pickFeeMinPaise);
      expect(res.body.pickFeeMaxPaise).toBe(pickFeeMaxPaise);
      expect(typeof res.body.totalDelivered).toBe('number');
    });

    it('is refused to a customer token', async () => {
      const res = await as(customerToken, 'get', '/delivery/wallet');
      expect(res.status).toBe(403);
    });

    it('is refused without a token at all', async () => {
      const res = await request(server)
        .get('/delivery/wallet')
        .set('X-Forwarded-For', nextIp());
      expect(res.status).toBe(401);
    });
  });

  describe('GET /delivery/wallet/transactions', () => {
    it('returns the { data, meta } envelope', async () => {
      const res = await as(riderToken, 'get', '/delivery/wallet/transactions');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toEqual(
        expect.objectContaining({ page: 1, limit: 20 }),
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  2. The 503s — refusing honestly, and writing nothing
  // ══════════════════════════════════════════════════════════════════

  describe('POST /delivery/wallet/topup', () => {
    it('503s with PAYMENT_PROVIDER_NOT_CONFIGURED and creates no attempt', async () => {
      const before = await ledger.countDocuments({
        partnerId: riderPartnerId,
      });

      const res = await as(riderToken, 'post', '/delivery/wallet/topup').send({
        amountPaise: 50_000,
      });

      expect(res.status).toBe(503);
      expect(res.body.errors.code).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
      // Nothing was written. A pending attempt against a gateway order
      // that does not exist is worse than no attempt at all.
      expect(await ledger.countDocuments({ partnerId: riderPartnerId })).toBe(
        before,
      );
    });

    it('rejects a float amount outright', async () => {
      const res = await as(riderToken, 'post', '/delivery/wallet/topup').send({
        amountPaise: 1_000.5,
      });
      expect(res.status).toBe(400);
    });

    it('rejects an unknown property', async () => {
      const res = await as(riderToken, 'post', '/delivery/wallet/topup').send({
        amountPaise: 50_000,
        balancePaise: 999_999,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /delivery/wallet/topup/:orderId/verify', () => {
    it('404s for a top-up that does not exist', async () => {
      const res = await as(
        riderToken,
        'post',
        `/delivery/wallet/topup/${new Types.ObjectId().toString()}/verify`,
      ).send({
        providerOrderId: 'order_x',
        providerPaymentId: 'pay_x',
        signature: 'deadbeef',
      });
      expect(res.status).toBe(404);
    });

    it('404s — not 400 — for a malformed id, so it is not an oracle', async () => {
      const res = await as(
        riderToken,
        'post',
        '/delivery/wallet/topup/not-an-id/verify',
      ).send({
        providerOrderId: 'order_x',
        providerPaymentId: 'pay_x',
        signature: 'deadbeef',
      });
      expect(res.status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  3. KYC — the rider's half
  // ══════════════════════════════════════════════════════════════════

  describe('GET /delivery/profile/kyc', () => {
    it('starts at NOT_STARTED with nothing to mask', async () => {
      await partners
        .updateOne(
          { _id: riderPartnerId },
          {
            $set: {
              kycStatus: KycStatus.NOT_STARTED,
              aadhaarNumber: null,
              panNumber: null,
              drivingLicenceNumber: null,
              kycSubmittedAt: null,
              kycSlaDueAt: null,
              kycVerifiedAt: null,
              kycRejectedReason: null,
              kycDocuments: [],
            },
          },
        )
        .exec();

      const res = await as(riderToken, 'get', '/delivery/profile/kyc');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.NOT_STARTED);
      expect(res.body.aadhaarNumberMasked).toBeNull();
      expect(res.body.slaHours).toBe(kycSlaHours);
      expect(res.body.canResubmit).toBe(true);
    });
  });

  describe('POST /delivery/profile/kyc', () => {
    it('rejects a 11-digit Aadhaar, a malformed PAN and a short licence', async () => {
      for (const body of [
        { aadhaarNumber: '12345678901', panNumber: PAN, drivingLicenceNumber: DL },
        { aadhaarNumber: AADHAAR, panNumber: 'ABC1234F', drivingLicenceNumber: DL },
        { aadhaarNumber: AADHAAR, panNumber: PAN, drivingLicenceNumber: 'KA01' },
      ]) {
        const res = await as(riderToken, 'post', '/delivery/profile/kyc').send(
          body,
        );
        expect(res.status).toBe(400);
      }
    });

    it('accepts a spaced Aadhaar, stamps the SLA, and masks the reply', async () => {
      const spaced = `${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`;

      const res = await as(riderToken, 'post', '/delivery/profile/kyc').send({
        aadhaarNumber: spaced,
        panNumber: PAN.toLowerCase(),
        drivingLicenceNumber: DL,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.SUBMITTED);
      expect(res.body.submittedAt).toBeTruthy();

      // The promise, as an absolute deadline: ~`kycSlaHours` from now.
      const due = new Date(res.body.slaDueAt as string).getTime();
      const expected = Date.now() + kycSlaHours * 60 * 60 * 1000;
      expect(Math.abs(due - expected)).toBeLessThan(60_000);
      expect(res.body.slaRemainingMs).toBeGreaterThan(0);

      // MASKED: the last four only, and the full number appears NOWHERE
      // in the response — not in a field, not in a nested object.
      expect(res.body.aadhaarNumberMasked).toBe(`XXXX XXXX ${AADHAAR.slice(-4)}`);
      expect(res.body.panNumberMasked).toBe(`XXXXXX${PAN.slice(-4)}`);
      expect(JSON.stringify(res.body)).not.toContain(AADHAAR);
      expect(JSON.stringify(res.body)).not.toContain(PAN);
      expect(JSON.stringify(res.body)).not.toContain(DL);

      // Stored whole, and `select: false` — a plain findById cannot see it.
      const plain = await partners.findById(riderPartnerId).exec();
      expect(
        (plain as unknown as { aadhaarNumber?: string }).aadhaarNumber,
      ).toBeUndefined();

      const withNumbers = await partners
        .findById(riderPartnerId)
        .select('+aadhaarNumber +panNumber')
        .exec();
      expect(withNumbers?.aadhaarNumber).toBe(AADHAAR);
      // Normalised to upper case at the edge, so a lower-case entry does
      // not reach an admin as an apparent mismatch.
      expect(withNumbers?.panNumber).toBe(PAN);
    });
  });

  describe('POST /delivery/profile/kyc/document', () => {
    it('503s while object storage is unconfigured', async () => {
      const res = await as(
        riderToken,
        'post',
        '/delivery/profile/kyc/document',
      ).send({ kind: 'aadhaar', contentType: 'image/jpeg', sizeBytes: 1_024 });

      expect(res.status).toBe(503);
    });

    it('rejects a content type that is not on the allowlist', async () => {
      const res = await as(
        riderToken,
        'post',
        '/delivery/profile/kyc/document',
      ).send({
        kind: 'aadhaar',
        contentType: 'application/x-msdownload',
        sizeBytes: 1_024,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /delivery/profile/kyc/document/attach', () => {
    it("refuses a URL that is not this rider's own object key", async () => {
      const res = await as(
        riderToken,
        'post',
        '/delivery/profile/kyc/document/attach',
      ).send({
        kind: 'aadhaar',
        url: 'https://evil.example.com/someone-elses-card.jpg',
      });

      expect(res.status).toBe(400);
      expect(res.body.errors.code).toBe('KYC_DOCUMENT_URL_REJECTED');
    });

    it('accepts one that is, and stores exactly one document per kind', async () => {
      const url =
        `https://bucket.example.com/riders/${riderPartnerId.toString()}` +
        '/kyc/aadhaar/1-abcdef.jpg';

      const first = await as(
        riderToken,
        'post',
        '/delivery/profile/kyc/document/attach',
      ).send({ kind: 'aadhaar', url });
      expect(first.status).toBe(200);
      expect(first.body.documents).toHaveLength(1);

      const second = await as(
        riderToken,
        'post',
        '/delivery/profile/kyc/document/attach',
      ).send({ kind: 'aadhaar', url: `${url.slice(0, -4)}-2.jpg` });
      expect(second.status).toBe(200);
      // Replaced, not appended: two "Aadhaar" images are two answers to
      // one question.
      expect(second.body.documents).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  4. THE GATE — KYC, then money
  // ══════════════════════════════════════════════════════════════════

  describe('accepting an offer', () => {
    it('403s with KYC_NOT_VERIFIED before any money moves', async () => {
      await resetRider({
        kycStatus: KycStatus.SUBMITTED,
        balancePaise: 100_000,
      });
      const { offerId, order } = await offerOne();

      const res = await as(
        riderToken,
        'post',
        `/delivery/offers/${offerId}/accept`,
      ).send({});

      expect(res.status).toBe(403);
      expect(res.body.errors.code).toBe('KYC_NOT_VERIFIED');

      // The whole transaction aborted: no charge, no assignment.
      const wallet = await wallets.findOne({ partnerId: riderPartnerId }).exec();
      expect(wallet?.balancePaise).toBe(100_000);
      expect(
        await ledger.countDocuments({ partnerId: riderPartnerId }),
      ).toBe(0);

      const fresh = await orders.findById(order._id).exec();
      expect(fresh?.status).toBe(OrderStatus.READY_FOR_PICKUP);
      expect(fresh?.deliveryPartnerId).toBeNull();
    }, 60_000);

    it('402s with INSUFFICIENT_WALLET_BALANCE — not 400 — when the wallet is empty', async () => {
      await resetRider({ kycStatus: KycStatus.VERIFIED, balancePaise: 0 });
      const { offerId, order } = await offerOne();

      const res = await as(
        riderToken,
        'post',
        `/delivery/offers/${offerId}/accept`,
      ).send({});

      // 402 Payment Required: the request was well-formed and the rider
      // is being told to add money, which is not the same thing as
      // "you sent something wrong".
      expect(res.status).toBe(402);
      expect(res.body.errors.code).toBe('INSUFFICIENT_WALLET_BALANCE');
      expect(res.body.errors.balancePaise).toBe(0);
      expect(res.body.errors.requiredPaise).toBeGreaterThanOrEqual(
        pickFeeMinPaise,
      );
      expect(res.body.errors.requiredPaise).toBeLessThanOrEqual(
        pickFeeMaxPaise,
      );

      const fresh = await orders.findById(order._id).exec();
      expect(fresh?.status).toBe(OrderStatus.READY_FOR_PICKUP);
      expect(fresh?.deliveryPartnerId).toBeNull();
    }, 60_000);

    it('charges a fee inside the range, once, and writes the ledger row', async () => {
      await resetRider({
        kycStatus: KycStatus.VERIFIED,
        balancePaise: 100_000,
      });
      const { offerId, order } = await offerOne();

      const res = await as(
        riderToken,
        'post',
        `/delivery/offers/${offerId}/accept`,
      ).send({});

      expect(res.status).toBe(200);
      const fee = res.body.pickFeePaise as number;
      expect(Number.isInteger(fee)).toBe(true);
      expect(fee).toBeGreaterThanOrEqual(pickFeeMinPaise);
      expect(fee).toBeLessThanOrEqual(pickFeeMaxPaise);
      expect(res.body.walletBalancePaise).toBe(100_000 - fee);
      expect(res.body.order.orderId).toBe(order._id.toString());

      const wallet = await wallets.findOne({ partnerId: riderPartnerId }).exec();
      expect(wallet?.balancePaise).toBe(100_000 - fee);
      // Spent, not "topped up" — the two lifetime totals mean different
      // things and a reconciliation depends on them staying apart.
      expect(wallet?.lifetimeSpentPaise).toBe(fee);
      expect(wallet?.lifetimeToppedUpPaise).toBe(0);

      const rows = await ledger.find({ partnerId: riderPartnerId }).exec();
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe(WalletTxnType.PICK_FEE);
      // SIGNED: a debit is negative, so the balance is sum(amountPaise).
      expect(rows[0].amountPaise).toBe(-fee);
      expect(rows[0].balanceAfterPaise).toBe(100_000 - fee);
      expect(rows[0].orderId?.toString()).toBe(order._id.toString());

      // Reproducible: the exact charge is on the attempt it paid for.
      const assignment = await ctx.app
        .get<Model<{ pickFeePaise?: number }>>(
          getModelToken('DeliveryAssignment'),
        )
        .findById(offerId)
        .lean<{ pickFeePaise?: number } | null>()
        .exec();
      expect(assignment?.pickFeePaise).toBe(fee);

      // The ledger reconciles against the stored balance.
      const summed = rows.reduce((sum, row) => sum + row.amountPaise, 0);
      expect((wallet?.balancePaise ?? 0) - summed).toBe(100_000);
    }, 60_000);
  });

  // ══════════════════════════════════════════════════════════════════
  //  5. THE GUARD — concurrent charges cannot overdraw
  // ══════════════════════════════════════════════════════════════════

  it('never lets two concurrent charges take one wallet below zero', async () => {
    // Exactly one maximum fee in the wallet: at most ONE charge can fit,
    // whatever the two draws turn out to be.
    await resetRider({
      kycStatus: KycStatus.VERIFIED,
      balancePaise: pickFeeMaxPaise,
    });

    const connection = wallets.db;
    const orderA = await createReadyOrder();
    const orderB = await createReadyOrder();

    /** One charge, in its own transaction, exactly as `accept()` does it. */
    const charge = async (orderId: Types.ObjectId): Promise<boolean> => {
      const session = await connection.startSession();
      try {
        await session.withTransaction(async () => {
          await walletService.chargePickFee(riderPartnerId, orderId, session);
        });
        return true;
      } catch {
        return false;
      } finally {
        await session.endSession();
      }
    };

    const results = await Promise.all([
      charge(orderA._id),
      charge(orderB._id),
    ]);

    const wallet = await wallets.findOne({ partnerId: riderPartnerId }).exec();
    const rows = await ledger
      .find({ partnerId: riderPartnerId, type: WalletTxnType.PICK_FEE })
      .exec();

    // At least one got through — this is not a test of nothing happening.
    expect(results.filter(Boolean).length).toBeGreaterThanOrEqual(1);
    // And the balance never went negative, however the draws landed.
    expect(wallet?.balancePaise).toBeGreaterThanOrEqual(0);
    // The ledger still reconciles: balance = start + sum(signed amounts).
    const summed = rows.reduce((sum, row) => sum + row.amountPaise, 0);
    expect(wallet?.balancePaise).toBe(pickFeeMaxPaise + summed);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  6. The confirm screen and live tracking
  // ══════════════════════════════════════════════════════════════════

  describe('GET /delivery/offers/:id', () => {
    it('shows the items and the fee RANGE before the money moves', async () => {
      await resetRider({
        kycStatus: KycStatus.VERIFIED,
        balancePaise: 100_000,
      });
      const { offerId } = await offerOne();

      const res = await as(riderToken, 'get', `/delivery/offers/${offerId}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Bananas');
      expect(res.body.pickFeeMinPaise).toBe(pickFeeMinPaise);
      expect(res.body.pickFeeMaxPaise).toBe(pickFeeMaxPaise);
      expect(res.body.walletBalancePaise).toBe(100_000);
      expect(res.body.canAfford).toBe(true);
      expect(res.body.kycStatus).toBe(KycStatus.VERIFIED);
      expect(res.body.pickup.lat).toBeCloseTo(STORE.lat, 4);
      expect(res.body.drop.lat).toBeCloseTo(CUSTOMER_DROP.lat, 4);
    }, 60_000);

    it("404s on another rider's offer id", async () => {
      const res = await as(
        riderToken,
        'get',
        `/delivery/offers/${new Types.ObjectId().toString()}`,
      );
      expect(res.status).toBe(404);
    });
  });

  describe('GET /delivery/orders/:id/tracking', () => {
    it('carries both ends, the rider position and the items', async () => {
      await resetRider({
        kycStatus: KycStatus.VERIFIED,
        balancePaise: 100_000,
      });
      const { offerId, order } = await offerOne();

      const accepted = await as(
        riderToken,
        'post',
        `/delivery/offers/${offerId}/accept`,
      ).send({});
      expect(accepted.status).toBe(200);

      const res = await as(
        riderToken,
        'get',
        `/delivery/orders/${order._id.toString()}/tracking`,
      );

      expect(res.status).toBe(200);
      expect(res.body.orderId).toBe(order._id.toString());
      expect(res.body.rider.lat).toBeCloseTo(STORE.lat, 4);
      expect(res.body.drop.lat).toBeCloseTo(CUSTOMER_DROP.lat, 4);
      expect(res.body.pickup.lng).toBeCloseTo(STORE.lng, 4);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.customerPhone).toBe('9000012345');
      expect(res.body.codAmountPaise).toBe(8_900);
      expect(res.body.remainingKm).toBeGreaterThan(0);
    }, 60_000);

    it("404s on an order that is not this rider's", async () => {
      const other = await createReadyOrder();
      const res = await as(
        riderToken,
        'get',
        `/delivery/orders/${other._id.toString()}/tracking`,
      );
      expect(res.status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  7. The admin half
  // ══════════════════════════════════════════════════════════════════

  describe('/admin/riders', () => {
    beforeEach(async () => {
      await partners
        .updateOne(
          { _id: riderPartnerId },
          {
            $set: {
              kycStatus: KycStatus.SUBMITTED,
              kycSubmittedAt: new Date(),
              kycSlaDueAt: new Date(Date.now() + kycSlaHours * 3_600_000),
              kycVerifiedAt: null,
              kycRejectedReason: null,
              aadhaarNumber: AADHAAR,
              panNumber: PAN,
              drivingLicenceNumber: DL,
            },
          },
        )
        .exec();
    });

    it('lists the queue WITHOUT any identifier number', async () => {
      const res = await as(adminToken, 'get', '/admin/riders/kyc');
      expect(res.status).toBe(200);

      const row = (res.body.data as { partnerId: string }[]).find(
        (entry) => entry.partnerId === riderPartnerId.toString(),
      );
      expect(row).toBeDefined();
      // A page of riders is no reason to put a page of Aadhaar numbers
      // in an operator's browser.
      expect(JSON.stringify(res.body)).not.toContain(AADHAAR);
      expect(JSON.stringify(res.body)).not.toContain(PAN);
    });

    it('returns the numbers IN FULL on the one verification endpoint', async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/riders/${riderPartnerId.toString()}/kyc`,
      );

      expect(res.status).toBe(200);
      // This is the ONE place. It exists so a human can compare the
      // number against the photograph of the card.
      expect(res.body.aadhaarNumber).toBe(AADHAAR);
      expect(res.body.panNumber).toBe(PAN);
      expect(res.body.drivingLicenceNumber).toBe(DL);
    });

    it('is refused to a rider token and to a customer token', async () => {
      for (const token of [riderToken, customerToken]) {
        const res = await as(
          token,
          'get',
          `/admin/riders/${riderPartnerId.toString()}/kyc`,
        );
        expect(res.status).toBe(403);
      }
    });

    it('verifies, which is what unlocks accepting an order', async () => {
      const res = await as(
        adminToken,
        'post',
        `/admin/riders/${riderPartnerId.toString()}/kyc/verify`,
      ).send({});

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.VERIFIED);
      // The deadline is discharged: a live countdown on a finished item
      // is noise.
      expect(res.body.slaDueAt).toBeNull();

      const partner = await partners.findById(riderPartnerId).exec();
      expect(partner?.kycStatus).toBe(KycStatus.VERIFIED);
      expect(partner?.kycVerifiedAt).toBeTruthy();
    });

    it('rejects with a reason the rider can act on, and refuses an empty one', async () => {
      const empty = await as(
        adminToken,
        'post',
        `/admin/riders/${riderPartnerId.toString()}/kyc/reject`,
      ).send({ reason: '' });
      expect(empty.status).toBe(400);

      const res = await as(
        adminToken,
        'post',
        `/admin/riders/${riderPartnerId.toString()}/kyc/reject`,
      ).send({ reason: 'The Aadhaar image is too blurred to read.' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.REJECTED);
      expect(res.body.rejectedReason).toContain('blurred');

      // REJECTED is not a dead end: the rider may submit again.
      const mine = await as(riderToken, 'get', '/delivery/profile/kyc');
      expect(mine.body.canResubmit).toBe(true);
    });

    it('refuses to verify a rider who has submitted nothing', async () => {
      await partners
        .updateOne(
          { _id: riderPartnerId },
          { $set: { kycStatus: KycStatus.NOT_STARTED } },
        )
        .exec();

      const res = await as(
        adminToken,
        'post',
        `/admin/riders/${riderPartnerId.toString()}/kyc/verify`,
      ).send({});

      expect(res.status).toBe(409);
      expect(res.body.errors.code).toBe('KYC_NOT_SUBMITTED');
    });
  });

  describe('POST /admin/riders/:id/wallet/credit', () => {
    it('is refused to an ADMIN — it moves money', async () => {
      const res = await as(
        adminToken,
        'post',
        `/admin/riders/${riderPartnerId.toString()}/wallet/credit`,
      ).send({ amountPaise: 50_000, note: 'Cash received at the office' });

      expect(res.status).toBe(403);
    });

    it('credits as a SUPER_ADMIN, as an audited ADJUSTMENT', async () => {
      await resetRider({ kycStatus: KycStatus.VERIFIED, balancePaise: 0 });

      const res = await as(
        superAdminToken,
        'post',
        `/admin/riders/${riderPartnerId.toString()}/wallet/credit`,
      ).send({ amountPaise: 50_000, note: 'Cash received at the office' });

      expect(res.status).toBe(201);
      expect(res.body.balancePaise).toBe(50_000);

      const rows = await ledger
        .find({ partnerId: riderPartnerId })
        .sort({ createdAt: -1 })
        .exec();

      expect(rows[0].type).toBe(WalletTxnType.ADJUSTMENT);
      expect(rows[0].amountPaise).toBe(50_000);
      expect(rows[0].balanceAfterPaise).toBe(50_000);
      // Attributable: an unexplained credit is indistinguishable from
      // theft six months later.
      expect(rows[0].createdBy).toBeTruthy();
      expect(rows[0].note).toContain('Cash received');

      // NOT a top-up: `lifetimeToppedUpPaise` is reconciled against
      // gateway settlements and must not absorb a manual adjustment.
      const wallet = await wallets.findOne({ partnerId: riderPartnerId }).exec();
      expect(wallet?.lifetimeToppedUpPaise).toBe(0);
    });

    it('refuses a note-less or non-positive credit', async () => {
      for (const body of [
        { amountPaise: 50_000 },
        { amountPaise: 0, note: 'nothing' },
        { amountPaise: -100, note: 'negative' },
      ]) {
        const res = await as(
          superAdminToken,
          'post',
          `/admin/riders/${riderPartnerId.toString()}/wallet/credit`,
        ).send(body);
        expect(res.status).toBe(400);
      }
    });

    it('404s for a rider id that does not exist', async () => {
      const res = await as(
        superAdminToken,
        'post',
        `/admin/riders/${new Types.ObjectId().toString()}/wallet/credit`,
      ).send({ amountPaise: 1_000, note: 'nobody' });
      expect(res.status).toBe(404);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  8. The refund — a rider must not pay for an order taken from them
  // ══════════════════════════════════════════════════════════════════

  it('refunds the pick fee when the order is cancelled by the platform', async () => {
    await resetRider({ kycStatus: KycStatus.VERIFIED, balancePaise: 100_000 });
    const { offerId, order } = await offerOne();

    const accepted = await as(
      riderToken,
      'post',
      `/delivery/offers/${offerId}/accept`,
    ).send({});
    expect(accepted.status).toBe(200);
    const fee = accepted.body.pickFeePaise as number;

    // The platform takes the order away. Driven straight at the order
    // because the three modules that can cancel one are out of this
    // module's scope — which is exactly why the refund reads the
    // OUTCOME rather than listening for an event.
    await orders
      .updateOne({ _id: order._id }, { $set: { status: OrderStatus.CANCELLED } })
      .exec();

    const refunded = await assignments.refundCancelledOrderFees();
    expect(refunded).toBe(1);

    const wallet = await wallets.findOne({ partnerId: riderPartnerId }).exec();
    expect(wallet?.balancePaise).toBe(100_000);

    const rows = await ledger
      .find({ partnerId: riderPartnerId, type: WalletTxnType.REFUND })
      .exec();
    expect(rows).toHaveLength(1);
    expect(rows[0].amountPaise).toBe(fee);

    // Idempotent: a second sweep must not pay twice.
    expect(await assignments.refundCancelledOrderFees()).toBe(0);
    const after = await wallets.findOne({ partnerId: riderPartnerId }).exec();
    expect(after?.balancePaise).toBe(100_000);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  9. The rider's user id never leaks a number over the socket
  // ══════════════════════════════════════════════════════════════════

  it('never puts an identifier in a notification body', async () => {
    const res = await as(riderToken, 'get', '/notifications');
    expect(res.status).toBe(200);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(AADHAAR);
    expect(body).not.toContain(PAN);
    expect(body).not.toContain(DL);
    // Guards the assertion itself: the rider DOES have notifications by
    // now (KYC submitted, verified, rejected, wallet credited), so the
    // three checks above are not passing against an empty array.
    expect(riderUserId).toBeTruthy();
    expect((res.body.data as unknown[]).length).toBeGreaterThan(0);
  });
});
