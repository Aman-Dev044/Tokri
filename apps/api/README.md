# Mandi API

NestJS 10 · Mongoose 8 · MongoDB (replica set) · Redis · JWT

The backend for Mandi, a multi-vendor grocery delivery platform. Base path `/api/v1`.

---

## 1. Boot it

Four steps, in order. Each one depends on the previous.

```bash
# 1 — infrastructure (MongoDB as a REPLICA SET + Redis)
pnpm infra:up                 # docker compose, from the repo root

# 2 — dependencies (once, from the repo root)
pnpm install

# 3 — configuration
cd apps/api
cp .env.example .env          # then FILL IN EVERY VALUE — see §2
```

Generate the secrets rather than inventing them:

```bash
# 32+ characters each, and JWT_ACCESS_SECRET must differ from JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```bash
# 4 — bootstrap accounts, then run
pnpm seed                     # creates the super-admin + admin from .env
pnpm dev                      # http://localhost:4000/api/v1
```

Swagger is at `http://localhost:4000/api/v1/docs` — **non-production only**.

### Why the database must be a replica set

MongoDB supports multi-document transactions only on a replica set. Checkout reserves stock
and creates the order in one transaction; on a standalone `mongod` that transaction silently
cannot exist, and the platform oversells. `GET /health/ready` asserts the deployment is a
replica set for exactly this reason, and the integration tests run against an in-memory
replica set rather than a standalone so the topology matches production.

### Verify the boot

```bash
curl localhost:4000/api/v1/health/live
curl localhost:4000/api/v1/health/ready   # transactions must read "available"
curl -i localhost:4000/api/v1/auth/me     # must be 401 — see §4
```

---

## 2. Environment variables

**Every value is required unless the Default column is filled in.** There is no fallback
anywhere in the codebase; a missing value means the process refuses to start. See §4.3.

### Runtime

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | — | `development` \| `test` \| `production` |
| `PORT` | `4000` | |
| `API_PREFIX` | `api/v1` | Global route prefix |

### CORS & cookies

| Variable | Default | Notes |
|---|---|---|
| `CORS_ORIGINS` | — | Comma-separated allowlist. **`*` is rejected by the schema.** |
| `CORS_CREDENTIALS` | `true` | |
| `COOKIE_DOMAIN` | — | Domain the refresh cookie is scoped to |
| `COOKIE_SECURE` | `true` | Set `false` only for local HTTP |

### Data stores

| Variable | Default | Notes |
|---|---|---|
| `MONGO_URI` | — | `mongodb://…`. Must point at a replica set. |
| `MONGO_DB_NAME` | — | |
| `REDIS_URL` | — | `redis://…`. Socket.IO adapter + caching. |

### Auth secrets

| Variable | Default | Notes |
|---|---|---|
| `JWT_ACCESS_SECRET` | — | **Min 32 chars.** Signs the 15-minute access token. |
| `JWT_REFRESH_SECRET` | — | **Min 32 chars, and MUST differ from the access secret.** |
| `JWT_ACCESS_TTL` | `15m` | |
| `JWT_REFRESH_TTL` | `7d` | |
| `ARGON2_PEPPER` | — | **Min 32 chars.** Mixed into every password hash. |

`ARGON2_PEPPER` is what makes a stolen database insufficient on its own: the hashes cannot be
attacked offline without also stealing the environment. Rotating it invalidates every existing
password hash, so it is not a routine rotation — plan a forced reset alongside it.

### Rate limiting

| Variable | Default | Notes |
|---|---|---|
| `THROTTLE_TTL_MS` | `60000` | Window |
| `THROTTLE_LIMIT` | `100` | Global per-window limit |
| `THROTTLE_AUTH_LIMIT` | `5` | Auth-route limit |

### Seed accounts

Used once by `pnpm seed`. Credentials are configuration, never source code — changing the
bootstrap admin password must not require editing a file that gets committed.

| Variable | Notes |
|---|---|
| `SEED_SUPERADMIN_NAME` / `_EMAIL` / `_PHONE` / `_PASSWORD` | Password min 12 chars |
| `SEED_ADMIN_NAME` / `_EMAIL` / `_PHONE` / `_PASSWORD` | Password min 12 chars |

Later phases add Razorpay, S3, Maps, SendGrid, MSG91, FCM and Sentry variables. They are listed
commented-out at the bottom of `.env.example`; each becomes `.required()` in
`src/config/env.validation.ts` as its phase lands.

---

## 3. Commands

| Command | Does |
|---|---|
| `pnpm dev` | Watch mode |
| `pnpm build` | Compile to `dist/` |
| `pnpm start:prod` | Run the build |
| `pnpm seed` | Create the bootstrap accounts from `.env` |
| `pnpm lint` | ESLint over `src/` and `test/`, zero warnings tolerated |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Unit tests (no database) |
| `pnpm test:integration` | Integration tests against an in-memory replica set |

---

## 4. Security model

Two requirements drive the architecture. Both are enforced mechanically, and both are covered
by tests that fail the build rather than by conventions that rely on review.

### 4.1 Deny by default

Authorisation is **inverted**. Rather than adding `@UseGuards()` to each protected route — where
one forgotten decorator silently exposes an endpoint and nobody finds out until it is discovered
from the outside — every route in the application is protected globally, and a route becomes
public only by explicitly saying so.

A forgotten decorator therefore makes a route **more** secure, not less. That is the whole point.

```
Request
  → ThrottlerGuard      rate limit (per IP + user)
  → JwtAuthGuard        valid access token?              unless @Public()
  → RolesGuard          role permitted on this route?    if @Roles()
  → VendorScopeGuard    tenant id injected FROM THE TOKEN
  → ResourceOwnerGuard  does this user own THIS document?  if @Owns()
  → ValidationPipe      whitelist + forbidNonWhitelisted → unknown fields REJECTED
  → Controller
```

The chain is registered in `src/app.module.ts` as five `APP_GUARD` providers. The order is
deliberate and runs widest-to-narrowest: reject cheaply and anonymously first, and only reach
the database for an object-level ownership check once identity, role and tenant have all passed.

| Guard | File | Enforces |
|---|---|---|
| `JwtAuthGuard` | `common/guards/jwt-auth.guard.ts` | Authentication. `@Public()` opts out. |
| `RolesGuard` | `common/guards/roles.guard.ts` | `@Roles(...)`. SUPER_ADMIN inherits ADMIN. |
| `VendorScopeGuard` | `common/guards/vendor-scope.guard.ts` | Multi-tenant isolation. |
| `ResourceOwnerGuard` | `common/guards/resource-owner.guard.ts` | `@Owns({ model, param, field })`. |

Three properties worth knowing:

- **The tenant id is injected, never requested.** `req.vendorScope` comes out of the verified
  JWT. A `vendorId` in a param, query or body is attacker-controlled and is never an
  authorization input.
- **Ownership failures return 404, not 403.** A 403 confirms the document exists and merely
  is not yours, which turns any `/orders/:id` into an enumeration oracle. To a non-owner, the
  resource simply does not exist.
- **The role is re-read from the database on every request.** `JwtStrategy.validate` looks the
  account up and rejects anything that is not `active`, so suspending a user takes effect on
  their next request rather than whenever their 15-minute token happens to expire.

**The allowlist is asserted by a test.** `test/integration/public-routes.spec.ts` enumerates
every route Nest registered and asserts that the set carrying `@Public()` is exactly:

```
POST /auth/login       you cannot present a token before you have one
POST /auth/refresh     authenticated by the httpOnly refresh cookie instead
GET  /health/live      liveness probe — the orchestrator has no identity
GET  /health/ready     readiness probe, same reason
```

Adding a public route without updating that list fails CI. The same spec also fires an
anonymous request at every non-public route and requires a 401 from each.

### 4.2 Tokens

| Token | Lifetime | Stored | Why |
|---|---|---|---|
| Access | 15 min | Client memory only | `localStorage` is readable by any XSS; memory dies with the tab. |
| Refresh | 7 days | httpOnly + Secure + SameSite=Strict cookie | JavaScript cannot read it, so XSS cannot exfiltrate it. |

**Rotation with reuse detection.** Every refresh issues a new token and invalidates the old one.
Presenting an already-spent token means someone has a copy, so the entire token *family* is
revoked — thief and legitimate user alike are logged out. That is what makes a stolen refresh
token worthless: the thief's first use burns the session and the real user notices immediately.
Proven in `test/integration/auth.spec.ts`.

Login returns one generic `Invalid credentials` for an unknown user *and* a wrong password, and
spends comparable time on both. Distinguishing them turns the login form into a user-enumeration
oracle. The test asserts the two responses are identical.

### 4.3 Zero hardcoded credentials

The banned pattern:

```ts
const secret = process.env.JWT_SECRET || 'dev-secret-change-me';   // ❌
```

A fallback means the application **boots successfully while misconfigured**. It signs real user
tokens with a string that is in the repository, and nobody notices until the breach.

Four controls, none of which is a convention:

1. **`src/config/env.validation.ts`** — a Joi schema where every secret is `.required()` with no
   `.default()`. `abortEarly: false`, so a misconfigured environment reports *every* missing
   variable at once. There is no degraded mode: the process exits.
2. **`packages/config/eslint/base.cjs`** — `no-restricted-syntax` rules that make
   `process.env.X || …`, `process.env.X ?? …`, `||=`, `??=`, the `as string ||` variant,
   `config.get('x') || …` and `config.get('x', 'default')` **lint errors**. `pnpm lint` fails,
   so Turbo fails, so CI fails. The fallback cannot be merged. A companion
   `no-restricted-properties` rule confines raw `process.env` access to `src/config/**`.
3. **`ConfigService.getOrThrow()` everywhere** — never `.get()` with a default.
4. **`test/unit/config.spec.ts`** — asserts the schema rejects a missing `JWT_ACCESS_SECRET`,
   `CORS_ORIGINS='*'`, a refresh secret equal to the access secret, and any secret under 32
   characters. It also asserts that *no* secret has a default value, while confirming that
   non-secret operational knobs (`PORT`, TTLs, throttle limits) still may.

`.env` is gitignored. `.env.example` is committed with every value empty.

### 4.4 Input handling

- `ValidationPipe` runs with `whitelist: true` **and** `forbidNonWhitelisted: true`, so an
  unknown property is a `400`, not something silently dropped. Posting `{ role: 'super_admin' }`
  to any endpoint is rejected rather than ignored.
- No self-service DTO anywhere carries `role` or `status`. A new account's status is *derived*
  from its role by the service; `POST /users` (SUPER_ADMIN only) is the single place a role can
  be set, and it refuses to mint a `SUPER_ADMIN` at all.
- `express-mongo-sanitize` strips `$` and `.` keys, blocking
  `{ "password": { "$ne": null } }` operator injection.
- Search terms are regex-escaped before reaching Mongo, and `sort` is checked against an
  allowlist of sortable fields rather than passed through.
- Errors are RFC 7807 `problem+json`. 5xx responses never echo internals; a scrubber redacts
  `password`, `token`, `otp`, `secret`, `signature`, `authorization` and `cookie` from logs.

### 4.5 Idempotency

`@Idempotent()` + `IdempotencyInterceptor` make a mutating route replay-safe: the
`Idempotency-Key` header is reserved with a unique-indexed insert *before* the handler runs, the
response is stored against it, and any retry replays that response instead of executing again.
A failed handler releases the key so the client can legitimately retry. Records expire after 24
hours via a TTL index. Required on checkout and payments; already wired to `POST /users`.

---

## 5. Layout

```
src/
  common/
    constants/roles.enum.ts         Role, PLATFORM_ROLES, UserStatus
    decorators/                     @Public @Roles @CurrentUser @Owns @Idempotent
    dto/                            PaginationQueryDto, paginate()
    filters/all-exceptions.filter.ts RFC 7807 + secret scrubber
    guards/                         the four generic guards
    interceptors/                   idempotency
    utils/password.service.ts       argon2id + pepper
  config/                           env.validation.ts (the gate) + configuration.ts
  database/schemas/                 Mongoose models
  modules/
    auth/                           login, refresh rotation, logout, me
    health/                         /health/live, /health/ready
    users/                          admin user administration
test/
  unit/                             no database
  integration/                      in-memory replica set
  utils/                            shared test harness
```

---

## 6. Conventions

- Every list endpoint returns `{ data, meta: { page, limit, total, pages } }`. `limit` is capped
  at 100 — an uncapped limit is both a denial-of-service primitive and a bulk export.
- **Money is an integer in paise, never a float.** `₹149.50` is `14950`.
- **Stock lives only in `inventory`, never on `product`.** Two writers to the same quantity in
  two collections is how oversell bugs are born.
- Every endpoint carries `@ApiTags` / `@ApiOperation`; Swagger is the contract.
- TypeScript is strict. No `any`, no `@ts-ignore` — both are lint errors.
