import * as Joi from 'joi';

/**
 * THE CONFIGURATION GATE.
 *
 * Every secret below is `.required()` with NO `.default()`.
 * A missing value means the process REFUSES to boot — it never starts
 * in a degraded, half-configured state.
 *
 * The pattern this exists to make impossible:
 *
 *     const secret = process.env.JWT_SECRET || 'dev-secret';   // ❌ BANNED
 *
 * A fallback lets the app boot while misconfigured and sign real tokens
 * with a known string. Nobody notices until the breach.
 *
 * Defaults are permitted ONLY for non-secret operational values
 * (port, TTLs, throttle limits) — never for a credential, key or origin.
 */
export const envValidationSchema = Joi.object({
  // ── Runtime ─────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .required(),
  PORT: Joi.number().port().default(4000),
  API_PREFIX: Joi.string().default('api/v1'),

  // ── CORS ────────────────────────────────────────────────────────
  // Required, and explicitly rejected if set to '*'. A wildcard origin
  // with credentials enabled is a cross-origin credential leak.
  CORS_ORIGINS: Joi.string()
    .required()
    .invalid('*')
    .messages({
      'any.invalid':
        'CORS_ORIGINS must be an explicit comma-separated allowlist, never "*".',
    }),
  CORS_CREDENTIALS: Joi.boolean().default(true),

  // ── Cookies ─────────────────────────────────────────────────────
  COOKIE_DOMAIN: Joi.string().required(),
  COOKIE_SECURE: Joi.boolean().default(true),

  // ── Database ────────────────────────────────────────────────────
  // A pattern, not Joi's .uri(): a replica-set URI lists several hosts
  // separated by commas, which .uri() rejects as a malformed authority.
  MONGO_URI: Joi.string()
    .pattern(/^mongodb(\+srv)?:\/\/\S+$/)
    .required()
    .messages({
      'string.pattern.base':
        'MONGO_URI must start with mongodb:// or mongodb+srv://',
    }),
  MONGO_DB_NAME: Joi.string().required(),

  // ── Redis ───────────────────────────────────────────────────────
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),

  // ── Auth secrets ────────────────────────────────────────────────
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .required()
    .invalid(Joi.ref('JWT_ACCESS_SECRET'))
    .messages({
      'any.invalid':
        'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET. Sharing one secret ' +
        'means an access token can be replayed as a refresh token.',
    }),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  ARGON2_PEPPER: Joi.string().min(32).required(),

  // ── Rate limiting ───────────────────────────────────────────────
  THROTTLE_TTL_MS: Joi.number().default(60_000),
  THROTTLE_LIMIT: Joi.number().default(100),
  THROTTLE_AUTH_LIMIT: Joi.number().default(5),

  // ── Seed accounts ───────────────────────────────────────────────
  // Seed credentials are configuration, not code. Changing the bootstrap
  // admin password must never require editing a source file.
  SEED_SUPERADMIN_NAME: Joi.string().required(),
  SEED_SUPERADMIN_EMAIL: Joi.string().email().required(),
  SEED_SUPERADMIN_PHONE: Joi.string().pattern(/^\d{10}$/).required(),
  SEED_SUPERADMIN_PASSWORD: Joi.string().min(12).required(),

  SEED_ADMIN_NAME: Joi.string().required(),
  SEED_ADMIN_EMAIL: Joi.string().email().required(),
  SEED_ADMIN_PHONE: Joi.string().pattern(/^\d{10}$/).required(),
  SEED_ADMIN_PASSWORD: Joi.string().min(12).required(),

  // ── Demo data (used ONLY by `pnpm seed:demo`) ───────────────────
  // Deliberately OPTIONAL, unlike the two bootstrap accounts above.
  //
  // The API has no use for it, so making it `.required()` would stop a
  // production deployment booting over a variable it will never read.
  // The demo seeder reads it with `config.getOrThrow()`, so the SEEDER
  // refuses to run without it while the application does not care —
  // fail-fast where it matters, and nowhere else.
  //
  // Still constrained when present: a 6-character demo password on a
  // shared staging database is a real account with a real session.
  SEED_DEMO_PASSWORD: Joi.string().min(12),

  // ── Maps (used ONLY when geocoding an address) ──────────────────
  // OPTIONAL, for the same reason as SEED_DEMO_PASSWORD above: the API
  // has no use for it on a deployment that does not geocode, so
  // `.required()` would refuse to boot over an unused feature.
  //
  // `GeoService` reads it with `get()` and throws a clear "maps not
  // configured" error on the one call that needs it. Distance, ETA and
  // rider payout come from the stored 2dsphere points and never touch
  // this key — nothing else degrades.
  //
  // This is the SERVER key: IP-restricted, never sent to a browser. The
  // referrer-restricted browser key is a different value and lives
  // behind the NEXT_PUBLIC_ boundary in the web app.
  GOOGLE_MAPS_SERVER_KEY: Joi.string().min(20),
}).unknown(true);
