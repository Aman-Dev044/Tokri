import { randomBytes } from 'node:crypto';

import { envValidationSchema } from '../../src/config/env.validation';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE CONFIGURATION GATE
 * ════════════════════════════════════════════════════════════════════════
 *
 * `ConfigModule.forRoot({ validationSchema })` runs this schema before any
 * other module initialises. If it rejects, the process never starts.
 *
 * That is the entire "zero hardcoded credentials" guarantee: because there
 * is no fallback ANYWHERE in the codebase (enforced by the ESLint rule in
 * `@mandi/config/eslint/base.cjs`), a missing secret cannot be papered
 * over at runtime — the only possible outcome is a boot failure.
 *
 * These tests assert the four invariants that make that true. Each one
 * corresponds to a real, well-documented production incident class.
 */

/** A syntactically valid secret of the required length. */
const secret = (): string => randomBytes(24).toString('hex'); // 48 chars

/** A complete, valid environment — the baseline every case mutates. */
function validEnv(): Record<string, string> {
  const accessSecret = secret();
  return {
    NODE_ENV: 'test',
    PORT: '4000',
    API_PREFIX: 'api/v1',

    // The brand is configuration, not source: the product name and the
    // refresh-cookie name both come from the environment so renaming the
    // product never means a find-and-replace.
    APP_NAME: 'Tokri',
    ORDER_NO_PREFIX: 'TKR',
    REFRESH_COOKIE_NAME: 'tokri_rt',

    CORS_ORIGINS: 'http://localhost:3000,https://tokri.app',
    CORS_CREDENTIALS: 'true',

    COOKIE_DOMAIN: 'localhost',
    COOKIE_SECURE: 'false',

    MONGO_URI: 'mongodb://127.0.0.1:27017',
    MONGO_DB_NAME: 'mandi',

    REDIS_URL: 'redis://127.0.0.1:6379',

    JWT_ACCESS_SECRET: accessSecret,
    JWT_REFRESH_SECRET: secret(),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '7d',
    ARGON2_PEPPER: secret(),

    THROTTLE_TTL_MS: '60000',
    THROTTLE_LIMIT: '100',
    THROTTLE_AUTH_LIMIT: '5',

    SEED_SUPERADMIN_NAME: 'Super Admin',
    SEED_SUPERADMIN_EMAIL: 'superadmin@mandi.app',
    SEED_SUPERADMIN_PHONE: '9000000001',
    SEED_SUPERADMIN_PASSWORD: secret(),

    SEED_ADMIN_NAME: 'Admin',
    SEED_ADMIN_EMAIL: 'admin@mandi.app',
    SEED_ADMIN_PHONE: '9000000002',
    SEED_ADMIN_PASSWORD: secret(),
  };
}

/** Validates exactly as `ConfigModule` does, reporting every error at once. */
const validate = (env: Record<string, string>) =>
  envValidationSchema.validate(env, { abortEarly: false });

describe('Environment validation (the config gate)', () => {
  it('accepts a complete, well-formed environment', () => {
    const { error } = validate(validEnv());
    expect(error).toBeUndefined();
  });

  // ── 1. A MISSING SECRET MUST BE FATAL ────────────────────────────────
  // The failure mode this prevents: the app boots anyway, signs real
  // session tokens with a fallback like 'dev-secret-change-me', and every
  // token in production is forgeable by anyone who has read the repo.
  it('REJECTS a missing JWT_ACCESS_SECRET', () => {
    const env = validEnv();
    delete env.JWT_ACCESS_SECRET;

    const { error } = validate(env);

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/JWT_ACCESS_SECRET/);
  });

  it('REJECTS every missing secret, and reports them all at once', () => {
    const env = validEnv();
    delete env.JWT_ACCESS_SECRET;
    delete env.JWT_REFRESH_SECRET;
    delete env.ARGON2_PEPPER;
    delete env.MONGO_URI;

    const { error } = validate(env);

    expect(error).toBeDefined();
    // `abortEarly: false` — a developer fixes one .env file once, instead
    // of restarting four times to discover four missing variables.
    for (const key of [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'ARGON2_PEPPER',
      'MONGO_URI',
    ]) {
      expect(error?.message).toMatch(new RegExp(key));
    }
  });

  it('supplies NO default for any secret (a default IS a hardcoded credential)', () => {
    const env = validEnv();
    for (const key of [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'ARGON2_PEPPER',
      'MONGO_URI',
      'MONGO_DB_NAME',
      'REDIS_URL',
      'COOKIE_DOMAIN',
      'CORS_ORIGINS',
      'SEED_SUPERADMIN_PASSWORD',
      'SEED_ADMIN_PASSWORD',
    ]) {
      const candidate = { ...env };
      delete candidate[key];

      const { error, value } = validate(candidate);

      expect(error).toBeDefined();
      // Belt and braces: if Joi had a default it would appear on `value`.
      expect(value[key]).toBeUndefined();
    }
  });

  // ── 2. CORS MUST NEVER BE A WILDCARD ─────────────────────────────────
  // `Access-Control-Allow-Origin: *` combined with credentials is a
  // cross-origin credential leak: any site the user visits can call the
  // API with their cookies attached.
  it("REJECTS CORS_ORIGINS='*'", () => {
    const env = validEnv();
    env.CORS_ORIGINS = '*';

    const { error } = validate(env);

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/CORS_ORIGINS/);
    expect(error?.message).toMatch(/allowlist/i);
  });

  it('accepts an explicit comma-separated CORS allowlist', () => {
    const env = validEnv();
    env.CORS_ORIGINS = 'https://mandi.app,https://admin.mandi.app';

    expect(validate(env).error).toBeUndefined();
  });

  // ── 3. THE TWO JWT SECRETS MUST DIFFER ───────────────────────────────
  // Sharing one secret means an access token verifies as a refresh token.
  // A 15-minute token an attacker scraped from a log then buys them a
  // 7-day session — and rotation/reuse detection never sees it coming.
  it('REJECTS JWT_REFRESH_SECRET equal to JWT_ACCESS_SECRET', () => {
    const env = validEnv();
    env.JWT_REFRESH_SECRET = env.JWT_ACCESS_SECRET;

    const { error } = validate(env);

    expect(error).toBeDefined();
    expect(error?.message).toMatch(/JWT_REFRESH_SECRET/);
    expect(error?.message).toMatch(/differ/i);
  });

  // ── 4. SECRETS MUST BE LONG ENOUGH TO RESIST OFFLINE ATTACK ──────────
  // HMAC-SHA256 with a short key is brute-forceable offline from a single
  // captured token — there is no rate limit on the attacker's own CPU.
  it('REJECTS a secret shorter than 32 characters', () => {
    for (const key of [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'ARGON2_PEPPER',
    ]) {
      const env = validEnv();
      env[key] = 'a'.repeat(31);

      const { error } = validate(env);

      expect(error).toBeDefined();
      expect(error?.message).toMatch(new RegExp(key));
      expect(error?.message).toMatch(/32/);
    }
  });

  it('accepts a secret of exactly 32 characters', () => {
    const env = validEnv();
    env.JWT_ACCESS_SECRET = 'b'.repeat(32);
    env.JWT_REFRESH_SECRET = 'c'.repeat(32);
    env.ARGON2_PEPPER = 'd'.repeat(32);

    expect(validate(env).error).toBeUndefined();
  });

  // ── Supporting invariants ────────────────────────────────────────────

  it('REJECTS an unrecognised NODE_ENV', () => {
    const env = validEnv();
    env.NODE_ENV = 'staging';

    expect(validate(env).error).toBeDefined();
  });

  it('REJECTS a MONGO_URI that is not a mongodb:// URI', () => {
    const env = validEnv();
    env.MONGO_URI = 'http://127.0.0.1:27017';

    expect(validate(env).error).toBeDefined();
  });

  it('REJECTS a seed password shorter than 12 characters', () => {
    const env = validEnv();
    env.SEED_SUPERADMIN_PASSWORD = 'short';

    const { error } = validate(env);
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/SEED_SUPERADMIN_PASSWORD/);
  });

  it('still allows defaults for NON-secret operational values', () => {
    // PORT, TTLs and throttle limits are operational knobs, not
    // credentials. A default here cannot leak anything, and requiring one
    // in every environment file is friction with no security benefit.
    const env = validEnv();
    delete env.PORT;
    delete env.JWT_ACCESS_TTL;
    delete env.THROTTLE_LIMIT;

    const { error, value } = validate(env);

    expect(error).toBeUndefined();
    expect(value.PORT).toBe(4000);
    expect(value.JWT_ACCESS_TTL).toBe('15m');
    expect(value.THROTTLE_LIMIT).toBe(100);
  });

  // ══════════════════════════════════════════════════════════════════
  //  The rider wallet knobs
  // ══════════════════════════════════════════════════════════════════
  //
  //  These four decide how much money comes out of a real person's
  //  balance. They are not secrets, so a default is permitted — but a
  //  MAX below the MIN would make `crypto.randomInt(min, max + 1)` throw
  //  at the exact moment a rider taps Accept, which is the worst
  //  possible place to discover a typo in an environment file. The
  //  schema refuses to boot instead.

  it('defaults the rider pick-fee window to INTEGER PAISE, not rupees', () => {
    const env = validEnv();
    const { error, value } = validate(env);

    expect(error).toBeUndefined();
    // 2500 paise = Rs 25. A `25` here would be twenty-five PAISE.
    expect(value.RIDER_PICK_FEE_MIN_PAISE).toBe(2500);
    expect(value.RIDER_PICK_FEE_MAX_PAISE).toBe(5000);
    expect(value.RIDER_LOW_BALANCE_WARN_PAISE).toBe(10000);
    expect(value.RIDER_KYC_SLA_HOURS).toBe(24);
  });

  it('REFUSES TO BOOT when the pick-fee MAX is below the MIN', () => {
    const env = validEnv();
    env.RIDER_PICK_FEE_MIN_PAISE = '5000';
    env.RIDER_PICK_FEE_MAX_PAISE = '2500';

    const { error } = validate(env);
    expect(error).toBeDefined();
    expect(error?.message).toMatch(/RIDER_PICK_FEE_MAX_PAISE/);
  });

  it('accepts a window where MAX equals MIN — a fixed fee is legitimate', () => {
    const env = validEnv();
    env.RIDER_PICK_FEE_MIN_PAISE = '3000';
    env.RIDER_PICK_FEE_MAX_PAISE = '3000';

    expect(validate(env).error).toBeUndefined();
  });

  it('REJECTS a fractional or negative pick fee', () => {
    for (const bad of ['25.5', '-2500', '0']) {
      const env = validEnv();
      env.RIDER_PICK_FEE_MIN_PAISE = bad;
      expect(validate(env).error).toBeDefined();
    }
  });
});
