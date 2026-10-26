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
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/** Generated per run, never a literal. Long enough for the DTO. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The two admin reads the console crashed on, pinned to the shape the
 * screens now read.
 *
 *   GET /admin/vendors/:id  — the row plus `owner`, the contact details that
 *                             live on the User and not on the store.
 *   GET /admin/team         — `status` is null, never absent, for an account
 *                             written outside Mongoose with no status; and
 *                             `isSystemAccount` is always a boolean.
 *   POST /admin/team        — needs a password (there is no invitation flow)
 *                             and creates an account that can sign in with it.
 */
describe('Admin vendors + team read shapes (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let users: Model<UserDocument>;
  let vendors: Model<VendorDocument>;
  let passwords: PasswordService;

  let superAdminToken: string;
  let adminToken: string;

  let counter = 0;

  async function seedUser(
    role: Role,
    overrides: Partial<{ name: string; vendorId: Types.ObjectId }> = {},
  ) {
    const n = String(++counter).padStart(4, '0');
    return users.create({
      name: overrides.name ?? `Shape ${role} ${n}`,
      email: `shape${n}@test.invalid`,
      phone: `95${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role,
      status: UserStatus.ACTIVE,
      vendorId: overrides.vendorId ?? null,
    });
  }

  async function login(identifier: string, password = PASSWORD) {
    return request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier, password });
  }

  async function tokenFor(role: Role): Promise<string> {
    const user = await seedUser(role);
    const res = await login(user.email as string);
    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  async function seedVendor(ownerId: Types.ObjectId, vendorId = new Types.ObjectId()) {
    await vendors.create({
      _id: vendorId,
      ownerId,
      storeName: `Shape Store ${++counter}`,
      slug: `shape-store-${Date.now()}-${counter}`,
      address: {
        line1: '1 Market Lane',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      },
      location: { type: 'Point', coordinates: [73.8567, 18.5204] },
      commissionPct: 12,
      status: VendorStatus.APPROVED,
    });
    return vendorId;
  }

  const get = (path: string, token: string) =>
    request(server)
      .get(path)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    vendors = ctx.app.get<Model<VendorDocument>>(getModelToken(Vendor.name));
    passwords = ctx.app.get(PasswordService);

    superAdminToken = await tokenFor(Role.SUPER_ADMIN);
    adminToken = await tokenFor(Role.ADMIN);
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  GET /admin/vendors/:id
  // ══════════════════════════════════════════════════════════════════

  describe('GET /admin/vendors/:id', () => {
    it("joins the owner's contact details, and nothing else of theirs", async () => {
      const vendorId = new Types.ObjectId();
      const owner = await seedUser(Role.VENDOR, { name: 'Sunita Kulkarni', vendorId });
      await seedVendor(owner._id, vendorId);

      const res = await get(`/admin/vendors/${vendorId.toString()}`, adminToken);

      expect(res.status).toBe(200);
      expect(res.body.owner).toEqual({
        id: owner._id.toString(),
        name: 'Sunita Kulkarni',
        email: owner.email,
        phone: owner.phone,
      });
      // Named coordinates, the lifetime figures, and no screen-only fields.
      expect(res.body.location).toEqual({ lat: 18.5204, lng: 73.8567 });
      expect(res.body).toMatchObject({ gmv: 0, orderCount: 0, openingHours: [] });
      expect(res.body).not.toHaveProperty('earnings');
      expect(res.body).not.toHaveProperty('recentOrders');

      // A $lookup ignores `select: false`, so this is asserted, not assumed.
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('$argon2');
      expect(body).not.toContain('refreshTokenHash');
    });

    it('reports a missing owner account as null rather than failing', async () => {
      const vendorId = await seedVendor(new Types.ObjectId());

      const res = await get(`/admin/vendors/${vendorId.toString()}`, adminToken);

      expect(res.status).toBe(200);
      expect(res.body.owner).toBeNull();
    });

    it('keeps orders and products on their own paginated routes', async () => {
      const vendorId = new Types.ObjectId();
      const owner = await seedUser(Role.VENDOR, { vendorId });
      await seedVendor(owner._id, vendorId);

      for (const sub of ['orders', 'products']) {
        const res = await get(
          `/admin/vendors/${vendorId.toString()}/${sub}?limit=6`,
          adminToken,
        );
        expect([sub, res.status]).toEqual([sub, 200]);
        expect(res.body.data).toEqual([]);
        expect(res.body.meta).toMatchObject({ page: 1, limit: 6, total: 0 });
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  GET /admin/team
  // ══════════════════════════════════════════════════════════════════

  describe('GET /admin/team', () => {
    it('sends status: null and isSystemAccount: false for a hand-written account', async () => {
      // Straight into the collection, bypassing Mongoose defaults — the
      // shape of the live account that crashed the Team page.
      const _id = new Types.ObjectId();
      await users.collection.insertOne({
        _id,
        name: 'Hand Made Admin',
        email: 'handmade@test.invalid',
        phone: '',
        role: Role.ADMIN,
        createdAt: new Date(),
      });

      const res = await get('/admin/team?limit=100', superAdminToken);

      expect(res.status).toBe(200);
      const row = (res.body.data as Array<Record<string, unknown>>).find(
        (r) => r.id === _id.toString(),
      );
      expect(row).toBeDefined();
      expect(row).toMatchObject({
        name: 'Hand Made Admin',
        role: Role.ADMIN,
        status: null,
        isSystemAccount: false,
        lastLoginAt: null,
      });
      // Every row carries every key — the console reads them unguarded.
      for (const r of res.body.data as Array<Record<string, unknown>>) {
        for (const key of [
          'id',
          'name',
          'email',
          'phone',
          'role',
          'status',
          'isSystemAccount',
          'lastLoginAt',
          'createdAt',
        ]) {
          expect([r.id, key, key in r]).toEqual([r.id, key, true]);
        }
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  POST /admin/team — the body the console's form now sends
  // ══════════════════════════════════════════════════════════════════

  describe('POST /admin/team', () => {
    const body = {
      name: 'Form Admin',
      email: 'formadmin@test.invalid',
      phone: '9412300000',
    };

    it('refuses a body with no password — there is no invitation flow', async () => {
      const res = await request(server)
        .post('/admin/team')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(body);

      expect(res.status).toBe(400);
    });

    it('refuses the access level the old form sent', async () => {
      const res = await request(server)
        .post('/admin/team')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ ...body, password: PASSWORD, level: 'SUPER_ADMIN' });

      expect(res.status).toBe(400);
    });

    it('creates an ADMIN who can sign in with the password set here', async () => {
      const res = await request(server)
        .post('/admin/team')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ ...body, password: PASSWORD });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        isSystemAccount: false,
      });
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);

      const signIn = await login(body.email);
      expect(signIn.status).toBe(200);
    });
  });
});
