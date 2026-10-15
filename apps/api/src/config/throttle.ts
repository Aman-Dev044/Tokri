/**
 * Rate limits that a route decorator needs, resolved at REQUEST time.
 *
 * ── Why this file exists at all ──────────────────────────────────────────
 * `THROTTLE_AUTH_LIMIT` used to be dead configuration: declared in `.env`,
 * `.env.example`, the Joi schema and `configuration.ts`, and read by
 * nothing. `POST /auth/login` hardcoded `limit: 5`, so editing the
 * variable did precisely nothing while looking like it should work — the
 * worst kind of knob.
 *
 * ── Why a function, not a number ─────────────────────────────────────────
 * A decorator argument is evaluated when its file is first IMPORTED, and
 * that is before `ConfigModule.forRoot()` reads `.env`: `AppModule`
 * imports `AuthModule` at the top of the file, while `ConfigModule` is
 * constructed inside the `@Module({...})` expression below it. The test
 * suite is starker still — `test/utils/test-app.ts` imports `AppModule` on
 * line 8 and only calls `applyTestEnv()` inside `createTestApp()`. Read
 * eagerly, the value is always `undefined`.
 *
 * @nestjs/throttler's `Resolvable<number>` accepts a function it calls per
 * request, by which time the environment is both loaded and Joi-validated.
 * `ConfigService` is not reachable from a decorator, so this reads
 * `process.env` directly — which is exactly what `src/config/**` is carved
 * out of the `no-restricted-properties` rule to do.
 *
 * ── Why it throws rather than defaulting ─────────────────────────────────
 * A fallback would silently reinstate the original bug: the variable would
 * appear to work while the real limit came from a literal. The Joi schema
 * already guarantees these are present, so this can only fire if someone
 * removes them from it — precisely when a loud failure is wanted.
 */

function readPositiveInt(name: string): number {
  const raw = process.env[name];
  const value = Number(raw);
  if (raw === undefined || raw === '' || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `${name} is not set to a positive number. It gates how often anyone ` +
        'may attempt a password, so there is no safe value to assume.',
    );
  }
  return value;
}

/**
 * The login throttle, for `@Throttle({ default: authThrottle() })`.
 *
 * Every OTHER `@Throttle` on the auth controller keeps a literal on
 * purpose. A 3-per-minute cap on `register/request-otp` is a security
 * property of that endpoint — it is what stops someone running up an SMS
 * bill on a stranger's number — not an operational setting anyone should
 * turn up from a config file. Only the login limit is exposed, because
 * only the login limit has ever needed to differ between a developer
 * testing five roles and a production deployment under attack.
 */
export function authThrottle(): { limit: () => number; ttl: () => number } {
  return {
    limit: () => readPositiveInt('THROTTLE_AUTH_LIMIT'),
    ttl: () => readPositiveInt('THROTTLE_TTL_MS'),
  };
}
