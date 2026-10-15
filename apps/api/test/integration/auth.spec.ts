import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { User, UserDocument } from '../../src/database/schemas/user.schema';
import { Role, UserStatus } from '../../src/common/constants/roles.enum';
import { PasswordService } from '../../src/common/utils/password.service';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
  rawCookie,
  readCookie,
} from '../utils/test-app';

/**
 * Read from the environment, never hardcoded. The cookie name is
 * configuration (REFRESH_COOKIE_NAME), so a literal here would turn a
 * rename into three confusing assertion failures instead of a clear one.
 *
 * No `?? 'tokri_rt'` fallback: that is exactly the pattern the repo's
 * ESLint rule bans, and the reasoning holds in a test too. A default here
 * would let the suite pass against a cookie the app never sets, which is
 * worse than a missing-variable error — `test-env.ts` supplies it.
 */
const REFRESH_COOKIE = (() => {
  const name = process.env.REFRESH_COOKIE_NAME;
  if (!name) {
    throw new Error(
      'REFRESH_COOKIE_NAME is not set. test/utils/test-env.ts must supply it.',
    );
  }
  return name;
})();

/** Long enough to satisfy the DTO; generated per-run, never a literal. */
const PASSWORD = `Pw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

describe('Authentication (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let users: Model<UserDocument>;
  let passwords: PasswordService;

  let phoneCounter = 0;

  /** Creates an ACTIVE customer with a unique identity. */
  async function seedUser(
    overrides: Partial<{ status: UserStatus; role: Role }> = {},
  ): Promise<{ id: string; phone: string; email: string }> {
    const n = String(++phoneCounter).padStart(4, '0');
    const phone = `98${n}00000`.slice(0, 10);
    const email = `user${n}@test.invalid`;

    const created = await users.create({
      name: `Test User ${n}`,
      email,
      phone,
      passwordHash: await passwords.hash(PASSWORD),
      role: overrides.role ?? Role.CUSTOMER,
      status: overrides.status ?? UserStatus.ACTIVE,
      isSystemAccount: false,
    });

    return { id: created._id.toString(), phone, email };
  }

  const login = (identifier: string, password: string) =>
    request(server)
      .post('/auth/login')
      .set('X-Forwarded-For', nextIp())
      .send({ identifier, password });

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
    users = ctx.app.get<Model<UserDocument>>(getModelToken(User.name));
    passwords = ctx.app.get(PasswordService);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  Login
  // ══════════════════════════════════════════════════════════════════

  describe('POST /auth/login', () => {
    it('issues an access token in the body and the refresh token in an httpOnly cookie', async () => {
      const user = await seedUser();

      const res = await login(user.email, PASSWORD);

      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.accessToken.split('.')).toHaveLength(3);
      expect(res.body.user.id).toBe(user.id);

      // The refresh token must NOT be in the body — a token in the JSON
      // response ends up in localStorage, which any XSS can read.
      expect(res.body.refreshToken).toBeUndefined();

      const cookie = rawCookie(res.headers['set-cookie'], REFRESH_COOKIE);
      expect(cookie).toBeDefined();
      // httpOnly: JavaScript cannot read it, so XSS cannot exfiltrate it.
      expect(cookie).toMatch(/HttpOnly/i);
      // SameSite=Strict: the cookie is not attached to cross-site requests,
      // which is what makes CSRF against /auth/refresh a non-event.
      expect(cookie).toMatch(/SameSite=Strict/i);
    });

    it('accepts a phone number as the identifier', async () => {
      const user = await seedUser();
      const res = await login(user.phone, PASSWORD);
      expect(res.status).toBe(200);
    });

    // ── NO USER ENUMERATION ────────────────────────────────────────
    // The single most common information leak in a login form: "no such
    // account" vs "wrong password" tells an attacker which addresses are
    // registered. They harvest a valid user list, then credential-stuff
    // only those. Both answers must be byte-identical.
    it('returns an IDENTICAL 401 for a wrong password and for an unknown user', async () => {
      const user = await seedUser();

      const wrongPassword = await login(user.email, `${PASSWORD}-wrong`);
      const unknownUser = await login(
        'definitely-not-registered@test.invalid',
        PASSWORD,
      );

      expect(wrongPassword.status).toBe(401);
      expect(unknownUser.status).toBe(401);

      expect(unknownUser.body.detail).toBe(wrongPassword.body.detail);
      expect(unknownUser.body.title).toBe(wrongPassword.body.title);
      expect(unknownUser.body.status).toBe(wrongPassword.body.status);

      // And the message must not name the failing factor either.
      expect(String(wrongPassword.body.detail).toLowerCase()).not.toMatch(
        /password|email|phone|user|account|exist/,
      );
    });

    it('never leaks the password hash in a response', async () => {
      const user = await seedUser();
      const res = await login(user.email, PASSWORD);
      expect(JSON.stringify(res.body)).not.toMatch(/\$argon2|passwordHash/);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Deny by default
  // ══════════════════════════════════════════════════════════════════

  describe('GET /auth/me', () => {
    it('rejects an anonymous request with 401 (deny-by-default)', async () => {
      const res = await request(server)
        .get('/auth/me')
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(401);
    });

    it('rejects a malformed bearer token with 401', async () => {
      const res = await request(server)
        .get('/auth/me')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', 'Bearer not.a.jwt');

      expect(res.status).toBe(401);
    });

    it('returns the caller for a valid token', async () => {
      const user = await seedUser();
      const { body } = await login(user.email, PASSWORD);

      const res = await request(server)
        .get('/auth/me')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${body.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.role).toBe(Role.CUSTOMER);
      expect(res.body.passwordHash).toBeUndefined();
    });

    // ── SUSPENSION TAKES EFFECT IMMEDIATELY ────────────────────────
    // A valid signature is not authorisation. If the token alone were
    // trusted, a user suspended for fraud would keep full access for up
    // to fifteen minutes — long enough to finish what they were doing.
    // `JwtStrategy.validate` re-reads `status` from the database on every
    // single request, so the very next call fails.
    it('rejects a structurally valid token once the account is suspended', async () => {
      const user = await seedUser();
      const { body } = await login(user.email, PASSWORD);
      const token = body.accessToken as string;

      // Prove the token works before the suspension.
      const before = await request(server)
        .get('/auth/me')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);

      await users
        .updateOne({ _id: user.id }, { status: UserStatus.SUSPENDED })
        .exec();

      const after = await request(server)
        .get('/auth/me')
        .set('X-Forwarded-For', nextIp())
        .set('Authorization', `Bearer ${token}`);

      expect(after.status).toBe(401);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Refresh rotation with reuse detection
  // ══════════════════════════════════════════════════════════════════

  describe('POST /auth/refresh', () => {
    const refresh = (token: string) =>
      request(server)
        .post('/auth/refresh')
        .set('X-Forwarded-For', nextIp())
        .set('Cookie', `${REFRESH_COOKIE}=${token}`);

    it('rotates the refresh token and issues a new access token', async () => {
      const user = await seedUser();
      const loginRes = await login(user.email, PASSWORD);
      const rt1 = readCookie(loginRes.headers['set-cookie'], REFRESH_COOKIE);
      expect(rt1).toBeDefined();

      const res = await refresh(rt1 as string);
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');

      const rt2 = readCookie(res.headers['set-cookie'], REFRESH_COOKIE);
      expect(rt2).toBeDefined();
      // Rotation: a NEW token every time. Reusing the same string would
      // make theft permanent.
      expect(rt2).not.toBe(rt1);
    });

    it('rejects a request with no refresh cookie', async () => {
      const res = await request(server)
        .post('/auth/refresh')
        .set('X-Forwarded-For', nextIp());

      expect(res.status).toBe(401);
    });

    // ── THE ONE THAT MATTERS ───────────────────────────────────────
    // Replaying a refresh token is the signature of a stolen token: the
    // legitimate client already rotated it, so a second presentation means
    // someone else has a copy. The response is not merely "no" — the whole
    // token FAMILY is revoked, which logs out the thief AND the real user.
    // That is what makes a stolen refresh token worthless: the thief's
    // first use burns the session, and the victim notices at once.
    it('revokes the ENTIRE token family when a refresh token is replayed', async () => {
      const user = await seedUser();
      const loginRes = await login(user.email, PASSWORD);
      const rt1 = readCookie(
        loginRes.headers['set-cookie'],
        REFRESH_COOKIE,
      ) as string;

      // 1. Legitimate rotation.
      const first = await refresh(rt1);
      expect(first.status).toBe(200);
      const rt2 = readCookie(
        first.headers['set-cookie'],
        REFRESH_COOKIE,
      ) as string;

      // 2. The thief replays the already-spent token.
      const replay = await refresh(rt1);
      expect(replay.status).toBe(401);

      // 3. The LEGITIMATE current token is now dead too — the family was
      //    revoked. Without this, reuse detection would only inconvenience
      //    the attacker while the victim carried on unaware.
      const legitimate = await refresh(rt2);
      expect(legitimate.status).toBe(401);

      // 4. And the server state confirms it, not just the status codes.
      const stored = await users
        .findById(user.id)
        .select('+refreshTokenHash +refreshTokenFamily')
        .lean<{
          refreshTokenHash?: string | null;
          refreshTokenFamily?: string | null;
        } | null>()
        .exec();

      expect(stored?.refreshTokenHash).toBeNull();
      expect(stored?.refreshTokenFamily).toBeNull();
    });

    it('rejects a refresh token signed with the wrong secret', async () => {
      const res = await refresh('eyJhbGciOiJIUzI1NiJ9.e30.not-a-real-signature');
      expect(res.status).toBe(401);
    });
  });
});
