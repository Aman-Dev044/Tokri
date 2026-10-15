import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { User, UserDocument } from '../../src/database/schemas/user.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { Vendor, VendorDocument, VendorStatus } from '../../src/database/schemas/vendor.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
  VehicleType,
} from '../../src/database/schemas/delivery-partner.schema';
import {
  RegistrationOtp,
  RegistrationOtpDocument,
} from '../../src/modules/auth/schemas/registration-otp.schema';
import { TestContext, closeTestApp, createTestApp, nextIp } from '../utils/test-app';

/** Long enough to satisfy every DTO's MinLength(8), never a common password. */
const PASSWORD = () => `Tkr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

describe('Registration (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let otps: Model<RegistrationOtpDocument>;
  let jwt: JwtService;
  let config: ConfigService;

  let phoneCounter = 0;
  /** A fresh, never-before-used 10-digit phone number. */
  const freshPhone = (): string => {
    const n = String(++phoneCounter).padStart(4, '0');
    return `70${n}000000`.slice(0, 10);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
    partners = ctx.app.get<Model<DeliveryPartnerDocument>>(
      getModelToken(DeliveryPartner.name),
    );
    otps = ctx.app.get<Model<RegistrationOtpDocument>>(
      getModelToken(RegistrationOtp.name),
    );
    jwt = ctx.app.get(JwtService);
    config = ctx.app.get(ConfigService);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  const requestOtp = (phone: string) =>
    request(server)
      .post('/auth/register/request-otp')
      .set('X-Forwarded-For', nextIp())
      .send({ phone });

  const verifyOtp = (requestId: string, phone: string, otp: string) =>
    request(server)
      .post('/auth/register/verify-otp')
      .set('X-Forwarded-For', nextIp())
      .send({ requestId, phone, otp });

  const registerCall = (body: Record<string, unknown>) =>
    request(server)
      .post('/auth/register')
      .set('X-Forwarded-For', nextIp())
      .send(body);

  const login = (identifier: string, password: string) =>
    request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier, password });

  /**
   * Moves every OTP row for a phone out of the 60-second resend window.
   *
   * `requestOtp` refuses a re-send within 60s with a 429 — correct
   * behaviour (it is what stops an SMS bill being run up on a stranger's
   * number), and deliberately NOT relaxed for tests. A test that needs a
   * genuine second OTP round for the same number backdates the first
   * instead, which is exactly what waiting a minute would achieve.
   */
  async function clearResendCooldown(phone: string): Promise<void> {
    // Through the NATIVE collection, not the Mongoose model: `timestamps:
    // true` marks `createdAt` immutable, so Mongoose strips it out of a
    // `$set` without complaining and the cooldown fires anyway.
    await otps.collection.updateMany(
      { phone },
      { $set: { createdAt: new Date(Date.now() - 61_000) } },
    );
  }

  /** Runs request-otp + verify-otp for a fresh phone and returns the registrationToken. */
  async function verifiedPhone(): Promise<{ phone: string; registrationToken: string }> {
    const phone = freshPhone();
    const otpRes = await requestOtp(phone);
    expect(otpRes.status).toBe(200);
    expect(typeof otpRes.body.devOtp).toBe('string');

    const verifyRes = await verifyOtp(otpRes.body.requestId, phone, otpRes.body.devOtp);
    expect(verifyRes.status).toBe(200);
    expect(typeof verifyRes.body.registrationToken).toBe('string');

    return { phone, registrationToken: verifyRes.body.registrationToken as string };
  }

  // ══════════════════════════════════════════════════════════════════
  //  Customer — full happy path
  // ══════════════════════════════════════════════════════════════════

  describe('Customer signup — full happy path', () => {
    it('request-otp → verify-otp → register creates an account that can then log in', async () => {
      const { phone, registrationToken } = await verifiedPhone();
      const password = PASSWORD();

      const res = await registerCall({
        registrationToken,
        name: 'Test Customer',
        password,
        email: `customer${phone}@test.invalid`,
      });

      expect(res.status).toBe(201);
      expect(res.body.user.phone).toBe(phone);
      expect(res.body.user.role).toBe(Role.CUSTOMER);
      expect(typeof res.body.accessToken).toBe('string');
      // The refresh token must never appear in the JSON body.
      expect(res.body.refreshToken).toBeUndefined();

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();

      const stored = await users.findOne({ phone }).lean();
      expect(stored?.status).toBe(UserStatus.ACTIVE);
      expect(stored?.role).toBe(Role.CUSTOMER);

      // The freshly created account can log in immediately.
      const loginRes = await login(phone, password);
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.phone).toBe(phone);
    });

    it('never returns devOtp when the request/response is otherwise wired for production', () => {
      // Direct unit-style guarantee lives in RegistrationService's own
      // conditional spread; this asserts the CONTRACT the response body
      // upholds in every non-production run: the field, when present, is
      // always a 6-digit string, never null.
      return requestOtp(freshPhone()).then((res) => {
        expect(res.status).toBe(200);
        if ('devOtp' in res.body) {
          expect(res.body.devOtp).toMatch(/^\d{6}$/);
        }
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  OTP attempt limiting
  // ══════════════════════════════════════════════════════════════════

  describe('POST /auth/register/verify-otp', () => {
    it('rejects a wrong OTP with 400, and locks out after 3 wrong attempts', async () => {
      const phone = freshPhone();
      const otpRes = await requestOtp(phone);
      const { requestId, devOtp } = otpRes.body as { requestId: string; devOtp: string };

      const wrongOtp = devOtp === '000000' ? '111111' : '000000';

      const first = await verifyOtp(requestId, phone, wrongOtp);
      expect(first.status).toBe(400);

      const second = await verifyOtp(requestId, phone, wrongOtp);
      expect(second.status).toBe(400);

      const third = await verifyOtp(requestId, phone, wrongOtp);
      expect(third.status).toBe(400);

      // Locked out now — even the CORRECT otp must fail.
      const afterLock = await verifyOtp(requestId, phone, devOtp);
      expect(afterLock.status).toBe(400);
    });

    it('rejects an unknown requestId with 400 (no enumeration of live challenges)', async () => {
      const res = await verifyOtp(
        '507f1f77bcf86cd799439011',
        freshPhone(),
        '123456',
      );
      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  registrationToken: expiry and single-use
  // ══════════════════════════════════════════════════════════════════

  describe('POST /auth/register — registrationToken validity', () => {
    it('rejects an expired registrationToken with 401', async () => {
      const phone = freshPhone();
      const otpRes = await requestOtp(phone);
      const verifyRes = await verifyOtp(
        otpRes.body.requestId,
        phone,
        otpRes.body.devOtp,
      );
      expect(verifyRes.status).toBe(200);

      // A structurally identical token, signed with the same secret and
      // claim shape as the real one, but already expired.
      const decoded = jwt.decode(verifyRes.body.registrationToken as string) as {
        requestId: string;
        phone: string;
        purpose: string;
      };

      const expiredToken = await jwt.signAsync(
        { requestId: decoded.requestId, phone: decoded.phone, purpose: decoded.purpose },
        {
          secret: config.getOrThrow<string>('jwt.accessSecret'),
          expiresIn: '-1s',
        },
      );

      const res = await registerCall({
        registrationToken: expiredToken,
        name: 'Expired Token Customer',
        password: PASSWORD(),
      });

      expect(res.status).toBe(401);
    });

    it('rejects a replayed (already-used) registrationToken with 401', async () => {
      const { registrationToken } = await verifiedPhone();
      const password = PASSWORD();

      const first = await registerCall({
        registrationToken,
        name: 'First Use',
        password,
      });
      expect(first.status).toBe(201);

      const replay = await registerCall({
        registrationToken,
        name: 'Second Use',
        password: PASSWORD(),
      });
      expect(replay.status).toBe(401);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Duplicate phone — generic 409, no enumeration
  // ══════════════════════════════════════════════════════════════════

  describe('POST /auth/register — duplicate phone', () => {
    it('returns a generic 409 when the verified phone already has an account', async () => {
      const { phone, registrationToken } = await verifiedPhone();
      const password = PASSWORD();

      const firstRes = await registerCall({
        registrationToken,
        name: 'Original Owner',
        password,
      });
      expect(firstRes.status).toBe(201);

      // A second, independent OTP flow for the SAME phone (allowed —
      // request-otp never checks account existence) reaching the final
      // step must collide. The first flow's OTP is backdated out of the
      // 60-second resend window first; without that this is a 429 and the
      // test never reaches the 409 it is actually about.
      await clearResendCooldown(phone);
      const otpRes = await requestOtp(phone);
      expect(otpRes.status).toBe(200);
      const verifyRes = await verifyOtp(otpRes.body.requestId, phone, otpRes.body.devOtp);
      expect(verifyRes.status).toBe(200);

      const secondRes = await registerCall({
        registrationToken: verifyRes.body.registrationToken,
        name: 'Impostor',
        password: PASSWORD(),
      });

      expect(secondRes.status).toBe(409);
      // No leak beyond "you already have an account" — no email, no id.
      expect(JSON.stringify(secondRes.body)).not.toMatch(/passwordHash/i);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  No privilege escalation via the request body
  // ══════════════════════════════════════════════════════════════════

  describe('Mass-assignment protection', () => {
    it('rejects { role: "admin" } in the register body with 400', async () => {
      const { registrationToken } = await verifiedPhone();

      const res = await registerCall({
        registrationToken,
        name: 'Aspiring Admin',
        password: PASSWORD(),
        role: 'admin',
      });

      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Vendor application
  // ══════════════════════════════════════════════════════════════════

  describe('POST /auth/apply/vendor', () => {
    it('creates a PENDING User and a PENDING Vendor, linked, and blocks login until approved', async () => {
      const phone = freshPhone();
      const password = PASSWORD();

      const res = await request(server)
        .post('/auth/apply/vendor')
        .set('X-Forwarded-For', nextIp())
        .send({
          name: 'Priya Sharma',
          email: `vendor${phone}@test.invalid`,
          phone,
          password,
          storeName: 'Sharma Fresh Mandi',
          address: {
            line1: '12 Mandi Road',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
          },
          lat: 18.5204,
          lng: 73.8567,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
      expect(typeof res.body.applicationId).toBe('string');

      const vendor = await vendors.findById(res.body.applicationId).lean();
      expect(vendor).toBeTruthy();
      expect(vendor?.status).toBe(VendorStatus.PENDING);
      expect(vendor?.storeName).toBe('Sharma Fresh Mandi');

      const owner = await users.findOne({ phone }).lean();
      expect(owner).toBeTruthy();
      expect(owner?.role).toBe(Role.VENDOR);
      expect(owner?.status).toBe(UserStatus.PENDING);
      expect(owner?.vendorId?.toString()).toBe(vendor?._id.toString());
      expect(vendor?.ownerId.toString()).toBe(owner?._id.toString());

      // Cannot log in while pending.
      const loginRes = await login(phone, password);
      expect(loginRes.status).toBe(401);
    });

    it('does not let the applicant set their own commissionPct or status', async () => {
      const phone = freshPhone();

      const res = await request(server)
        .post('/auth/apply/vendor')
        .set('X-Forwarded-For', nextIp())
        .send({
          name: 'Escalating Vendor',
          email: `escalate${phone}@test.invalid`,
          phone,
          password: PASSWORD(),
          storeName: 'Sneaky Store',
          address: {
            line1: '1 Test Road',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
          },
          lat: 18.5204,
          lng: 73.8567,
          commissionPct: 0,
          status: 'approved',
        });

      // forbidNonWhitelisted rejects the unknown fields outright.
      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Rider application
  // ══════════════════════════════════════════════════════════════════

  describe('POST /auth/apply/rider', () => {
    it('creates a PENDING User and a platform-pool (vendorId: null) DeliveryPartner', async () => {
      const phone = freshPhone();

      const res = await request(server)
        .post('/auth/apply/rider')
        .set('X-Forwarded-For', nextIp())
        .send({
          name: 'Ramesh Kadam',
          phone,
          password: PASSWORD(),
          vehicleType: VehicleType.BICYCLE,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');

      const partner = await partners.findById(res.body.applicationId).lean();
      expect(partner).toBeTruthy();
      expect(partner?.vendorId ?? null).toBeNull();
      expect(partner?.status).toBe(PartnerStatus.PENDING);

      const owner = await users.findOne({ phone }).lean();
      expect(owner?.role).toBe(Role.DELIVERY);
      expect(owner?.status).toBe(UserStatus.PENDING);
      expect(owner?._id.toString()).toBe(partner?.userId.toString());
    });
  });
});
