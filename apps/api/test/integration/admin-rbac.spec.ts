import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { User, UserDocument } from '../../src/database/schemas/user.schema';
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

/** Generated per run, never a literal. Long enough for the DTO. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Substituted for every `:param` so a route is addressable. */
const ANY_ID = new Types.ObjectId().toString();

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteInfo {
  method: Verb;
  /** `/admin/vendors/:id/status` — as declared. */
  template: string;
  /** The same path with a real ObjectId substituted. */
  path: string;
  controller: string;
  handler: string;
  /** Roles declared on the handler, falling back to the controller. */
  roles: Role[];
  isPublic: boolean;
}

const normalise = (segment: unknown): string =>
  typeof segment === 'string' ? segment.replace(/^\/+|\/+$/g, '') : '';

/**
 * Walks every controller Nest actually registered.
 *
 * The route list is DISCOVERED, never hand-written. A hand-written list
 * is the thing that goes stale: somebody adds `PATCH /admin/vendors/:id/
 * payout-account`, forgets this file, and the one route that moves money
 * is the one route nothing asserts on.
 */
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
        path: template.replace(/:[A-Za-z0-9_]+/g, ANY_ID),
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
 *  ADMIN AUTHORISATION
 * ════════════════════════════════════════════════════════════════════════
 *
 * Three properties, asserted against EVERY discovered `/admin/*` route
 * rather than a sample:
 *
 *   1. No token            → 401. The guard chain rejects an anonymous
 *                            caller before any routing param, body
 *                            validation or database lookup happens.
 *   2. A CUSTOMER token    → 403. Authenticated is not authorised, and
 *                            the admin surface is the whole platform's
 *                            data.
 *   3. An ADMIN token on a SUPER_ADMIN-only route → 403. Role
 *                            inheritance runs UPWARD only: SUPER_ADMIN
 *                            satisfies ADMIN, ADMIN never satisfies
 *                            SUPER_ADMIN. That asymmetry is what stops a
 *                            compromised admin session from re-pricing
 *                            the platform, paying itself out, or minting
 *                            a replacement admin to fall back on.
 *
 * Plus the two account invariants that have no second line of defence:
 * SUPER_ADMIN cannot be created through the API at all, and the seeded
 * system accounts are immutable through it.
 */
describe('Admin RBAC (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let users: Model<UserDocument>;
  let passwords: PasswordService;

  let adminRoutes: RouteInfo[];
  let superAdminOnlyRoutes: RouteInfo[];

  let superAdminToken: string;
  let adminToken: string;
  let customerToken: string;
  let systemAccountId: string;

  let phoneCounter = 0;

  async function seedUser(
    role: Role,
    options: { isSystemAccount?: boolean } = {},
  ): Promise<{ id: string; email: string }> {
    const n = String(++phoneCounter).padStart(4, '0');
    const email = `rbac${n}@test.invalid`;

    const created = await users.create({
      name: `RBAC ${role} ${n}`,
      email,
      phone: `97${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role,
      status: UserStatus.ACTIVE,
      isSystemAccount: options.isSystemAccount ?? false,
    });

    return { id: created._id.toString(), email };
  }

  async function tokenFor(role: Role): Promise<string> {
    const user = await seedUser(role);
    // A distinct source IP per login: /auth/login is rate-limited to 5
    // per minute per IP, and that limit is a feature under test
    // elsewhere, not an obstacle to disable here.
    const res = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: user.email, password: PASSWORD });

    expect(res.status).toBe(200);
    return res.body.accessToken as string;
  }

  const send = (route: RouteInfo, token?: string) => {
    const req = request(server)
      [route.method](route.path)
      .set('X-Forwarded-For', nextIp());
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send({});
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    passwords = ctx.app.get(PasswordService);

    const all = enumerateRoutes(
      ctx.app.get(DiscoveryService),
      ctx.app.get(Reflector),
    );

    adminRoutes = all.filter(
      (route) => route.template.startsWith('/admin') && !route.isPublic,
    );
    superAdminOnlyRoutes = adminRoutes.filter((route) =>
      route.roles.includes(Role.SUPER_ADMIN),
    );

    superAdminToken = await tokenFor(Role.SUPER_ADMIN);
    adminToken = await tokenFor(Role.ADMIN);
    customerToken = await tokenFor(Role.CUSTOMER);

    const system = await seedUser(Role.ADMIN, { isSystemAccount: true });
    systemAccountId = system.id;
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  The route inventory itself
  // ══════════════════════════════════════════════════════════════════

  it('discovers the admin surface (guards the test itself)', () => {
    // If discovery silently returned nothing, every assertion below would
    // pass vacuously. This is the canary for that.
    expect(adminRoutes.length).toBeGreaterThan(20);
    expect(adminRoutes.map((route) => `${route.method} ${route.template}`)).toEqual(
      expect.arrayContaining([
        'get /admin/analytics/overview',
        'get /admin/vendors',
        'patch /admin/vendors/:id/commission',
        'get /admin/orders',
        'get /admin/customers',
        'get /admin/delivery-partners',
        'get /admin/categories',
        'get /admin/products',
        'get /admin/settlements',
        'post /admin/settlements/generate',
        'get /admin/ledger',
        'get /admin/coupons',
        'get /admin/audit-logs',
        'get /admin/team',
        'get /admin/settings',
        'put /admin/settings',
      ]),
    );
  });

  it('marks no admin route @Public()', () => {
    // Every admin route reads or writes the whole platform's data. There
    // is no defensible reason for one of them to be unauthenticated, and
    // `public-routes.spec.ts` already pins the complete public allowlist.
    const leaked = enumerateRoutes(
      ctx.app.get(DiscoveryService),
      ctx.app.get(Reflector),
    ).filter((route) => route.template.startsWith('/admin') && route.isPublic);

    expect(leaked.map((route) => route.template)).toEqual([]);
  });

  it('declares a role on every admin route', () => {
    // Without @Roles(), a route is merely "authenticated" — which means
    // any customer with a valid token can reach it.
    const unroled = adminRoutes.filter((route) => route.roles.length === 0);

    if (unroled.length > 0) {
      throw new Error(
        '\n\nADMIN ROUTE(S) WITH NO @Roles() DECORATOR:\n' +
          unroled
            .map(
              (route) =>
                `    ${route.method.toUpperCase()} ${route.template}   (${route.controller}.${route.handler})`,
            )
            .join('\n') +
          '\n  An admin route without @Roles() is reachable by any authenticated\n' +
          '  user, including a CUSTOMER. Add @Roles(Role.ADMIN) — or\n' +
          '  @Roles(Role.SUPER_ADMIN) if it moves money or grants privilege.\n',
      );
    }
    expect(unroled).toEqual([]);
  });

  // ══════════════════════════════════════════════════════════════════
  //  1. Anonymous
  // ══════════════════════════════════════════════════════════════════

  it('rejects every /admin route with 401 when no token is presented', async () => {
    for (const route of adminRoutes) {
      const res = await send(route);

      if (res.status !== 401) {
        throw new Error(
          `\n\nUNPROTECTED ADMIN ROUTE: ${route.method.toUpperCase()} ${route.template} ` +
            `(${route.controller}.${route.handler}) returned ${res.status} ` +
            `to an anonymous request; expected 401.\n`,
        );
      }
      expect(res.status).toBe(401);
    }
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  //  2. CUSTOMER
  // ══════════════════════════════════════════════════════════════════

  it('rejects every /admin route with 403 for a CUSTOMER token', async () => {
    for (const route of adminRoutes) {
      const res = await send(route, customerToken);

      if (res.status !== 403) {
        throw new Error(
          `\n\nROLE LEAK: ${route.method.toUpperCase()} ${route.template} ` +
            `(${route.controller}.${route.handler}) returned ${res.status} ` +
            `to a CUSTOMER token; expected 403.\n` +
            'A customer must never reach the admin surface — it spans every ' +
            "vendor's orders, every customer's spend and the platform ledger.\n",
        );
      }
      expect(res.status).toBe(403);
    }
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  //  3. ADMIN vs SUPER_ADMIN
  // ══════════════════════════════════════════════════════════════════

  it('identifies the SUPER_ADMIN-only routes', () => {
    const templates = superAdminOnlyRoutes.map(
      (route) => `${route.method} ${route.template}`,
    );

    // Each of these is either irreversible or a privilege grant.
    expect(templates).toEqual(
      expect.arrayContaining([
        'patch /admin/vendors/:id/commission',
        'post /admin/settlements/generate',
        'post /admin/settlements/:id/pay',
        'get /admin/team',
        'post /admin/team',
        'patch /admin/team/:id/status',
        'delete /admin/team/:id',
        'put /admin/settings',
      ]),
    );
  });

  it('rejects an ADMIN token with 403 on every SUPER_ADMIN-only route', async () => {
    for (const route of superAdminOnlyRoutes) {
      const res = await send(route, adminToken);

      if (res.status !== 403) {
        throw new Error(
          `\n\nPRIVILEGE ESCALATION: ${route.method.toUpperCase()} ${route.template} ` +
            `(${route.controller}.${route.handler}) returned ${res.status} to an ` +
            'ADMIN token; expected 403.\n' +
            'Role inheritance runs UPWARD only. ADMIN must never satisfy a ' +
            'SUPER_ADMIN requirement.\n',
        );
      }
      expect(res.status).toBe(403);
    }
  }, 120_000);

  it('lets an ADMIN token through the ordinary admin routes', async () => {
    const ordinary = [
      '/admin/analytics/overview',
      '/admin/analytics/orders-by-status',
      '/admin/vendors',
      '/admin/orders',
      '/admin/customers',
      '/admin/delivery-partners',
      '/admin/categories',
      '/admin/products',
      '/admin/settlements',
      '/admin/ledger',
      '/admin/coupons',
      '/admin/audit-logs',
      '/admin/settings',
    ];

    for (const path of ordinary) {
      const res = await request(server)
        .get(path)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${adminToken}`);

      expect([path, res.status]).toEqual([path, 200]);
    }
  }, 60_000);

  it('lets a SUPER_ADMIN token through a SUPER_ADMIN-only route', async () => {
    const res = await request(server)
      .get('/admin/team')
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
  });

  it('never serialises a password hash into an admin response', async () => {
    for (const path of ['/admin/team', '/admin/customers', '/admin/delivery-partners']) {
      const res = await request(server)
        .get(path)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      // `select: false` on the schema is a QUERY-level feature and an
      // aggregation $lookup ignores it, so this is asserted rather than
      // assumed.
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('refreshTokenHash');
      expect(body).not.toContain('$argon2');
    }
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  4. POST /admin/team cannot create a SUPER_ADMIN
  // ══════════════════════════════════════════════════════════════════

  describe('POST /admin/team', () => {
    const member = (suffix: string) => ({
      name: `New Admin ${suffix}`,
      email: `newadmin${suffix}@test.invalid`,
      phone: `96${suffix}00000`.slice(0, 10),
      password: PASSWORD,
    });

    it('creates an ADMIN, never a SUPER_ADMIN', async () => {
      const res = await request(server)
        .post('/admin/team')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send(member('0001'));

      expect(res.status).toBe(201);
      expect(res.body.role).toBe(Role.ADMIN);
      expect(res.body.isSystemAccount).toBe(false);
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('rejects a body that tries to smuggle in a role', async () => {
      // `role` is not a field on CreateTeamMemberDto, and the global
      // ValidationPipe runs with forbidNonWhitelisted — so an unknown
      // property is a 400, not something silently dropped.
      const res = await request(server)
        .post('/admin/team')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ ...member('0002'), role: Role.SUPER_ADMIN });

      expect(res.status).toBe(400);
    });

    it('creates no SUPER_ADMIN account as a side effect', async () => {
      const count = await users
        .countDocuments({ role: Role.SUPER_ADMIN })
        .exec();
      // Exactly the one this spec seeded for its own token. If a request
      // above had succeeded in minting one, this would be 2.
      expect(count).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  5. Seeded system accounts are immutable through the API
  // ══════════════════════════════════════════════════════════════════

  describe('seeded system accounts', () => {
    it('cannot be suspended', async () => {
      const res = await request(server)
        .patch(`/admin/team/${systemAccountId}/status`)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ status: UserStatus.SUSPENDED, reason: 'attempted lockout' });

      expect(res.status).toBe(403);

      const after = await users.findById(systemAccountId).lean().exec();
      expect(after?.status).toBe(UserStatus.ACTIVE);
    });

    it('cannot be deleted', async () => {
      const res = await request(server)
        .delete(`/admin/team/${systemAccountId}`)
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(403);

      // The break-glass identity is still there. This is the invariant
      // that stops one bad request locking every human out of the
      // platform permanently.
      const after = await users.findById(systemAccountId).lean().exec();
      expect(after).not.toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  6. A suspended admin loses access immediately
  // ══════════════════════════════════════════════════════════════════

  it('stops a suspended ADMIN on their very next request', async () => {
    const victim = await seedUser(Role.ADMIN);
    const login = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: victim.email, password: PASSWORD });

    expect(login.status).toBe(200);
    const token = login.body.accessToken as string;

    const before = await request(server)
      .get('/admin/vendors')
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    const suspend = await request(server)
      .patch(`/admin/team/${victim.id}/status`)
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: UserStatus.SUSPENDED, reason: 'offboarded' });
    expect(suspend.status).toBe(200);

    // JwtStrategy re-reads `status` from the database on EVERY request,
    // so the still-valid 15-minute access token stops working at once
    // rather than when it happens to expire.
    const after = await request(server)
      .get('/admin/vendors')
      .set('X-Forwarded-For', nextIp())
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  }, 60_000);
});
