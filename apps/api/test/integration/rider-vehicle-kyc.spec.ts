import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { User, UserDocument } from '../../src/database/schemas/user.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  KYC_NUMBER_FIELDS,
  KycStatus,
  PartnerStatus,
  VehicleType,
} from '../../src/database/schemas/delivery-partner.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/** Generated per run, never a literal. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Real-shaped but fictional identifiers, GENERATED per run — the same
 * discipline as `rider-wallet-kyc.spec.ts`. `N4` is the tail every
 * masked value must end in, and the whole value must appear nowhere.
 */
const N4 = String(Date.now()).slice(-4);
const AADHAAR = `8${String(Date.now()).slice(-11)}`.slice(0, 12);
const PAN = 'PQRST6789U';
const DL = `DL08${String(Date.now()).slice(-11)}`.slice(0, 15);

/** As a rider types them … */
const PLATE_TYPED = `dl 8s-ab ${N4}`;
const RC_TYPED = `dl08 2023-${N4}77`;
const POLICY_TYPED = ` 3005/${N4}5678/00/001 `;
/** … and as they must be stored. */
const PLATE = `DL8SAB${N4}`;
const RC = `DL082023${N4}77`;
const POLICY = `3005/${N4}5678/00/001`;

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60_000;

/** `YYYY-MM-DD` for today in India, plus `offset` days. */
function istDay(offset: number): string {
  return new Date(Date.now() + IST_OFFSET_MS + offset * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface VehicleBody {
  vehicleRegistrationNumber: string;
  vehicleRcNumber: string;
  vehicleInsurancePolicyNumber: string;
  vehicleInsuranceExpiresOn: string;
}

const vehicle = (overrides: Partial<VehicleBody> = {}): VehicleBody => ({
  vehicleRegistrationNumber: PLATE_TYPED,
  vehicleRcNumber: RC_TYPED,
  vehicleInsurancePolicyNumber: POLICY_TYPED,
  vehicleInsuranceExpiresOn: istDay(200),
  ...overrides,
});

/**
 * ════════════════════════════════════════════════════════════════════════
 *  RIDER VEHICLE DOCUMENTS
 * ════════════════════════════════════════════════════════════════════════
 *
 *   • FORMATS     — plates normalised (`DL 8S AB 2048` → `DL8SAB2048`),
 *                   BH series accepted, junk refused with 400 before it
 *                   can cost a reviewer their SLA.
 *   • MASKING     — the rider's own view and the admin console both mask
 *                   plate, RC and policy exactly like PAN; the audited
 *                   verification route is the one place they are whole.
 *   • EXPIRY      — expired / expiring-within-30-days is computed on read
 *                   and flagged on the rider view, the admin detail and
 *                   the admin list.
 *   • RE-REVIEW   — a vehicle CHANGE sends a VERIFIED record back to
 *                   SUBMITTED; resending the same details does not.
 *   • ROLES       — a rider reads only their own record; only an admin
 *                   reads anybody else's.
 */
describe('Rider vehicle documents (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let partners: Model<DeliveryPartnerDocument>;
  let passwords: PasswordService;
  let kycSlaHours: number;

  let riderToken: string;
  let riderPartnerId: Types.ObjectId;
  let otherToken: string;
  let otherPartnerId: Types.ObjectId;
  let adminToken: string;
  let customerToken: string;

  let counter = 0;

  async function seedUser(role: Role): Promise<UserDocument> {
    const n = String(++counter).padStart(4, '0');
    return users.create({
      name: `Vehicle ${role} ${n}`,
      email: `vehicle${n}@test.invalid`,
      phone: `95${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role,
      status: UserStatus.ACTIVE,
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

  async function seedRider(): Promise<{ token: string; partnerId: Types.ObjectId }> {
    const user = await seedUser(Role.DELIVERY);
    const partner = await partners.create({
      userId: user._id,
      vehicleType: VehicleType.SCOOTER,
      status: PartnerStatus.ACTIVE,
    });
    return { token: await tokenFor(user), partnerId: partner._id };
  }

  const as = (token: string, method: Verb, path: string) =>
    request(server)
      [method](path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);

  /** Back to a blank NOT_STARTED record. */
  async function resetKyc(partnerId: Types.ObjectId): Promise<void> {
    await partners
      .updateOne(
        { _id: partnerId },
        {
          $set: {
            kycStatus: KycStatus.NOT_STARTED,
            kycSubmittedAt: null,
            kycVerifiedAt: null,
            kycRejectedReason: null,
            kycSlaDueAt: null,
            aadhaarNumber: null,
            panNumber: null,
            drivingLicenceNumber: null,
            vehicleRegistrationNumber: null,
            vehicleRcNumber: null,
            vehicleInsurancePolicyNumber: null,
            vehicleInsuranceExpiresAt: null,
            kycDocuments: [],
          },
        },
      )
      .exec();
  }

  /** Identity + vehicle, submitted through the real endpoint. */
  async function submitAll(
    token: string,
    overrides: Partial<VehicleBody> = {},
  ): Promise<request.Response> {
    const res = await as(token, 'post', '/delivery/profile/kyc').send({
      aadhaarNumber: AADHAAR,
      panNumber: PAN,
      drivingLicenceNumber: DL,
      vehicle: vehicle(overrides),
    });
    expect(res.status).toBe(200);
    return res;
  }

  async function stored(partnerId: Types.ObjectId): Promise<DeliveryPartnerDocument> {
    const partner = await partners
      .findById(partnerId)
      .select(KYC_NUMBER_FIELDS)
      .exec();
    if (!partner) throw new Error('partner vanished');
    return partner;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;

    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    partners = ctx.app.get<Model<DeliveryPartnerDocument>>(
      getModelToken(DeliveryPartner.name),
    );
    passwords = ctx.app.get(PasswordService);
    kycSlaHours = ctx.app.get(ConfigService).getOrThrow<number>('rider.kycSlaHours');

    ({ token: riderToken, partnerId: riderPartnerId } = await seedRider());
    ({ token: otherToken, partnerId: otherPartnerId } = await seedRider());
    adminToken = await tokenFor(await seedUser(Role.ADMIN));
    customerToken = await tokenFor(await seedUser(Role.CUSTOMER));
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  1. Formats and normalisation
  // ══════════════════════════════════════════════════════════════════

  describe('validation and normalisation', () => {
    beforeAll(() => resetKyc(riderPartnerId));

    it('normalises a spaced, dashed, lower-case plate, RC and policy on submission', async () => {
      const res = await submitAll(riderToken);
      expect(res.body.status).toBe(KycStatus.SUBMITTED);

      const partner = await stored(riderPartnerId);
      expect(partner.vehicleRegistrationNumber).toBe(PLATE);
      expect(partner.vehicleRcNumber).toBe(RC);
      expect(partner.vehicleInsurancePolicyNumber).toBe(POLICY);
      // Stored as the calendar day, at 00:00 UTC — and read back as one.
      expect(partner.vehicleInsuranceExpiresAt?.toISOString()).toBe(
        `${istDay(200)}T00:00:00.000Z`,
      );
      expect(res.body.vehicleInsuranceExpiresOn).toBe(istDay(200));
    });

    it.each([
      ['22 BH 1234 AA', '22BH1234AA'],
      ['21-bh-0001-c', '21BH0001C'],
      ['MH 12 AB 1234', 'MH12AB1234'],
      ['TG09C4567', 'TG09C4567'],
      ['ka 01 7', 'KA017'],
    ])('accepts %s and stores %s', async (typed, normalised) => {
      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle({ vehicleRegistrationNumber: typed }),
      );
      expect(res.status).toBe(200);
      expect((await stored(riderPartnerId)).vehicleRegistrationNumber).toBe(
        normalised,
      );
    });

    it.each<[string, Partial<VehicleBody>]>([
      ['an unknown state code', { vehicleRegistrationNumber: 'ZZ 01 AB 1234' }],
      ['a five-digit number', { vehicleRegistrationNumber: 'DL8SAB20481' }],
      ['a word', { vehicleRegistrationNumber: 'SCOOTER' }],
      ['a BH plate with three digits', { vehicleRegistrationNumber: '22BH123AA' }],
      ['a dotted plate', { vehicleRegistrationNumber: 'DL.8S.AB.2048' }],
      ['a short RC', { vehicleRcNumber: 'AB12' }],
      ['an RC with punctuation', { vehicleRcNumber: 'DL08#2023' }],
      ['a policy starting with a slash', { vehicleInsurancePolicyNumber: '/3005123456' }],
      ['a policy that is too short', { vehicleInsurancePolicyNumber: 'P1' }],
      ['a day that does not exist', { vehicleInsuranceExpiresOn: '2027-02-30' }],
      ['a day-first date', { vehicleInsuranceExpiresOn: '31-03-2027' }],
      ['a timestamp', { vehicleInsuranceExpiresOn: '2027-03-31T00:00:00Z' }],
      ['a date decades out', { vehicleInsuranceExpiresOn: '2060-01-01' }],
    ])('400s on %s, and stores nothing', async (_label, overrides) => {
      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle({ vehicleRegistrationNumber: PLATE, ...overrides }),
      );
      expect(res.status).toBe(400);
      expect((await stored(riderPartnerId)).vehicleRcNumber).toBe(RC);
    });

    it('400s on a missing field and on an unknown one', async () => {
      const { vehicleRcNumber: _dropped, ...partial } = vehicle();
      const missing = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        partial,
      );
      expect(missing.status).toBe(400);

      const extra = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send({
        ...vehicle(),
        kycStatus: KycStatus.VERIFIED,
      });
      expect(extra.status).toBe(400);
    });

    it('400s on a partial vehicle inside the identity submission', async () => {
      const res = await as(riderToken, 'post', '/delivery/profile/kyc').send({
        aadhaarNumber: AADHAAR,
        panNumber: PAN,
        drivingLicenceNumber: DL,
        vehicle: { vehicleRegistrationNumber: PLATE },
      });
      expect(res.status).toBe(400);
    });

    it('accepts an already-expired policy, and flags it rather than refusing it', async () => {
      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle({ vehicleInsuranceExpiresOn: istDay(-3) }),
      );
      expect(res.status).toBe(200);
      expect(res.body.vehicleInsuranceStatus).toBe('expired');
      expect(res.body.vehicleInsuranceDaysLeft).toBe(-3);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  2. Masking
  // ══════════════════════════════════════════════════════════════════

  describe('masking', () => {
    beforeAll(async () => {
      await resetKyc(riderPartnerId);
      await submitAll(riderToken);
    });

    const expectNoWholeNumber = (body: unknown): void => {
      const text = JSON.stringify(body);
      expect(text).not.toContain(PLATE);
      expect(text).not.toContain(RC);
      expect(text).not.toContain(POLICY);
    };

    it("masks the rider's own view exactly like PAN — the last four only", async () => {
      const res = await as(riderToken, 'get', '/delivery/profile/kyc');
      expect(res.status).toBe(200);

      expect(res.body.vehicleRegistrationNumberMasked).toBe(`XXXXXX${N4}`);
      expect(res.body.vehicleRcNumberMasked).toBe(
        `${'X'.repeat(RC.length - 4)}${RC.slice(-4)}`,
      );
      expect(res.body.vehicleInsurancePolicyNumberMasked).toBe(
        `${'X'.repeat(POLICY.length - 4)}${POLICY.slice(-4)}`,
      );
      // The same function PAN goes through, so the two read alike.
      expect(res.body.panNumberMasked).toBe(`XXXXXX${PAN.slice(-4)}`);
      expectNoWholeNumber(res.body);
    });

    it('masks the PUT reply too, not just the GET', async () => {
      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle({ vehicleInsuranceExpiresOn: istDay(201) }),
      );
      expect(res.status).toBe(200);
      expectNoWholeNumber(res.body);
    });

    it('masks the admin console detail panel, which reads the rider view', async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/delivery-partners/${riderPartnerId.toString()}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.kyc.vehicleRegistrationNumberMasked).toBe(`XXXXXX${N4}`);
      expectNoWholeNumber(res.body);
    });

    it('keeps every number off the admin list, which carries only the flag', async () => {
      const res = await as(adminToken, 'get', '/admin/delivery-partners?limit=100');
      expect(res.status).toBe(200);
      expectNoWholeNumber(res.body);

      const row = (res.body.data as { id: string; vehicleInsuranceStatus: string }[])
        .find((r) => r.id === riderPartnerId.toString());
      expect(row?.vehicleInsuranceStatus).toBe('valid');
    });

    it('returns them whole on the one audited verification route', async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/riders/${riderPartnerId.toString()}/kyc`,
      );
      expect(res.status).toBe(200);
      expect(res.body.vehicleRegistrationNumber).toBe(PLATE);
      expect(res.body.vehicleRcNumber).toBe(RC);
      expect(res.body.vehicleInsurancePolicyNumber).toBe(POLICY);
      expect(res.body.vehicleInsuranceExpiresOn).toBe(istDay(201));
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  3. The expiry flag
  // ══════════════════════════════════════════════════════════════════

  describe('insurance expiry warning', () => {
    beforeAll(async () => {
      await resetKyc(riderPartnerId);
      await submitAll(riderToken);
    });

    it.each<[number, string]>([
      [-1, 'expired'],
      [0, 'expiring_soon'],
      [10, 'expiring_soon'],
      [30, 'expiring_soon'],
      [31, 'valid'],
    ])('%i days out reads %s on every surface', async (offset, standing) => {
      const put = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle({ vehicleInsuranceExpiresOn: istDay(offset) }),
      );
      expect(put.status).toBe(200);
      expect(put.body.vehicleInsuranceStatus).toBe(standing);
      expect(put.body.vehicleInsuranceDaysLeft).toBe(offset);

      const id = riderPartnerId.toString();
      const [detail, full, list] = await Promise.all([
        as(adminToken, 'get', `/admin/delivery-partners/${id}`),
        as(adminToken, 'get', `/admin/riders/${id}/kyc`),
        as(adminToken, 'get', '/admin/delivery-partners?limit=100'),
      ]);
      expect(detail.body.kyc.vehicleInsuranceStatus).toBe(standing);
      expect(full.body.vehicleInsuranceStatus).toBe(standing);
      expect(full.body.vehicleInsuranceDaysLeft).toBe(offset);
      const row = (list.body.data as { id: string; vehicleInsuranceStatus: string }[])
        .find((r) => r.id === id);
      expect(row?.vehicleInsuranceStatus).toBe(standing);
    });

    it('reads not_provided when no vehicle is on file', async () => {
      await resetKyc(otherPartnerId);
      const res = await as(otherToken, 'get', '/delivery/profile/kyc');
      expect(res.body.vehicleInsuranceStatus).toBe('not_provided');
      expect(res.body.vehicleInsuranceDaysLeft).toBeNull();
      expect(res.body.vehicleRegistrationNumberMasked).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  4. What a vehicle change does to the review
  // ══════════════════════════════════════════════════════════════════

  describe('a vehicle change and the KYC status', () => {
    const verify = async (): Promise<void> => {
      const res = await as(
        adminToken,
        'post',
        `/admin/riders/${riderPartnerId.toString()}/kyc/verify`,
      );
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.VERIFIED);
    };

    beforeEach(() => resetKyc(riderPartnerId));

    it('409s before any identity has been submitted', async () => {
      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle(),
      );
      expect(res.status).toBe(409);
      expect(res.body.errors.code).toBe('KYC_NOT_SUBMITTED');
      expect((await stored(riderPartnerId)).vehicleRegistrationNumber).toBeNull();
    });

    it('keeps the SLA deadline when a pending submission is corrected', async () => {
      const first = await submitAll(riderToken);
      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle({ vehicleRegistrationNumber: 'KA 01 EQ 4321' }),
      );
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.SUBMITTED);
      expect(res.body.slaDueAt).toBe(first.body.slaDueAt);
    });

    it('leaves a VERIFIED record VERIFIED when the same details are resent', async () => {
      await submitAll(riderToken);
      await verify();
      const verifiedAt = (await stored(riderPartnerId)).kycVerifiedAt?.toISOString();

      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle(),
      );
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.VERIFIED);
      expect(res.body.verifiedAt).toBe(verifiedAt);
    });

    it('sends a VERIFIED record back for review when the vehicle changes', async () => {
      await submitAll(riderToken);
      await verify();

      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle({ vehicleInsuranceExpiresOn: istDay(400) }),
      );
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.SUBMITTED);
      expect(res.body.verifiedAt).toBeNull();
      // A FRESH promise, from now — not the one the first review kept.
      const due = new Date(res.body.slaDueAt as string).getTime();
      expect(Math.abs(due - (Date.now() + kycSlaHours * 3_600_000))).toBeLessThan(60_000);

      // The identity is not thrown away with the old vehicle: the
      // reviewer re-checks the whole record, and can verify it again.
      const full = await as(
        adminToken,
        'get',
        `/admin/riders/${riderPartnerId.toString()}/kyc`,
      );
      expect(full.body.aadhaarNumber).toBe(AADHAAR);
      expect(full.body.vehicleInsuranceExpiresOn).toBe(istDay(400));
      await verify();
    });

    it('still refuses to let a VERIFIED rider replace their identity', async () => {
      await submitAll(riderToken);
      await verify();
      const res = await as(riderToken, 'post', '/delivery/profile/kyc').send({
        aadhaarNumber: AADHAAR,
        panNumber: PAN,
        drivingLicenceNumber: DL,
      });
      expect(res.status).toBe(409);
      expect(res.body.errors.code).toBe('KYC_ALREADY_VERIFIED');
    });

    it('lets a VERIFIED rider ask to upload a vehicle document, but not an identity one', async () => {
      await submitAll(riderToken);
      await verify();
      const body = { contentType: 'image/jpeg', sizeBytes: 200_000 };

      const identity = await as(riderToken, 'post', '/delivery/profile/kyc/document').send(
        { ...body, kind: 'aadhaar' },
      );
      expect(identity.status).toBe(409);

      // Reaches the storage check — which is honestly unconfigured here.
      const rc = await as(riderToken, 'post', '/delivery/profile/kyc/document').send({
        ...body,
        kind: 'vehicle_rc',
      });
      expect(rc.status).toBe(503);
    });

    it('sends a VERIFIED record back for review when a new policy image lands', async () => {
      await submitAll(riderToken);
      await verify();
      const res = await as(
        riderToken,
        'post',
        '/delivery/profile/kyc/document/attach',
      ).send({
        kind: 'vehicle_insurance',
        url:
          `https://bucket.example.com/riders/${riderPartnerId.toString()}` +
          '/kyc/vehicle_insurance/1-abcdef.jpg',
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.SUBMITTED);
      // Re-read with the numbers: the masked identity is still there.
      expect(res.body.aadhaarNumberMasked).toBe(`XXXX XXXX ${AADHAAR.slice(-4)}`);
      expect(res.body.vehicleRegistrationNumberMasked).toBe(`XXXXXX${N4}`);
    });

    it('resubmits a REJECTED record with a fresh SLA and no stale reason', async () => {
      await submitAll(riderToken);
      const rejected = await as(
        adminToken,
        'post',
        `/admin/riders/${riderPartnerId.toString()}/kyc/reject`,
      ).send({ reason: 'The RC photo does not match the plate.' });
      expect(rejected.status).toBe(200);

      const res = await as(riderToken, 'put', '/delivery/profile/kyc/vehicle').send(
        vehicle({ vehicleRcNumber: `DL08 2024 ${N4}88` }),
      );
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(KycStatus.SUBMITTED);
      expect(res.body.rejectedReason).toBeNull();
      expect(res.body.slaRemainingMs).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  5. Who may read what
  // ══════════════════════════════════════════════════════════════════

  describe('role guards', () => {
    beforeAll(async () => {
      await resetKyc(riderPartnerId);
      await resetKyc(otherPartnerId);
      await submitAll(riderToken);
    });

    it('401s without a token', async () => {
      const get = await request(server)
        .get('/delivery/profile/kyc')
        .set('X-Forwarded-For', nextIp());
      expect(get.status).toBe(401);

      const put = await request(server)
        .put('/delivery/profile/kyc/vehicle')
        .set('X-Forwarded-For', nextIp())
        .send(vehicle());
      expect(put.status).toBe(401);
    });

    it('403s a customer and an admin on the rider routes — they are not riders', async () => {
      for (const token of [customerToken, adminToken]) {
        const res = await as(token, 'put', '/delivery/profile/kyc/vehicle').send(
          vehicle(),
        );
        expect(res.status).toBe(403);
      }
    });

    it("never shows one rider another rider's vehicle, and never writes it", async () => {
      const other = await as(otherToken, 'get', '/delivery/profile/kyc');
      expect(other.status).toBe(200);
      expect(other.body.vehicleRegistrationNumberMasked).toBeNull();
      expect(JSON.stringify(other.body)).not.toContain(N4);

      // The other rider submitting their own vehicle touches only theirs.
      await submitAll(otherToken, { vehicleRegistrationNumber: 'UP 32 X 9999' });
      expect((await stored(otherPartnerId)).vehicleRegistrationNumber).toBe(
        'UP32X9999',
      );
      expect((await stored(riderPartnerId)).vehicleRegistrationNumber).toBe(PLATE);
    });

    it("403s a rider on every admin route that reads someone's KYC", async () => {
      const id = otherPartnerId.toString();
      for (const path of [
        `/admin/riders/${id}/kyc`,
        `/admin/delivery-partners/${id}`,
        '/admin/delivery-partners',
        '/admin/riders/kyc',
      ]) {
        const res = await as(riderToken, 'get', path);
        expect(res.status).toBe(403);
      }
    });

    it("lets an admin read any rider's vehicle", async () => {
      const res = await as(
        adminToken,
        'get',
        `/admin/riders/${otherPartnerId.toString()}/kyc`,
      );
      expect(res.status).toBe(200);
      expect(res.body.vehicleRegistrationNumber).toBe('UP32X9999');
    });
  });
});
