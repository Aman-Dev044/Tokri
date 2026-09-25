import { randomBytes } from 'node:crypto';

/**
 * Ephemeral, single-use secrets for the test process.
 *
 * These are GENERATED, not written down. Nothing here is a credential that
 * could be copied into an environment — which is the point: a test fixture
 * containing a literal `'test-secret'` is one careless copy-paste away from
 * being the production value, and the whole §4.1 rule exists to prevent
 * exactly that.
 */
const ephemeralSecret = (): string => randomBytes(24).toString('hex'); // 48 chars

/**
 * Populates `process.env` with a COMPLETE, VALID configuration.
 *
 * Must run before the Nest application is compiled, because
 * `ConfigModule.forRoot` validates the environment against the Joi schema
 * during module initialisation and refuses to boot on any missing value.
 *
 * `@nestjs/config` never overwrites a variable that is already present in
 * `process.env`, so these win over the developer's real `.env` file.
 */
export function applyTestEnv(mongoUri: string): void {
  const accessSecret = ephemeralSecret();
  let refreshSecret = ephemeralSecret();

  // The schema rejects identical access/refresh secrets. Astronomically
  // unlikely from 24 random bytes, but the invariant is cheap to assert.
  while (refreshSecret === accessSecret) refreshSecret = ephemeralSecret();

  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: '4100',
    API_PREFIX: 'api/v1',

    // Never '*' — the Joi schema rejects a wildcard outright.
    CORS_ORIGINS: 'http://localhost:3000',
    CORS_CREDENTIALS: 'true',

    COOKIE_DOMAIN: 'localhost',
    // Supertest speaks plain HTTP; a Secure cookie would never be stored.
    COOKIE_SECURE: 'false',

    MONGO_URI: mongoUri,
    MONGO_DB_NAME: 'mandi_test',

    // Nothing in the current module graph connects to Redis; the value
    // exists only to satisfy the schema.
    REDIS_URL: 'redis://127.0.0.1:6379',

    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: refreshSecret,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
    ARGON2_PEPPER: ephemeralSecret(),

    // The GLOBAL throttle is raised so a test suite's request volume does
    // not trip it. Per-route limits (@Throttle on /auth/login) are left at
    // their real values — those are part of what is under test, and the
    // specs use a distinct source IP per case rather than weakening them.
    THROTTLE_TTL_MS: '60000',
    THROTTLE_LIMIT: '100000',
    THROTTLE_AUTH_LIMIT: '5',

    SEED_SUPERADMIN_NAME: 'Test Super Admin',
    SEED_SUPERADMIN_EMAIL: 'superadmin@test.invalid',
    SEED_SUPERADMIN_PHONE: '9000000001',
    SEED_SUPERADMIN_PASSWORD: ephemeralSecret(),

    SEED_ADMIN_NAME: 'Test Admin',
    SEED_ADMIN_EMAIL: 'admin@test.invalid',
    SEED_ADMIN_PHONE: '9000000002',
    SEED_ADMIN_PASSWORD: ephemeralSecret(),
  });
}
