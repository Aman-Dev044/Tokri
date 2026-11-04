import 'reflect-metadata';
import { Controller, ExecutionContext, ForbiddenException, Get, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';

import {
  AuditLog,
  AuditLogDocument,
} from '../../src/database/schemas/audit-log.schema';
import { Order, OrderDocument } from '../../src/database/schemas/order.schema';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../src/common/constants/order-status.enum';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import {
  ALL_PERMISSIONS,
  Permission,
  STAFF_PRESETS,
  StaffRole,
} from '../../src/common/constants/permissions';
import {
  PERMISSIONS_KEY,
  PermissionRule,
} from '../../src/common/decorators/require-permission.decorator';
import { Roles } from '../../src/common/decorators/roles.decorator';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard';
import { TestContext, closeTestApp, createTestApp, nextIp, readCookie } from '../utils/test-app';
import {
  SeededStore,
  StoreSeeder,
  runPassword,
  uniquePhone,
} from '../utils/store-fixtures';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  STORE STAFF — server-enforced roles and permissions
 * ════════════════════════════════════════════════════════════════════════
 *
 * What is proven here, against the REAL AppModule and its guard chain:
 *
 *  1. Every `/vendor/*` route declares a permission rule (discovered, not
 *     listed by hand), and the guard itself refuses STAFF on a store route
 *     that forgot one.
 *  2. Each preset reaches exactly its permissions and is 403 everywhere
 *     else — with requests a hostile client could craft by hand.
 *  3. Staff of store A cannot touch store B.
 *  4. A manager cannot escalate: not by granting, not by editing the
 *     owner, not by editing themselves, not by demoting a better-placed
 *     colleague.
 *  5. Revoking a permission bites on the NEXT request with the SAME token.
 *  6. Suspension locks the account out of every path back in.
 */

const PASSWORD = runPassword();
const GHOST = new Types.ObjectId().toString();

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteInfo {
  method: Verb;
  template: string;
  controller: string;
  handler: string;
  rule: PermissionRule | undefined;
}

function enumerateVendorRoutes(
  discovery: DiscoveryService,
  reflector: Reflector,
): RouteInfo[] {
  const routes: RouteInfo[] = [];
  const normalise = (segment: unknown): string =>
    typeof segment === 'string' ? segment.replace(/^\/+|\/+$/g, '') : '';

  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance;
    const metatype = wrapper.metatype;
    if (!instance || typeof metatype !== 'function') continue;

    const base = normalise(Reflect.getMetadata(PATH_METADATA, metatype));
    const prototype = Object.getPrototypeOf(instance) as object;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (!descriptor || typeof descriptor.value !== 'function') continue;
      const handler = descriptor.value as (...args: unknown[]) => unknown;
      if (!Reflect.hasMetadata(PATH_METADATA, handler)) continue;

      const path = normalise(Reflect.getMetadata(PATH_METADATA, handler));
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      const template = `/${[base, path].filter(Boolean).join('/')}`;
      if (!template.startsWith('/vendor')) continue;

      routes.push({
        method: RequestMethod[verb ?? RequestMethod.GET].toLowerCase() as Verb,
        template,
        controller: metatype.name,
        handler: name,
        rule: reflector.getAllAndOverride<PermissionRule | undefined>(
          PERMISSIONS_KEY,
          [handler, metatype],
        ),
      });
    }
  }
  return routes;
}

/**
 * One probe per permission: a request that the guard must decide on, and
 * that does nothing harmful when it IS allowed (a ghost id → 404, an
 * empty body → 400, a missing Idempotency-Key → 400, or a read).
 */
const PROBES: Record<Permission, { method: Verb; path: string; body?: object }> = {
  [Permission.ORDERS_VIEW]: { method: 'get', path: '/vendor/orders' },
  [Permission.ORDERS_UPDATE]: { method: 'patch', path: `/vendor/orders/${GHOST}/accept`, body: {} },
  [Permission.PRODUCTS_VIEW]: { method: 'get', path: '/vendor/products' },
  [Permission.PRODUCTS_MANAGE]: { method: 'patch', path: `/vendor/products/${GHOST}`, body: {} },
  [Permission.INVENTORY_ADJUST]: {
    method: 'patch',
    path: `/vendor/inventory/${GHOST}`,
    body: { delta: 1, reason: 'manual' },
  },
  [Permission.BILLING_VIEW]: { method: 'get', path: '/vendor/pos/sales' },
  [Permission.BILLING_CREATE]: { method: 'post', path: '/vendor/pos/sales', body: {} },
  [Permission.BILLING_VOID]: {
    method: 'post',
    path: `/vendor/pos/sales/${GHOST}/void`,
    body: { reason: 'probe' },
  },
  [Permission.STAFF_MANAGE]: { method: 'get', path: '/vendor/staff' },
  [Permission.RIDERS_MANAGE]: { method: 'post', path: '/vendor/delivery-partners', body: {} },
  [Permission.EARNINGS_VIEW]: { method: 'get', path: '/vendor/earnings' },
  [Permission.STORE_MANAGE]: { method: 'get', path: '/vendor/profile' },
};

describe('Store staff — roles and permissions (integration)', () => {
  let ctx: TestContext;
  let seed: StoreSeeder;
  let audit: Model<AuditLogDocument>;
  let orders: Model<OrderDocument>;

  let alpha: SeededStore;
  let bravo: SeededStore;
  let bravoOrderId: string;
  let adminToken: string;

  /** Creates a staff member through the API as `token`, returns its row + a login. */
  async function hire(
    token: string,
    staffRole: StaffRole,
    permissions?: Permission[],
  ): Promise<{ id: string; phone: string; token: string; password: string }> {
    const phone = uniquePhone();
    const password = runPassword();
    const res = await seed
      .as(token, 'post', '/vendor/staff')
      .send({
        name: `${staffRole} ${phone.slice(-4)}`,
        phone,
        password,
        staffRole,
        ...(permissions ? { permissions } : {}),
      });
    if (res.status !== 201) {
      throw new Error(`hire ${staffRole} → ${res.status} ${JSON.stringify(res.body)}`);
    }
    return {
      id: res.body.id as string,
      phone,
      password,
      token: await seed.token(phone, password),
    };
  }

  const probe = (token: string, permission: Permission) => {
    const { method, path, body } = PROBES[permission];
    return seed.as(token, method, path).send(body ?? {});
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    seed = new StoreSeeder(ctx, PASSWORD);
    audit = ctx.app.get(getModelToken(AuditLog.name));
    orders = ctx.app.get(getModelToken(Order.name));

    alpha = await seed.store('Alpha', [{ name: 'Alpha Rice', price: 6_000, mrp: 7_000 }]);
    bravo = await seed.store('Bravo', [{ name: 'Bravo Dal', price: 9_000, mrp: 9_500 }]);

    const customer = await seed.user(Role.CUSTOMER, null);
    const order = await orders.create({
      orderNo: `TKR-STAFF-${Date.now()}`,
      customerId: customer._id,
      vendorId: new Types.ObjectId(bravo.vendorId),
      items: [
        {
          productId: new Types.ObjectId(bravo.products[0]?.id),
          name: 'Bravo Dal',
          unit: '500g',
          price: 9_000,
          qty: 1,
          lineTotal: 9_000,
          fulfilled: true,
        },
      ],
      pricing: {
        itemsSubtotal: 9_000,
        discount: 0,
        deliveryFee: 0,
        taxes: 450,
        grandTotal: 9_450,
        commissionPct: 12,
        commissionAmount: 1_080,
        vendorPayout: 7_920,
      },
      address: {
        line1: '9 Customer Street',
        city: 'Pune',
        pincode: '411002',
        location: { type: 'Point', coordinates: [73.86, 18.52] },
        phone: uniquePhone(),
      },
      payment: { method: PaymentMethod.COD, status: PaymentStatus.PENDING },
      status: OrderStatus.PLACED,
      statusHistory: [],
      placedAt: new Date(),
    });
    bravoOrderId = order._id.toString();

    const admin = await seed.user(Role.ADMIN, null);
    adminToken = await seed.token(admin.phone);
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  1. Deny by default
  // ══════════════════════════════════════════════════════════════════

  describe('deny by default', () => {
    it('every /vendor route declares @RequirePermission (or the allowlisted @StoreMember)', () => {
      const routes = enumerateVendorRoutes(
        ctx.app.get(DiscoveryService),
        ctx.app.get(Reflector),
      );
      // Canary: an empty discovery would make this pass vacuously.
      expect(routes.length).toBeGreaterThan(40);

      const bare = routes.filter((route) => !route.rule);
      if (bare.length > 0) {
        throw new Error(
          '\n\n/vendor ROUTE(S) WITHOUT @RequirePermission:\n' +
            bare
              .map(
                (route) =>
                  `    ${route.method.toUpperCase()} ${route.template}   (${route.controller}.${route.handler})`,
              )
              .join('\n') +
            '\n  Every store route must say which permission it needs.\n',
        );
      }

      // `member` means "any employee" — pinned, so it cannot become the
      // easy way out of choosing a permission.
      const member = routes
        .filter((route) => route.rule?.mode === 'member')
        .map((route) => `${route.method} ${route.template}`);
      expect(member).toEqual(['get /vendor/me']);

      // And every listed permission is a real one.
      for (const route of routes) {
        for (const permission of route.rule?.permissions ?? []) {
          expect(ALL_PERMISSIONS).toContain(permission);
        }
      }
    });

    it('the guard itself refuses STAFF on a store route that forgot its rule', () => {
      @Controller('vendor/forgotten')
      @Roles(Role.VENDOR, Role.STAFF)
      class ForgottenController {
        @Get()
        handler() {
          return 'leak';
        }
      }

      const guard = new PermissionsGuard(new Reflector());
      const contextFor = (user: object) =>
        ({
          getHandler: () => ForgottenController.prototype.handler,
          getClass: () => ForgottenController,
          switchToHttp: () => ({ getRequest: () => ({ user }) }),
        }) as unknown as ExecutionContext;

      expect(() =>
        guard.canActivate(
          contextFor({ sub: 'x', role: Role.STAFF, permissions: [...ALL_PERMISSIONS] }),
        ),
      ).toThrow(ForbiddenException);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  2. The preset matrix
  // ══════════════════════════════════════════════════════════════════

  describe('each preset reaches exactly its permissions', () => {
    const presets = Object.keys(STAFF_PRESETS) as Exclude<StaffRole, StaffRole.CUSTOM>[];

    it.each(presets)('%s', async (preset) => {
      const staff = await hire(alpha.ownerToken, preset);
      const allowed = new Set<Permission>(STAFF_PRESETS[preset]);

      const me = await seed.as(staff.token, 'get', '/vendor/me');
      expect(me.status).toBe(200);
      expect(me.body.role).toBe(Role.STAFF);
      expect(me.body.isOwner).toBe(false);
      expect(me.body.staffRole).toBe(preset);
      expect([...me.body.permissions].sort()).toEqual([...allowed].sort());
      expect(me.body.store.id).toBe(alpha.vendorId);

      const wrong: string[] = [];
      for (const permission of ALL_PERMISSIONS) {
        const res = await probe(staff.token, permission);
        const denied = res.status === 403;
        if (denied === allowed.has(permission)) {
          wrong.push(`${permission}: ${res.status} (${allowed.has(permission) ? 'should pass' : 'should be 403'})`);
        }
      }
      expect(wrong).toEqual([]);
    }, 120_000);

    it('the owner passes every probe', async () => {
      for (const permission of ALL_PERMISSIONS) {
        const res = await probe(alpha.ownerToken, permission);
        expect([permission, res.status === 403]).toEqual([permission, false]);
      }
      const me = await seed.as(alpha.ownerToken, 'get', '/vendor/me');
      expect(me.body.isOwner).toBe(true);
      expect(me.body.permissions).toHaveLength(ALL_PERMISSIONS.length);
    }, 60_000);

    it('CUSTOM is exactly its list', async () => {
      const staff = await hire(alpha.ownerToken, StaffRole.CUSTOM, [
        Permission.EARNINGS_VIEW,
        Permission.BILLING_VIEW,
      ]);
      expect((await probe(staff.token, Permission.EARNINGS_VIEW)).status).toBe(200);
      expect((await probe(staff.token, Permission.BILLING_VIEW)).status).toBe(200);
      expect((await probe(staff.token, Permission.ORDERS_VIEW)).status).toBe(403);
      expect((await probe(staff.token, Permission.BILLING_CREATE)).status).toBe(403);
    }, 60_000);

    it('staff log in through /auth/login with no OTP and land as role=staff of their store', async () => {
      const staff = await hire(alpha.ownerToken, StaffRole.BILLER);
      const res = await seed.login(staff.phone, staff.password);
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('staff');
      expect(res.body.user.vendorId).toBe(alpha.vendorId);
      expect(JSON.stringify(res.body)).not.toContain(staff.password);
    }, 60_000);
  });

  // ══════════════════════════════════════════════════════════════════
  //  3. Cross-store isolation
  // ══════════════════════════════════════════════════════════════════

  it("a manager of store A cannot reach store B's anything", async () => {
    const manager = await hire(alpha.ownerToken, StaffRole.MANAGER);
    const bravoStaff = await hire(bravo.ownerToken, StaffRole.BILLER);

    const attempts: [Verb, string, object][] = [
      ['get', `/vendor/orders/${bravoOrderId}`, {}],
      ['patch', `/vendor/orders/${bravoOrderId}/accept`, {}],
      ['get', `/vendor/products/${bravo.products[0]?.id}`, {}],
      ['patch', `/vendor/products/${bravo.products[0]?.id}`, { price: 1 }],
      ['patch', `/vendor/inventory/${bravo.products[0]?.id}`, { delta: -5, reason: 'manual' }],
      ['get', `/vendor/staff/${bravoStaff.id}`, {}],
      ['patch', `/vendor/staff/${bravoStaff.id}`, { staffRole: StaffRole.MANAGER }],
      ['patch', `/vendor/staff/${bravoStaff.id}/status`, { status: 'suspended' }],
      ['delete', `/vendor/staff/${bravoStaff.id}`, {}],
      ['patch', `/vendor/staff/${bravo.ownerId}`, { name: 'Hijacked' }],
    ];

    for (const [method, path, body] of attempts) {
      const res = await seed.as(manager.token, method, path).send(body);
      expect([method, path, res.status]).toEqual([method, path, 404]);
      expect(JSON.stringify(res.body)).not.toContain('Bravo');
    }

    const products = await seed.as(manager.token, 'get', '/vendor/products');
    expect(JSON.stringify(products.body)).not.toContain('Bravo');
    const staffList = await seed.as(manager.token, 'get', '/vendor/staff?limit=100');
    expect(staffList.body.data.map((row: { id: string }) => row.id)).not.toContain(
      bravoStaff.id,
    );

    // B's staff member is untouched and still works.
    const still = await seed.as(bravoStaff.token, 'get', '/vendor/me');
    expect(still.status).toBe(200);
    expect(still.body.staffRole).toBe(StaffRole.BILLER);
    expect(still.body.store.id).toBe(bravo.vendorId);

    const untouched = await orders.findById(bravoOrderId).lean().exec();
    expect(untouched?.status).toBe(OrderStatus.PLACED);
  }, 120_000);

  // ══════════════════════════════════════════════════════════════════
  //  4. No escalation
  // ══════════════════════════════════════════════════════════════════

  describe('a manager cannot escalate', () => {
    let manager: Awaited<ReturnType<typeof hire>>;
    let managerId: string;

    beforeAll(async () => {
      manager = await hire(alpha.ownerToken, StaffRole.MANAGER);
      managerId = manager.id;
    }, 60_000);

    it('cannot grant a permission they do not hold', async () => {
      const res = await seed
        .as(manager.token, 'post', '/vendor/staff')
        .send({
          name: 'Sneaky',
          phone: uniquePhone(),
          password: runPassword(),
          staffRole: StaffRole.CUSTOM,
          permissions: [Permission.BILLING_VIEW, Permission.EARNINGS_VIEW],
        });
      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('earnings.view');
    });

    it('can hire within their own permissions', async () => {
      const biller = await hire(manager.token, StaffRole.BILLER);
      expect(biller.id).toEqual(expect.any(String));

      // ...but cannot later lift that hire above themselves.
      const lift = await seed
        .as(manager.token, 'patch', `/vendor/staff/${biller.id}`)
        .send({ staffRole: StaffRole.CUSTOM, permissions: [Permission.EARNINGS_VIEW] });
      expect(lift.status).toBe(403);
    }, 60_000);

    it('cannot edit the owner', async () => {
      const res = await seed
        .as(manager.token, 'patch', `/vendor/staff/${alpha.ownerId}`)
        .send({ name: 'Demoted Owner' });
      expect(res.status).toBe(403);
      const suspend = await seed
        .as(manager.token, 'patch', `/vendor/staff/${alpha.ownerId}/status`)
        .send({ status: 'suspended' });
      expect(suspend.status).toBe(403);
    });

    it('cannot edit themselves', async () => {
      const res = await seed
        .as(manager.token, 'patch', `/vendor/staff/${managerId}`)
        .send({ staffRole: StaffRole.CUSTOM, permissions: [...ALL_PERMISSIONS] });
      expect(res.status).toBe(403);
      const del = await seed.as(manager.token, 'delete', `/vendor/staff/${managerId}`);
      expect(del.status).toBe(403);
    });

    it('cannot act on a colleague the owner gave more access', async () => {
      const accountant = await hire(alpha.ownerToken, StaffRole.CUSTOM, [
        Permission.EARNINGS_VIEW,
      ]);
      const res = await seed
        .as(manager.token, 'patch', `/vendor/staff/${accountant.id}/status`)
        .send({ status: 'suspended' });
      expect(res.status).toBe(403);
    }, 60_000);

    it('a preset with a list attached is a 400, and a staff member without staff.manage is a 403', async () => {
      const res = await seed
        .as(alpha.ownerToken, 'post', '/vendor/staff')
        .send({
          name: 'Confused',
          phone: uniquePhone(),
          password: runPassword(),
          staffRole: StaffRole.BILLER,
          permissions: [Permission.BILLING_VIEW],
        });
      expect(res.status).toBe(400);

      const supervisor = await hire(alpha.ownerToken, StaffRole.SUPERVISOR);
      const hireAttempt = await seed
        .as(supervisor.token, 'post', '/vendor/staff')
        .send({
          name: 'Nope',
          phone: uniquePhone(),
          password: runPassword(),
          staffRole: StaffRole.BILLER,
        });
      expect(hireAttempt.status).toBe(403);
    }, 60_000);

    it('the password is validated and never returned', async () => {
      const short = await seed
        .as(alpha.ownerToken, 'post', '/vendor/staff')
        .send({ name: 'Short', phone: uniquePhone(), password: 'tooShort1', staffRole: StaffRole.BILLER });
      expect(short.status).toBe(400);

      const password = runPassword();
      const ok = await seed
        .as(alpha.ownerToken, 'post', '/vendor/staff')
        .send({ name: 'Long', phone: uniquePhone(), password, staffRole: StaffRole.BILLER });
      expect(ok.status).toBe(201);
      expect(JSON.stringify(ok.body)).not.toContain(password);
      expect(ok.body).not.toHaveProperty('passwordHash');
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  5. Revocation is immediate
  // ══════════════════════════════════════════════════════════════════

  it('revoking a permission takes effect on the next request with the same token', async () => {
    const staff = await hire(alpha.ownerToken, StaffRole.ORDERS);
    expect((await seed.as(staff.token, 'get', '/vendor/orders')).status).toBe(200);
    expect((await seed.as(staff.token, 'get', '/vendor/pos/sales')).status).toBe(403);

    const change = await seed
      .as(alpha.ownerToken, 'patch', `/vendor/staff/${staff.id}`)
      .send({ staffRole: StaffRole.BILLER });
    expect(change.status).toBe(200);
    expect(change.body.staffRole).toBe(StaffRole.BILLER);

    // SAME token — nothing re-issued.
    expect((await seed.as(staff.token, 'get', '/vendor/orders')).status).toBe(403);
    expect((await seed.as(staff.token, 'get', '/vendor/pos/sales')).status).toBe(200);

    // CUSTOM list edits bite the same way.
    await seed
      .as(alpha.ownerToken, 'patch', `/vendor/staff/${staff.id}`)
      .send({ staffRole: StaffRole.CUSTOM, permissions: [Permission.PRODUCTS_VIEW] });
    expect((await seed.as(staff.token, 'get', '/vendor/pos/sales')).status).toBe(403);
    expect((await seed.as(staff.token, 'get', '/vendor/products')).status).toBe(200);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  6. Suspension and deletion lock the account out
  // ══════════════════════════════════════════════════════════════════

  it('suspended staff are locked out of the token, the refresh cookie and the login', async () => {
    const staff = await hire(alpha.ownerToken, StaffRole.MANAGER);
    const login = await seed.login(staff.phone, staff.password);
    const cookie = readCookie(login.headers['set-cookie'], 'tokri_rt');
    expect(cookie).toBeTruthy();

    const suspend = await seed
      .as(alpha.ownerToken, 'patch', `/vendor/staff/${staff.id}/status`)
      .send({ status: UserStatus.SUSPENDED, reason: 'Left the shop' });
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe(UserStatus.SUSPENDED);

    expect((await seed.as(staff.token, 'get', '/vendor/me')).status).toBe(401);
    expect((await seed.as(staff.token, 'get', '/vendor/orders')).status).toBe(401);

    const refresh = await request(seed.server)
      .post('/auth/refresh')
      .set('X-Forwarded-For', nextIp())
      .set('Cookie', `tokri_rt=${cookie}`);
    expect(refresh.status).toBe(401);

    expect((await seed.login(staff.phone, staff.password)).status).toBe(401);

    // Reinstated: back in with the same password.
    await seed
      .as(alpha.ownerToken, 'patch', `/vendor/staff/${staff.id}/status`)
      .send({ status: UserStatus.ACTIVE });
    expect((await seed.login(staff.phone, staff.password)).status).toBe(200);

    // Deleted: gone for good.
    const del = await seed.as(alpha.ownerToken, 'delete', `/vendor/staff/${staff.id}`);
    expect(del.status).toBe(204);
    expect((await seed.login(staff.phone, staff.password)).status).toBe(401);
    expect((await seed.as(staff.token, 'get', '/vendor/me')).status).toBe(401);
  }, 60_000);

  it("a store suspended by the platform takes its staff's access with it", async () => {
    // Staff work FOR a store: suspending the store used to lock only the
    // owner, and its employees kept billing and packing.
    const charlie = await seed.store('Charlie', [{ name: 'Charlie Atta', price: 5_000, mrp: 5_500 }]);
    const staff = await hire(charlie.ownerToken, StaffRole.BILLER);
    expect((await seed.as(staff.token, 'get', '/vendor/me')).status).toBe(200);

    const suspend = await seed
      .as(adminToken, 'patch', `/admin/vendors/${charlie.vendorId}/status`)
      .send({ status: 'suspended', reason: 'Failed food-safety inspection' });
    expect(suspend.status).toBe(200);

    expect((await seed.as(staff.token, 'get', '/vendor/me')).status).toBe(401);
    expect((await seed.as(staff.token, 'get', '/vendor/pos/sales')).status).toBe(401);
    expect((await seed.login(staff.phone, staff.password)).status).toBe(401);

    const reinstate = await seed
      .as(adminToken, 'patch', `/admin/vendors/${charlie.vendorId}/status`)
      .send({ status: 'approved' });
    expect(reinstate.status).toBe(200);
    expect((await seed.login(staff.phone, staff.password)).status).toBe(200);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  7. Audit + the admin view
  // ══════════════════════════════════════════════════════════════════

  it('audits every staff write without the password', async () => {
    const before = await audit.countDocuments({ action: /^vendor\.staff\./ }).exec();
    const staff = await hire(alpha.ownerToken, StaffRole.ORDERS);
    await seed
      .as(alpha.ownerToken, 'patch', `/vendor/staff/${staff.id}`)
      .send({ shiftLabel: 'Evening' });
    await seed
      .as(alpha.ownerToken, 'patch', `/vendor/staff/${staff.id}/status`)
      .send({ status: 'suspended' });
    await seed.as(alpha.ownerToken, 'delete', `/vendor/staff/${staff.id}`);

    const entries = await audit
      .find({ action: /^vendor\.staff\./, entityId: staff.id })
      .lean()
      .exec();
    expect(entries.map((entry) => entry.action).sort()).toEqual([
      'vendor.staff.create',
      'vendor.staff.delete',
      'vendor.staff.status',
      'vendor.staff.update',
    ]);
    expect(await audit.countDocuments({ action: /^vendor\.staff\./ }).exec()).toBe(before + 4);
    expect(JSON.stringify(entries)).not.toContain(staff.password);
  }, 60_000);

  it('admins see a store’s staff read-only; a store token cannot use that route', async () => {
    const staff = await hire(alpha.ownerToken, StaffRole.SUPERVISOR);
    const res = await seed.as(adminToken, 'get', `/admin/vendors/${alpha.vendorId}/staff`);
    expect(res.status).toBe(200);
    const row = (res.body as { id: string; staffRole: string; permissions: string[] }[]).find(
      (entry) => entry.id === staff.id,
    );
    expect(row?.staffRole).toBe(StaffRole.SUPERVISOR);
    expect(row?.permissions.sort()).toEqual([...STAFF_PRESETS.SUPERVISOR].sort());
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    // Nothing of store B leaks into store A's list.
    expect(
      (res.body as { id: string }[]).every((entry) => entry.id !== bravo.ownerId),
    ).toBe(true);

    expect(
      (await seed.as(alpha.ownerToken, 'get', `/admin/vendors/${alpha.vendorId}/staff`)).status,
    ).toBe(403);
    expect(
      (await seed.as(adminToken, 'get', `/admin/vendors/${GHOST}/staff`)).status,
    ).toBe(404);
  }, 60_000);
});
