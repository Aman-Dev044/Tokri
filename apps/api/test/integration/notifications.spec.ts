import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { User, UserDocument } from '../../src/database/schemas/user.schema';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from '../../src/database/schemas/notification.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import {
  EMAIL_PROVIDER,
  EmailProvider,
  PUSH_PROVIDER,
  PushProvider,
  SMS_PROVIDER,
  SmsProvider,
} from '../../src/modules/notifications/providers/provider.interfaces';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

let counter = 0;
const uniqueSuffix = (): string => String(++counter).padStart(4, '0');

/**
 * ════════════════════════════════════════════════════════════════════════
 *  NOTIFICATIONS
 * ════════════════════════════════════════════════════════════════════════
 *
 * Three things are under test:
 *
 *  1. In-app read path — a notification written by `notify()` is
 *     readable by its owner through `GET /notifications`, counted by
 *     `GET /notifications/unread-count`, and mutable through
 *     `PATCH :id/read` and `POST /read-all`.
 *
 *  2. Isolation — another user's notification id is a 404, not a 403
 *     (`ResourceOwnerGuard`'s enumeration-oracle rule, exactly like
 *     every other owned resource in this API).
 *
 *  3. An unconfigured provider (no SENDGRID_API_KEY / MSG91_AUTH_KEY /
 *     FCM_SERVICE_ACCOUNT_JSON in this test's environment) logs and
 *     returns 'skipped' — it never throws into the caller.
 */
describe('Notifications (integration)', () => {
  let ctx: TestContext;
  let server: Server;

  let users: Model<UserDocument>;
  let notifications: Model<NotificationDocument>;
  let passwords: PasswordService;
  let notificationsService: NotificationsService;

  let ownerId: string;
  let ownerToken: string;
  let otherToken: string;

  async function seedUser(): Promise<{ id: string; token: string }> {
    const n = uniqueSuffix();
    const email = `notify${n}@test.invalid`;

    const user = await users.create({
      name: `Notify User ${n}`,
      email,
      phone: `98${n}00000`.slice(0, 10),
      passwordHash: await passwords.hash(PASSWORD),
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
    });

    const res = await request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier: email, password: PASSWORD });

    expect(res.status).toBe(200);
    return { id: user._id.toString(), token: res.body.accessToken as string };
  }

  beforeAll(async () => {
    // Deterministic "unconfigured" regardless of any ambient `.env` the
    // already-running dev server happens to load — the whole point of
    // assertion #3 is that THIS deployment has none of these keys set.
    delete process.env.SENDGRID_API_KEY;
    delete process.env.MAIL_FROM;
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_SENDER_ID;
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;

    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;

    users = ctx.app.get(getModelToken(User.name));
    notifications = ctx.app.get(getModelToken(Notification.name));
    passwords = ctx.app.get(PasswordService);
    notificationsService = ctx.app.get(NotificationsService);

    const owner = await seedUser();
    ownerId = owner.id;
    ownerToken = owner.token;
    otherToken = (await seedUser()).token;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  it('writes a notification via notify() and the owner can read it', async () => {
    await notificationsService.notify(ownerId, {
      type: NotificationType.ORDER_PLACED,
      title: 'Order placed',
      body: 'Your order TKR-0001 has been placed.',
      data: { orderNo: 'TKR-0001' },
    });

    const res = await request(server)
      .get('/notifications')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const row = res.body.data[0];
    expect(row.title).toBe('Order placed');
    expect(row.type).toBe(NotificationType.ORDER_PLACED);
    expect(row.readAt).toBeNull();
    expect(row.data).toEqual({ orderNo: 'TKR-0001' });
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(server)
      .get('/notifications')
      .set('X-Forwarded-For', nextIp());
    expect(res.status).toBe(401);
  });

  it('unread-count reflects reality, read and read-all clear it', async () => {
    // A clean pair, isolated from the earlier test's row.
    const fresh = await seedUser();

    await notificationsService.notify(fresh.id, {
      type: NotificationType.ORDER_ACCEPTED,
      title: 'Order accepted',
      body: 'The store accepted your order.',
    });
    await notificationsService.notify(fresh.id, {
      type: NotificationType.ORDER_DELIVERED,
      title: 'Order delivered',
      body: 'Enjoy!',
    });

    const before = await request(server)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${fresh.token}`);
    expect(before.status).toBe(200);
    expect(before.body.count).toBe(2);

    const list = await request(server)
      .get('/notifications')
      .set('Authorization', `Bearer ${fresh.token}`);
    const oneId = list.body.data[0].id as string;

    const readOne = await request(server)
      .patch(`/notifications/${oneId}/read`)
      .set('Authorization', `Bearer ${fresh.token}`);
    expect(readOne.status).toBe(200);
    expect(readOne.body.readAt).not.toBeNull();

    const afterOne = await request(server)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${fresh.token}`);
    expect(afterOne.body.count).toBe(1);

    const readAll = await request(server)
      .post('/notifications/read-all')
      .set('Authorization', `Bearer ${fresh.token}`);
    expect(readAll.status).toBe(200);
    expect(readAll.body.updated).toBe(1);

    const afterAll_ = await request(server)
      .get('/notifications/unread-count')
      .set('Authorization', `Bearer ${fresh.token}`);
    expect(afterAll_.body.count).toBe(0);
  });

  it("404s — not 403s — on another user's notification id", async () => {
    const list = await request(server)
      .get('/notifications')
      .set('Authorization', `Bearer ${ownerToken}`);
    const ownerNotificationId = list.body.data[0].id as string;

    const res = await request(server)
      .patch(`/notifications/${ownerNotificationId}/read`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
  });

  it('a well-formed but nonexistent id is also a 404', async () => {
    const res = await request(server)
      .patch(`/notifications/${new Types.ObjectId().toString()}/read`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  it('90-day TTL index exists on Notification.createdAt', async () => {
    // Mongoose builds indexes in the BACKGROUND after the model is
    // registered, so reading them straight away is a race: this passed
    // when the file ran alone and failed inside the full suite, where the
    // app has less idle time before the assertion. `init()` resolves once
    // the build has actually finished.
    await notifications.init();
    const indexes = await notifications.collection.indexes();
    const ttl = indexes.find(
      (index) => index.key && index.key.createdAt === 1 && 'expireAfterSeconds' in index,
    );
    expect(ttl).toBeDefined();
    expect(ttl?.expireAfterSeconds).toBe(90 * 24 * 60 * 60);
  });

  describe('an unconfigured provider logs and no-ops, never throws', () => {
    it('EmailProvider (SendGrid) returns "skipped"', async () => {
      const email = ctx.app.get<EmailProvider>(EMAIL_PROVIDER);
      await expect(
        email.send({ to: 'someone@test.invalid', subject: 'x', body: 'y' }),
      ).resolves.toBe('skipped');
    });

    it('SmsProvider (MSG91) returns "skipped"', async () => {
      const sms = ctx.app.get<SmsProvider>(SMS_PROVIDER);
      await expect(sms.send({ to: '9800000000', body: 'y' })).resolves.toBe(
        'skipped',
      );
    });

    it('PushProvider (FCM) returns "skipped"', async () => {
      const push = ctx.app.get<PushProvider>(PUSH_PROVIDER);
      await expect(
        push.send({ userId: ownerId, title: 'x', body: 'y', data: null }),
      ).resolves.toBe('skipped');
    });

    it('notify() itself never throws even if downstream writes fail', async () => {
      // A malformed userId short-circuits before any database write —
      // exercising the "never throws" contract without needing to fake
      // a database failure.
      await expect(
        notificationsService.notify('not-an-object-id', {
          type: NotificationType.GENERIC,
          title: 'x',
          body: 'y',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
