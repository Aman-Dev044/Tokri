/**
 * Typed configuration surface.
 *
 * Every value here originates from a validated environment variable.
 * Nothing in this file supplies a credential of its own — if a value is
 * missing, `envValidationSchema` has already stopped the process.
 */
export const configuration = () => ({
  env: process.env.NODE_ENV as 'development' | 'test' | 'production',
  port: parseInt(process.env.PORT as string, 10),
  apiPrefix: process.env.API_PREFIX as string,

  cors: {
    /** Parsed from the comma-separated allowlist. Never a wildcard. */
    origins: (process.env.CORS_ORIGINS as string)
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: process.env.CORS_CREDENTIALS === 'true',
  },

  cookie: {
    domain: process.env.COOKIE_DOMAIN as string,
    secure: process.env.COOKIE_SECURE === 'true',
  },

  mongo: {
    uri: process.env.MONGO_URI as string,
    dbName: process.env.MONGO_DB_NAME as string,
  },

  redis: {
    url: process.env.REDIS_URL as string,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL as string,
    refreshTtl: process.env.JWT_REFRESH_TTL as string,
  },

  argon2: {
    pepper: process.env.ARGON2_PEPPER as string,
  },

  throttle: {
    ttlMs: parseInt(process.env.THROTTLE_TTL_MS as string, 10),
    limit: parseInt(process.env.THROTTLE_LIMIT as string, 10),
    authLimit: parseInt(process.env.THROTTLE_AUTH_LIMIT as string, 10),
  },

  seed: {
    superAdmin: {
      name: process.env.SEED_SUPERADMIN_NAME as string,
      email: process.env.SEED_SUPERADMIN_EMAIL as string,
      phone: process.env.SEED_SUPERADMIN_PHONE as string,
      password: process.env.SEED_SUPERADMIN_PASSWORD as string,
    },
    admin: {
      name: process.env.SEED_ADMIN_NAME as string,
      email: process.env.SEED_ADMIN_EMAIL as string,
      phone: process.env.SEED_ADMIN_PHONE as string,
      password: process.env.SEED_ADMIN_PASSWORD as string,
    },
    /**
     * Shared password for the demo accounts planted by `seed:demo`.
     *
     * Optional in the Joi schema, so this is `undefined` on a normal
     * deployment. The seeder reads it with `getOrThrow()`, which turns
     * that `undefined` into a refusal to run — the demo seed is the only
     * thing that needs it, and it is the only thing that fails without it.
     */
    demoPassword: process.env.SEED_DEMO_PASSWORD,
  },
});

export type AppConfig = ReturnType<typeof configuration>;
