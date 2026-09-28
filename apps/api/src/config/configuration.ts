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

  brand: {
    name: process.env.APP_NAME as string,
    refreshCookieName: process.env.REFRESH_COOKIE_NAME as string,
  },

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

  maps: {
    /**
     * Google Maps SERVER key, used only for geocoding an address once,
     * at the moment it is created (§8.7 cost control).
     *
     * Optional in the Joi schema, exactly like SEED_DEMO_PASSWORD, so
     * this is `undefined` on a deployment that does not geocode. The API
     * boots perfectly well without it: `GeoService` reads it with
     * `get()` and refuses the ONE call that needs it, while distance,
     * ETA and rider payout — which come from the stored 2dsphere points
     * — carry on working. Making it `.required()` would stop a
     * production deployment booting over a feature it never uses.
     *
     * It is a SERVER key: it must be IP-restricted in the Google console
     * and must never be given to a browser. The browser key is a
     * separate, referrer-restricted value and lives behind the
     * NEXT_PUBLIC_ boundary in the web app.
     */
    serverKey: process.env.GOOGLE_MAPS_SERVER_KEY,
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

    /**
     * One real account per operating role, for manual end-to-end testing.
     * Optional in the Joi schema, so these are `undefined` on a normal
     * deployment; `seed:roles` reads them with `getOrThrow()` and is the
     * only thing that fails without them.
     */
    vendor: {
      name: process.env.SEED_VENDOR_NAME,
      email: process.env.SEED_VENDOR_EMAIL,
      phone: process.env.SEED_VENDOR_PHONE,
      password: process.env.SEED_VENDOR_PASSWORD,
      storeName: process.env.SEED_VENDOR_STORE_NAME,
    },
    customer: {
      name: process.env.SEED_CUSTOMER_NAME,
      email: process.env.SEED_CUSTOMER_EMAIL,
      phone: process.env.SEED_CUSTOMER_PHONE,
      password: process.env.SEED_CUSTOMER_PASSWORD,
    },
    delivery: {
      name: process.env.SEED_DELIVERY_NAME,
      email: process.env.SEED_DELIVERY_EMAIL,
      phone: process.env.SEED_DELIVERY_PHONE,
      password: process.env.SEED_DELIVERY_PASSWORD,
    },
  },
});

export type AppConfig = ReturnType<typeof configuration>;
