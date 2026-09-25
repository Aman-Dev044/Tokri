# Mandi — Grocery Delivery Ecosystem
## Complete A-to-Z Implementation Plan

> **Source:** `Grocery_Delivery_Ecosystem_Proper_Technical_Document (1).docx`
> **Plan date:** 2026-09-24
> **Frontend decision:** Next.js (App Router) for everything — landing page + all 4 panels, one app.
> **Security posture:** Deny-by-default APIs · zero hardcoded credentials · every secret from `.env`.

---

# TABLE OF CONTENTS

| # | Section | What it answers |
|---|---|---|
| 1 | [Locked Decisions](#1-locked-decisions) | The 11 open business questions, answered so work can start |
| 2 | [The UI Thesis — "Mandi"](#2-the-ui-thesis--mandi) | Why this will not look like any competitor |
| 3 | [Architecture & Repo](#3-architecture--repo) | Next.js + NestJS monorepo, folder by folder |
| 4 | [Security Architecture](#4-security-architecture) | Deny-by-default APIs, protected routes, zero hardcoded creds |
| 5 | [Data Model](#5-data-model) | Every collection, index, and the order state machine |
| 6 | [API & Realtime Contract](#6-api--realtime-contract) | Endpoints and the 7 socket events |
| 7 | [Build Plan — 10 Phases](#7-build-plan--10-phases) | Step-by-step, empty folder → production |
| 8 | [Hard Problems, Solved](#8-hard-problems-solved) | Race conditions, idempotency, isolation, scaling |
| 9 | [Testing & Deployment](#9-testing--deployment) | How we prove it works and ship it |
| 10 | [Timeline Reality](#10-timeline-reality) | What 4 weeks actually buys |

---

# 1. LOCKED DECISIONS

Section 9 of the source document lists 11 unresolved business decisions. Nothing can be built while
they are open, because they decide the shape of the database. Each is locked below with a default.

**Change any row and tell me — I will revise the plan. Silence means we build on these.**

| # | Decision | LOCKED AS | Why this default |
|---|---|---|---|
| 1 | Multi-vendor cart | **One vendor per cart, one vendor per order** | This single answer decides the cart, order, commission and assignment schema. Single-vendor means one order = one pickup = one partner, which is how fast grocery delivery actually works. Switching store **parks** the old cart (saved, restorable), never silently destroys it. |
| 2 | Gateway / country / currency | **Razorpay · India · INR** | Matches the MSG91 SMS provider and the COD requirement in the source doc. Written behind a `PaymentProvider` interface so Stripe becomes a second adapter, not a rewrite. |
| 3 | COD | **Enabled. Per-vendor toggle. ₹2,000 cap** | Non-negotiable for Indian grocery. The cap limits how much cash any one partner carries. |
| 4 | Proof of delivery | **4-digit OTP, always. Photo as fallback** | One mechanism covers both COD and prepaid. Photo only when the customer is unreachable. |
| 5 | Delivery charge | **Platform revenue, not vendor** | Vendor is paid `item subtotal − commission`. Keeps settlement to one line of arithmetic per order. |
| 6 | Commission | **Flat % per vendor, set by admin** | The rate is **copied onto the order at creation time**, so changing a vendor's rate later never rewrites financial history. |
| 7 | Settlement cycle | **Weekly, every Monday**, for orders delivered up to the previous Sunday | Gives a clean 7-day window for disputes and returns before money actually moves. |
| 8 | Cancellation | **Free until vendor accepts.** After accept → vendor or admin approval | Refund to source, 5–7 working days, full audit trail on every state change. |
| 9 | Out of stock after checkout | **Vendor partial-fulfils. Removed lines auto-refund** | Avoids killing a ₹900 order because one ₹40 item is missing. |
| 10 | Delivery slots | **On-demand only in v1** | Scheduled slots need a capacity planner and a rider roster. Out of scope for release 1. |
| 11 | Tracking & radius | **Location every 10s while `OUT_FOR_DELIVERY`. 5 km serviceable radius** | Bounded write volume, and a geo query that stays on a `2dsphere` index. |

## 1.1 Still genuinely blocking

These three cannot be defaulted. Each is needed **before** the phase that touches it, not before we start:

- [ ] **Razorpay merchant account** with KYC complete + test/live API keys → needed by **Phase 5**
- [ ] **Commission percentage** — flat platform-wide, per-vendor, or per-category? → needed by **Phase 6**
- [ ] **Delivery partner ownership** — does each vendor bring their own riders, or does the platform run a shared pool? This changes the entire assignment algorithm → needed by **Phase 6**

## 1.2 Scope correction (important)

The source document promises **18 modules in 4 weeks**, then its own summary table in Section 7
contradicts this by running to **week 7**. Both cannot be true.

**Honest position:** 4 weeks builds the *order-to-delivery core*. The full 18 modules is a
10–12 week scope at this fidelity. This plan is 10 phases with a real estimate on each, and
Section 10 says exactly what fits in 4 weeks and what does not.

---

# 2. THE UI THESIS — "MANDI"

This is the part that matters most to you, so it gets built **first** (Phase 0), not last. The
design system exists before the first screen, or every screen drifts.

## 2.1 The problem with every competitor

Open Blinkit, Zepto, Instamart and BigBasket side by side. They are the same app:

- Dense 3-across grids of tiny cramped tiles
- Yellow / purple / red brand colour that never changes, on every screen, forever
- A countdown timer screaming "10 MINUTES" at you
- Product cards that are spreadsheets with a photo stapled on
- Flat digital surfaces — nothing feels like food
- Tracking = a grey Google Map with a scooter icon crawling across it

They are **warehouses**. Efficient, forgettable, interchangeable.

## 2.2 The concept: a market that is alive

**Mandi** (मंडी — the Indian produce market). The thesis is one sentence:

> **The app is not a catalogue. It is a market that changes colour as you walk through it, and changes light as the day passes.**

Six pillars. Each is a concrete, implementable mechanic — not a mood board.

### Pillar 1 — Chromatic Aisles ★ the signature move

Every category owns a hue taken from the actual produce. Entering an aisle **re-tints the entire
interface** — accent, ambient wash, card edges, button fills, the basket itself.

| Aisle | Hue | Hex |
|---|---|---|
| Fruits | tomato | `#D64530` |
| Vegetables | leaf | `#4E8C3F` |
| Dairy & Eggs | butter | `#C89B3C` |
| Bakery | crust | `#B5651D` |
| Beverages | deep water | `#2F6F8C` |
| Snacks | berry | `#8C4A6B` |
| Staples & Grains | husk | `#6B6244` |
| Frozen | frost | `#4A7C8C` |

**Implementation — one CSS custom property, whole-app effect:**

```css
:root { --aisle: var(--moss); }

[data-aisle="fruits"]     { --aisle: #D64530; }
[data-aisle="vegetables"] { --aisle: #4E8C3F; }
[data-aisle="dairy"]      { --aisle: #C89B3C; }
/* …every component reads var(--aisle). Nothing hardcodes a colour. */

html { transition: --aisle 480ms cubic-bezier(.4, 0, .2, 1); }
```

In Next.js this is a single line in the aisle layout — `data-aisle` stamped on `<html>` from the
route segment. **No competitor does this.**

### Pillar 2 — Circadian Ground

The page ground shifts with the clock — *inside* whichever theme the user is on. The store at 7am
does not look like the store at 11pm.

| Window | Name | Ground character |
|---|---|---|
| 05:00–11:00 | dawn | cool, pale, high-clarity paper |
| 11:00–17:00 | day | neutral paper, maximum contrast |
| 17:00–21:00 | dusk | warm amber lift, softened edges |
| 21:00–05:00 | night | deep ink, low glare, accents dimmed 15% |

Computed on mount, re-checked hourly, stamps `data-time` on `<html>`. This is **not** the
light/dark toggle — it modulates *within* it.

> **Next.js note:** compute this client-side only (`useEffect`), never during SSR. Server time is
> not the user's time, and rendering a "night" page for a user at noon is a hydration mismatch.

### Pillar 3 — The Basket is a physical object

Not a badge with a number. A persistent object docked bottom-right that:

- **Fills visually** — contents render as a rising mass, so you see fullness before you read a count
- **Catches items** — tapping *Add* arcs the product image along a bezier into the basket with a spring settle (`cubic-bezier(.34, 1.56, .64, 1)`)
- **Reacts** — a small squash on catch. Weight, not decoration.

### Pillar 4 — The Journey Ribbon ★ replaces the map

Tracking is the emotional peak of a delivery app, and everyone wastes it on a grey map.

**Mandi's tracking screen is a vertical ribbon** running down the page — a stylised route from
store to door that **fills with the aisle colour** as the partner progresses. Each milestone
(`accepted → packed → picked up → on the way → at your door`) lands as a **stamp** with a press
animation, like a real delivery receipt being franked.

The map still exists — desaturated, secondary, collapsible below the ribbon. The ribbon is the hero.

### Pillar 5 — Editorial product cards

Magazine, not spreadsheet. Large photography via `next/image`, generous air, one price set in mono,
asymmetric layout, hairline rules instead of boxes-inside-boxes. **Two-across on mobile, not three.**
Fewer products visible, each one desirable.

### Pillar 6 — Ink & paper texture

A subtle grain overlay and hairline rules give surfaces physicality. Grocery is a physical act; a
flat digital sheet is what every competitor already is.

## 2.3 Design tokens

```css
:root {
  /* ground & ink — neutrals carry a green bias. Deliberately chosen, never pure grey. */
  --ink:      #14150F;   /* near-black, green-biased */
  --paper:    #F2F4EE;   /* off-white, green-biased */
  --stone:    #8A8F80;   /* muted neutral */
  --hairline: #D9DCD2;

  /* brand */
  --moss:  #2F6B3C;      /* default accent when no aisle is active */
  --aisle: var(--moss);

  /* semantic — separate from accent, never reused as brand colour */
  --good: #2F6B3C;
  --warn: #C8871F;
  --crit: #B33A28;

  /* type */
  --display: "Bricolage Grotesque", "Trebuchet MS", sans-serif;
  --body:    "Instrument Sans", system-ui, sans-serif;
  --data:    "Azeret Mono", ui-monospace, monospace;

  /* motion */
  --t-micro: 180ms;   /* hover, press */
  --t-move:  320ms;   /* panels, sheets */
  --t-aisle: 480ms;   /* aisle colour shift */
  --spring:  cubic-bezier(.34, 1.56, .64, 1);
}
```

**Typography roles**

| Role | Face | Used for |
|---|---|---|
| Display | Bricolage Grotesque | Aisle names, hero numbers, order status. Variable-width, genuinely characterful — and not the Inter / Space Grotesk default everyone ships |
| Body | Instrument Sans | All running text, labels, descriptions |
| Data | Azeret Mono | Prices, ETA, order IDs, quantities, OTP. `font-variant-numeric: tabular-nums` wherever digits align |

All three load through `next/font/google` — self-hosted at build time, zero layout shift, no
external font request at runtime.

## 2.4 Four roles, four visual identities

The same token system, deliberately different treatments. A rider on a scooter in the rain has
nothing in common with an admin on a 27-inch monitor.

| Role | Treatment | Rules |
|---|---|---|
| **Landing** | Editorial hero, SSG, SEO-first | Aisle colours cycle slowly in the hero. Largest typographic moment in the product. |
| **Customer** | Full Mandi — warm, chromatic aisles, journey ribbon | Two-across cards. Photography leads. Motion allowed. |
| **Vendor** | Dense operations console on ink ground | Aisle colour used **only** as order-status encoding. Sound + visual alert on new order. Keyboard-first. Zero decoration. |
| **Delivery** | One action per screen | Minimum 64px touch targets. Glove-friendly. Maximum contrast. Big mono ETA. Works one-handed at arm's length. |
| **Admin** | Data-dense, neutral, no chrome | Tables, filters, sparklines. Semantic colour only. Never the aisle system. |

## 2.5 Motion rules

- `--t-micro` for hover/press, `--t-move` for panels, `--t-aisle` for the colour shift
- Spring easing **only** on the basket catch — one signature moment, not scattered bounce
- Every animation wrapped in `@media (prefers-reduced-motion: reduce)` → instant state change
- No scroll-triggered reveals. The page is fully readable at rest.

## 2.6 Accessibility (non-negotiable)

- Every aisle hue pre-verified to **4.5:1 minimum** against both `--paper` and `--ink`
- Colour never carries meaning alone — every status has an icon and a text label beside the hue
- Full keyboard path through browse → cart → checkout, with a visible focus ring
- Delivery panel tested at 200% browser zoom

---

# 3. ARCHITECTURE & REPO

## 3.1 Runtime topology

```
Browser
  │
  ▼
Nginx  ── TLS · gzip/brotli · security headers · rate limit
  ├──► Next.js  (SSG landing + SSR/CSR panels, Node runtime)
  └──► /api     ──► NestJS API   (stateless, N replicas)
       /socket  ──► NestJS WS    (sticky sessions + Redis adapter)
                       │
       ┌───────────────┼──────────────┬──────────────┐
       ▼               ▼              ▼              ▼
   MongoDB          Redis          BullMQ        External
   (replica set)    (cache,        workers       Razorpay · Maps
                     pub/sub,      (separate     S3 · SES · MSG91 · FCM
                     locks)        process)
```

**Two non-obvious infrastructure requirements the source document does not mention:**

1. **MongoDB must run as a replica set — even locally, even single-node.** Multi-document
   transactions do not exist on a standalone `mongod`. Without them, stock decrement + order
   creation cannot be atomic, and Challenge #4 (inventory race conditions) is unsolvable.
   → local: `mongod --replSet rs0` then `rs.initiate()`. Docker Compose does this in an init container.

2. **Socket.IO needs `@socket.io/redis-adapter` specifically.** "Redis for cache" is not enough.
   The moment there are two API replicas, a vendor connected to replica A never receives an event
   emitted from replica B. The adapter goes in on day one, not when scaling becomes a problem.

## 3.2 Monorepo layout

```
mandi/
├── apps/
│   ├── web/                              # ★ Next.js 15 — App Router, ONE app, all surfaces
│   │   ├── middleware.ts                 # ★ edge route protection (§4.4)
│   │   ├── next.config.mjs               # CSP headers, image domains, PWA
│   │   ├── .env.example                  # committed, values EMPTY
│   │   ├── .env.local                    # gitignored, never committed
│   │   └── app/
│   │       ├── layout.tsx                # fonts, token CSS, providers
│   │       │
│   │       ├── (marketing)/              # ── PUBLIC, SSG + ISR, SEO-first
│   │       │   ├── page.tsx              #    landing page
│   │       │   ├── how-it-works/
│   │       │   ├── for-vendors/          #    vendor acquisition funnel
│   │       │   ├── for-riders/
│   │       │   ├── sitemap.ts
│   │       │   └── robots.ts
│   │       │
│   │       ├── (auth)/                   # ── PUBLIC
│   │       │   ├── login/ · register/ · otp/
│   │       │
│   │       ├── (shop)/                   # ── CUSTOMER (protected)
│   │       │   ├── stores/[slug]/
│   │       │   ├── aisle/[aisleKey]/     #    ★ layout stamps data-aisle here
│   │       │   ├── product/[id]/
│   │       │   ├── cart/ · checkout/
│   │       │   └── orders/[id]/track/    #    ★ Journey Ribbon
│   │       │
│   │       ├── vendor/                   # ── VENDOR (protected, role-gated)
│   │       │   ├── layout.tsx            #    ops console shell
│   │       │   ├── orders/ · products/ · inventory/
│   │       │   ├── partners/ · earnings/ · settings/
│   │       │
│   │       ├── delivery/                 # ── DELIVERY (protected, PWA)
│   │       │   ├── manifest.ts
│   │       │   ├── offers/ · active/[id]/ · history/
│   │       │
│   │       └── admin/                    # ── ADMIN (protected, role-gated)
│   │           ├── vendors/ · orders/ · settlements/
│   │           ├── analytics/ · audit/ · settings/
│   │
│   └── api/                              # NestJS
│       ├── .env.example                  # committed, values EMPTY
│       └── src/
│           ├── main.ts
│           ├── app.module.ts             # ★ APP_GUARD chain registered here (§4.2)
│           ├── common/
│           │   ├── guards/               # JwtAuthGuard · RolesGuard · VendorScopeGuard
│           │   │                         # ResourceOwnerGuard · ThrottlerGuard
│           │   ├── decorators/           # @Public() @Roles() @CurrentUser() @Owns()
│           │   ├── interceptors/         # logging · transform · timeout · audit · idempotency
│           │   ├── filters/              # global exception → RFC 7807
│           │   └── pipes/
│           ├── config/
│           │   ├── env.validation.ts     # ★ Joi schema, NO defaults for secrets (§4.1)
│           │   └── configuration.ts
│           ├── database/                 # connection + transaction helper
│           ├── modules/
│           │   ├── auth/ · users/ · vendors/
│           │   ├── catalog/ · inventory/ · cart/
│           │   ├── orders/               # + state-machine.ts
│           │   ├── payments/             # provider interface + razorpay adapter
│           │   ├── delivery/             # partners · assignment · tracking
│           │   ├── commission/ · notifications/
│           │   ├── reports/ · audit/ · settings/
│           ├── realtime/                 # gateway · rooms · ws auth middleware
│           └── jobs/                     # BullMQ processors
│
├── packages/
│   ├── design-system/          ★         # tokens, primitives, Basket, JourneyRibbon
│   ├── shared-types/                     # DTOs + socket payloads — ONE source of truth
│   └── config/                           # eslint (incl. no-hardcoded-secrets), tsconfig
│
├── docker/
│   ├── docker-compose.yml                # mongo(rs) · redis · api · worker · web · nginx
│   └── nginx/nginx.conf
├── .github/workflows/ci.yml              # ★ includes gitleaks secret scan
├── .gitignore                            # .env* except .env.example
└── package.json                          # pnpm workspaces + Turborepo
```

**Why one Next.js app instead of five:** one design system import, one build, one deploy, one
`middleware.ts` enforcing route protection across every surface. Route groups keep the four panels
as isolated as separate apps, without the cost of maintaining four toolchains.

## 3.3 Rendering strategy per surface

| Surface | Strategy | Why |
|---|---|---|
| `(marketing)` | **SSG + ISR** (revalidate 1h) | Landing must be instant and crawlable. Full metadata, OG images, JSON-LD, sitemap. |
| `(shop)` store + product pages | **SSR** | Product pages need SEO and fresh price/stock. |
| `(shop)` cart, checkout, track | **CSR** | Personal, live, never cached. |
| `vendor`, `admin` | **CSR** | Auth-gated dashboards. SSR buys nothing and complicates token handling. |
| `delivery` | **CSR + PWA** | Offline shell, service worker, wake lock. |

---

# 4. SECURITY ARCHITECTURE

> Two hard requirements drive this section:
> **(a)** every API is protected by default, generically, not route-by-route;
> **(b)** every credential comes from `.env` — **no hardcoded fallback anywhere, ever.**

## 4.1 Zero hardcoded credentials

### The banned pattern

```ts
// ❌ NEVER. This is the single most common way secrets reach production.
const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
const key    = process.env.RZP_KEY ?? 'rzp_test_xxxxx';
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mandi');
```

A fallback means the app **boots successfully while misconfigured**. It signs real tokens with
`'dev-secret-change-me'`. Nobody notices until the breach.

### The rule: fail fast, never fall back

```ts
// config/env.validation.ts
// Every secret is .required() with NO .default(). The process REFUSES to boot
// if any one of them is missing. There is no degraded mode.
import * as Joi from 'joi';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  PORT:     Joi.number().default(4000),          // ← non-secret, default is fine

  // ── Database ────────────────────────────────────────────────
  MONGO_URI:              Joi.string().uri().required(),
  MONGO_DB_NAME:          Joi.string().required(),
  REDIS_URL:              Joi.string().uri().required(),

  // ── Auth ────────────────────────────────────────────────────
  JWT_ACCESS_SECRET:      Joi.string().min(32).required(),
  JWT_REFRESH_SECRET:     Joi.string().min(32).required(),
  JWT_ACCESS_TTL:         Joi.string().default('15m'),
  JWT_REFRESH_TTL:        Joi.string().default('7d'),
  ARGON2_SECRET:          Joi.string().min(32).required(),   // pepper

  // ── Payments ────────────────────────────────────────────────
  RAZORPAY_KEY_ID:        Joi.string().required(),
  RAZORPAY_KEY_SECRET:    Joi.string().required(),
  RAZORPAY_WEBHOOK_SECRET:Joi.string().required(),

  // ── Storage ─────────────────────────────────────────────────
  S3_ENDPOINT:            Joi.string().uri().required(),
  S3_REGION:              Joi.string().required(),
  S3_BUCKET:              Joi.string().required(),
  S3_ACCESS_KEY_ID:       Joi.string().required(),
  S3_SECRET_ACCESS_KEY:   Joi.string().required(),

  // ── Maps ────────────────────────────────────────────────────
  GOOGLE_MAPS_SERVER_KEY: Joi.string().required(),   // server-only, IP-restricted

  // ── Messaging ───────────────────────────────────────────────
  SENDGRID_API_KEY:       Joi.string().required(),
  MAIL_FROM:              Joi.string().email().required(),
  MSG91_AUTH_KEY:         Joi.string().required(),
  MSG91_SENDER_ID:        Joi.string().required(),
  FCM_SERVICE_ACCOUNT_JSON: Joi.string().required(),  // base64-encoded

  // ── Ops ─────────────────────────────────────────────────────
  SENTRY_DSN:             Joi.string().uri().required(),
  CORS_ORIGINS:           Joi.string().required(),    // comma-separated allowlist
  COOKIE_DOMAIN:          Joi.string().required(),
}).unknown(true);
```

```ts
// app.module.ts — validation runs at boot, before anything else
ConfigModule.forRoot({
  isGlobal: true,
  validationSchema: envSchema,
  validationOptions: { abortEarly: false },   // report EVERY missing var at once
});
```

Missing `JWT_ACCESS_SECRET`? The process exits with a readable error listing every missing
variable. It never starts half-configured.

### Frontend: the `NEXT_PUBLIC_` boundary

```bash
# apps/web/.env.example  — committed, ALL VALUES EMPTY

# Public — these are bundled into client JS and are visible to anyone.
# ONLY put values here that are safe to publish.
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_SOCKET_URL=
NEXT_PUBLIC_RAZORPAY_KEY_ID=          # key_id is public by design. key_secret is NOT.
NEXT_PUBLIC_MAPS_BROWSER_KEY=         # must be HTTP-referrer restricted in GCP console
NEXT_PUBLIC_SENTRY_DSN=

# Server-only — never prefixed NEXT_PUBLIC_, never imported into a client component
REVALIDATE_TOKEN=
```

**Rule:** if a variable is not `NEXT_PUBLIC_`, it may only be read inside a Server Component, a
Route Handler, or `middleware.ts`. Next.js will throw at build time if a server-only env var is
referenced from a client component — treat that error as correct, never work around it.

**The Maps key** is the classic leak. The browser key *must* be present in client JS, so it is
protected by **HTTP-referrer restriction + API restriction** in the Google Cloud console, not by
hiding it. The unrestricted server key never leaves the API.

### Enforcement — not a convention, a gate

| Control | Where | Catches |
|---|---|---|
| Joi schema, no defaults on secrets | boot | Missing config |
| ESLint rule banning `process.env.X \|\| '...'` | lint + CI | Fallback secrets |
| `.gitignore`: `.env*` except `.env.example` | repo | Committed `.env` |
| **gitleaks** scan | CI, every PR | Secrets in any diff, including history |
| Log scrubber on `password`, `token`, `otp`, `secret`, `signature`, `authorization` | runtime | Secrets in Sentry / stdout |
| Docker: secrets as **runtime env**, never `ARG` or `COPY .env` | build | Secrets baked into image layers |
| Production: AWS Secrets Manager / Doppler → injected at container start | deploy | Secrets on disk |

```yaml
# .github/workflows/ci.yml — the gate that actually stops it
- name: Secret scan
  uses: gitleaks/gitleaks-action@v2
  env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

**Key rotation runbook:** every secret is rotatable without a code change. Rotate → update the
secret manager → rolling restart. `JWT_ACCESS_SECRET` rotation invalidates live sessions by design;
`JWT_REFRESH_SECRET` rotation forces re-login. Document both before launch.

## 4.2 Deny-by-default API protection ★

**The requirement: APIs protected generically, not one route at a time.** Route-by-route
`@UseGuards()` fails the moment someone forgets it on one endpoint — and nobody notices until it is
found from the outside.

**Inverted:** every route is protected globally. A route becomes public only by explicitly saying so.

```ts
// app.module.ts — three global guards, applied in order to EVERY route in the app
providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard   },  // 1. rate limit
  { provide: APP_GUARD, useClass: JwtAuthGuard     },  // 2. authenticated?
  { provide: APP_GUARD, useClass: RolesGuard       },  // 3. right role?
  { provide: APP_GUARD, useClass: VendorScopeGuard },  // 4. own tenant only?
]
```

```ts
// common/guards/jwt-auth.guard.ts
// Protected unless explicitly marked @Public(). Forgetting a decorator
// now makes a route MORE secure, not less. That is the whole point.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(ctx);
  }
}
```

```ts
// The ONLY public endpoints in the entire API. Each one is a deliberate,
// reviewable decision — and this list is asserted by a test (§9.1).
@Public() POST /auth/login
@Public() POST /auth/register
@Public() POST /auth/otp/request
@Public() POST /auth/otp/verify
@Public() POST /auth/refresh
@Public() GET  /health/live
@Public() GET  /health/ready
@Public() GET  /stores                  // browse before login
@Public() GET  /stores/:slug
@Public() GET  /stores/:id/products
@Public() GET  /products/:id
@Public() POST /webhooks/razorpay       // public, but HMAC-verified (§8.3)
```

### The four generic guards

```ts
// 1. RolesGuard — declarative role gate
@Roles('vendor')            // on a controller → applies to every route in it
@Controller('vendor/orders')

// 2. VendorScopeGuard — multi-tenant isolation, injected not requested (§8.1)
//    req.vendorScope comes from the VERIFIED JWT. Never from params or body.

// 3. ResourceOwnerGuard — generic ownership check, one decorator, any resource
@Owns({ model: 'Order', param: 'id', field: 'customerId' })
@Get('orders/:id')
async getOrder(@Param('id') id: string) { … }
//    Loads the doc, compares the ownership field to req.user.sub, 404s on mismatch.
//    404 — not 403 — so an attacker cannot enumerate which ids exist.

// 4. ThrottlerGuard — per-route limits
@Throttle({ default: { limit: 5, ttl: 60_000 } })   // auth routes
@Throttle({ default: { limit: 1, ttl: 60_000 } })   // OTP resend
//    Global default: 100/min per IP + user id.
```

### Every request, every layer

```
Request
  → Nginx            rate limit, body size cap, security headers
  → ThrottlerGuard   per-route throttle (IP + user)
  → JwtAuthGuard     valid access token? (unless @Public)
  → RolesGuard       role permitted on this route?
  → VendorScopeGuard tenant id injected from token
  → ValidationPipe   whitelist: true, forbidNonWhitelisted: true → unknown fields REJECTED
  → ResourceOwnerGuard  does this user own this specific document?
  → Controller
  → AuditInterceptor    mutation logged with before/after
  → Response
```

## 4.3 Token strategy

| Token | Lifetime | Stored | Why |
|---|---|---|---|
| Access | 15 min | **Memory only** (Redux, never `localStorage`) | `localStorage` is readable by any XSS. Memory dies with the tab. |
| Refresh | 7 days | **httpOnly + Secure + SameSite=Strict cookie** | JavaScript cannot read it. Immune to XSS exfiltration. |

**Refresh rotation with reuse detection:** every refresh issues a new token and invalidates the old
one. If an already-used refresh token is presented, the entire token family is revoked and the user
is forced to re-login. This is what makes a stolen refresh token useless — the thief's first use
locks out both of them, and the legitimate user notices immediately.

## 4.4 Protected routes in Next.js — three layers

**Layer 1 — `middleware.ts` (edge, runs before any page renders)**

```ts
// apps/web/middleware.ts — one file protects every surface
const ROUTE_ROLES: Record<string, Role[]> = {
  '/vendor':   ['vendor'],
  '/admin':    ['admin'],
  '/delivery': ['delivery'],
  '/cart':     ['customer'],
  '/checkout': ['customer'],
  '/orders':   ['customer'],
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const match = Object.entries(ROUTE_ROLES)
    .find(([prefix]) => pathname.startsWith(prefix));
  if (!match) return NextResponse.next();          // public route

  const [, allowedRoles] = match;
  const token = req.cookies.get('refresh_token')?.value;
  if (!token) return redirectToLogin(req);

  const claims = verifyEdgeJwt(token);             // signature + expiry, at the edge
  if (!claims) return redirectToLogin(req);

  if (!allowedRoles.includes(claims.role)) {
    return NextResponse.redirect(new URL('/403', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/vendor/:path*', '/admin/:path*', '/delivery/:path*',
            '/cart/:path*', '/checkout/:path*', '/orders/:path*'],
};
```

**Layer 2 — server-side check in each protected layout** (defence in depth; middleware can be
bypassed by a direct RSC payload request in some edge cases).

**Layer 3 — the API guards of §4.2.**

> **The layer that actually matters is Layer 3.** Layers 1 and 2 are UX: they stop a user seeing a
> broken page. **Never treat a frontend route guard as security.** Anyone can call the API directly
> with curl, and the only thing standing between them and your data is the server-side guard chain.

## 4.5 Security headers (`next.config.mjs` + Nginx)

```js
// Content-Security-Policy is the one that actually stops XSS from becoming account takeover.
{
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self' https://checkout.razorpay.com https://maps.googleapis.com; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob: https://*.s3.amazonaws.com https://maps.gstatic.com; " +
    "connect-src 'self' https://api.mandi.app wss://api.mandi.app https://*.sentry.io; " +
    "frame-src https://api.razorpay.com; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Permissions-Policy':        'geolocation=(self), camera=(self), microphone=()',
}
```

`geolocation=(self)` and `camera=(self)` are required by the delivery panel (tracking + proof photo)
and denied everywhere else.

---

# 5. DATA MODEL

## 5.1 Collections

```ts
// ── users ────────────────────────────────────────────────────────────────
User {
  _id, role: 'admin'|'vendor'|'customer'|'delivery',
  name, email?, phone, passwordHash,          // argon2id + pepper from env
  status: 'active'|'suspended'|'pending',
  vendorId?,                                   // set for role=vendor & role=delivery
  refreshTokenFamily?, lastLoginAt, createdAt
}
// idx: { email:1 } unique sparse · { phone:1 } unique · { role:1, vendorId:1 }

// ── vendors ──────────────────────────────────────────────────────────────
Vendor {
  _id, ownerId, storeName, slug, description, logoUrl, bannerUrl,
  address: { line1, city, state, pincode },
  location: { type:'Point', coordinates:[lng,lat] },
  serviceRadiusKm: 5,
  commissionPct,                               // admin-set; COPIED onto each order
  codEnabled, codMaxAmount,
  isOpen, openingHours: [{ day, open, close }],
  status: 'pending'|'approved'|'suspended',
  rating, createdAt
}
// idx: { location:'2dsphere' } · { slug:1 } unique · { status:1, isOpen:1 }

// ── categories ───────────────────────────────────────────────────────────
Category {
  _id, vendorId?,            // null = platform-global
  name, slug, parentId?,
  aisleKey,                  // ★ 'fruits'|'dairy'|… drives the chromatic aisle UI
  imageUrl, sortOrder, isActive
}
// idx: { vendorId:1, slug:1 } unique

// ── products ─────────────────────────────────────────────────────────────
Product {
  _id, vendorId, categoryId, name, slug, description,
  images: [url], brand,
  unit: 'kg'|'g'|'l'|'ml'|'piece'|'pack', unitValue,
  sku, mrp, price, discountPct,
  isActive, searchText,                        // lowercased name + brand + tags
  createdAt
}
// idx: { vendorId:1, categoryId:1, isActive:1 }
//      { vendorId:1, sku:1 } unique
//      { searchText:'text' }                  → migrate to Atlas Search at scale

// ── inventory ── one doc per product. Stock NEVER lives on the product doc.
Inventory {
  _id, vendorId, productId,                    // unique
  stock,                                       // authoritative available count
  reserved,                                    // held by in-flight checkouts
  lowStockThreshold, updatedAt
}
// idx: { productId:1 } unique · { vendorId:1, stock:1 }

InventoryLog { _id, vendorId, productId, delta, reason, refId, byUserId, at }
// reason: 'restock'|'order_reserve'|'order_release'|'order_commit'|'manual'

// ── carts ── one active cart per (customer, vendor)
Cart {
  _id, customerId, vendorId,
  items: [{ productId, name, image, price, qty }],   // price snapshot
  status: 'active'|'parked'|'converted',
  updatedAt
}
// idx: { customerId:1, vendorId:1 } unique · { updatedAt:1 } TTL 7d on parked

// ── orders ───────────────────────────────────────────────────────────────
Order {
  _id, orderNo,                                // MND-20260924-0001, human-readable
  customerId, vendorId, deliveryPartnerId?,

  items: [{ productId, name, image, unit, price, qty, lineTotal, fulfilled }],

  pricing: {
    itemsSubtotal, discount, deliveryFee, taxes, grandTotal,
    commissionPct, commissionAmount,           // ★ SNAPSHOT at creation
    vendorPayout                               // itemsSubtotal − commissionAmount
  },

  address: { label, line1, line2, city, pincode,
             location:{ type:'Point', coordinates:[lng,lat] }, phone },

  payment: {
    method: 'online'|'cod',
    status: 'pending'|'authorized'|'paid'|'failed'|'refunded'|'partially_refunded',
    provider:'razorpay', providerOrderId, providerPaymentId,
    paidAt, refundedAmount
  },

  status,                                      // see state machine below
  statusHistory: [{ from, to, byUserId, byRole, reason, at }],
  deliveryOtpHash,                             // hashed, never stored in plain text
  proof: { otpVerifiedAt?, photoUrl? },
  cancellation: { by, reason, at },
  placedAt, acceptedAt, readyAt, pickedUpAt, deliveredAt
}
// idx: { vendorId:1, status:1, placedAt:-1 }     ← vendor order board
//      { customerId:1, placedAt:-1 }             ← order history
//      { deliveryPartnerId:1, status:1 }         ← rider queue
//      { orderNo:1 } unique
//      { 'payment.providerOrderId':1 } sparse    ← webhook lookup

// ── delivery ─────────────────────────────────────────────────────────────
DeliveryPartner {
  _id, userId, vendorId?,                      // null = platform pool
  vehicleType, isAvailable, isOnline,
  currentLocation: { type:'Point', coordinates:[lng,lat] }, locationAt,
  activeOrderId?, completedCount, rating
}
// idx: { currentLocation:'2dsphere' } · { vendorId:1, isAvailable:1, isOnline:1 }

DeliveryAssignment {
  _id, orderId, partnerId,
  status:'offered'|'accepted'|'rejected'|'expired'|'cancelled',
  offeredAt, respondedAt, expiresAt, attemptNo
}
// idx: { orderId:1, attemptNo:1 } · { expiresAt:1 }

LocationPing { _id, orderId, partnerId, location, at }
// idx: { orderId:1, at:-1 } · { at:1 } TTL 7 days   ← or this collection eats the disk

// ── money ── all amounts are INTEGER PAISE, never floats
LedgerEntry {
  _id, vendorId, orderId,
  type:'sale'|'commission'|'refund'|'payout'|'adjustment',
  amount,                                      // signed, in paise
  settlementId?, createdAt
}
// idx: { vendorId:1, createdAt:-1 } · { settlementId:1 }

Settlement { _id, vendorId, periodStart, periodEnd, grossSales,
             totalCommission, refunds, netPayable,
             status:'pending'|'processing'|'paid'|'failed', paidAt, reference }

// ── supporting ───────────────────────────────────────────────────────────
Address      { _id, customerId, label, line1, line2, city, pincode, location, isDefault, phone }
Coupon       { _id, vendorId?, code, type:'flat'|'percent', value, minOrder,
               maxDiscount, usageLimit, usedCount, perUserLimit, validFrom, validTo, isActive }
Notification { _id, userId, type, title, body, data, readAt, createdAt }
AuditLog     { _id, actorId, actorRole, action, entity, entityId, before, after, ip, at }
Setting      { _id, key unique, value, updatedBy, updatedAt }
IdempotencyKey { _id, key unique, scope, response, createdAt }   // TTL 24h
```

## 5.2 Two rules that prevent the classic disasters

**Money is always an integer in paise.** Never a float. `₹149.50` is stored as `14950`.
Floating-point rupees produce settlement reports that are off by a few paise and take a week to debug.

**Stock lives only in `inventory`, never on `product`.** Two writers to the same quantity in two
collections is how oversell bugs are born.

## 5.3 Order state machine

The backend is the only authority. Any transition not on this diagram is rejected with `409`.

```
                        ┌──────────► REJECTED (vendor declines)
                        │
  PLACED ──► ACCEPTED ──┼──► PACKING ──► READY_FOR_PICKUP ──► ASSIGNED
    │                                                            │
    │                                                            ▼
    │                                                       PICKED_UP
    ▼                                                            │
CANCELLED ◄──────────────── (approval required after ACCEPTED)   ▼
                                                        OUT_FOR_DELIVERY
                                                                 │
                                                    ┌────────────┴────────────┐
                                                    ▼                         ▼
                                                DELIVERED            DELIVERY_FAILED
                                                                             │
                                                                             ▼
                                                                     (retry → ASSIGNED)
```

```ts
// orders/state-machine.ts — single source of truth, imported by service AND tests
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PLACED:           ['ACCEPTED', 'REJECTED', 'CANCELLED'],
  ACCEPTED:         ['PACKING', 'CANCELLED'],
  PACKING:          ['READY_FOR_PICKUP', 'CANCELLED'],
  READY_FOR_PICKUP: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED:         ['PICKED_UP', 'READY_FOR_PICKUP'],   // partner drops → back to pool
  PICKED_UP:        ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_FAILED'],
  DELIVERY_FAILED:  ['ASSIGNED', 'CANCELLED'],
  DELIVERED:        [],   // terminal
  REJECTED:         [],   // terminal
  CANCELLED:        [],   // terminal
};

export const ALLOWED_ACTOR: Record<string, Role[]> = {
  'PLACED→ACCEPTED':            ['vendor'],
  'PLACED→REJECTED':            ['vendor'],
  'READY_FOR_PICKUP→ASSIGNED':  ['vendor', 'admin', 'system'],
  'ASSIGNED→PICKED_UP':         ['delivery'],
  'OUT_FOR_DELIVERY→DELIVERED': ['delivery'],   // + OTP must verify
};
```

Every transition appends to `statusHistory` with actor, role, reason and timestamp — **inside the
same transaction as the status write**. That is what makes the order auditable.

---

# 6. API & REALTIME CONTRACT

## 6.1 Conventions

- Base `/api/v1`. Bearer access token (15 min). Refresh token (7 days) in an httpOnly cookie.
- Every list endpoint: `?page=1&limit=20&sort=-createdAt` → `{ data, meta:{ page, limit, total, pages } }`
- Errors are RFC 7807: `{ type, title, status, detail, instance, errors? }`
- Every mutating endpoint accepts `Idempotency-Key`. Checkout and payment **require** it.
- Swagger at `/api/docs` — **gated behind admin auth in production**, never public.
- **Every route below is protected by default** (§4.2). `🔓` marks the only public ones.

## 6.2 Endpoints

```
AUTH
🔓 POST   /auth/register                     customer signup
🔓 POST   /auth/login                        email|phone + password
🔓 POST   /auth/otp/request                  { phone }                    · 1/min
🔓 POST   /auth/otp/verify                   { phone, otp } → tokens
🔓 POST   /auth/refresh                      rotate + reuse detection
   POST   /auth/logout                       revokes token family
   GET    /auth/me

ADMIN                                        @Roles('admin')
   GET    /admin/vendors ?status=pending
   PATCH  /admin/vendors/:id/status          approve | suspend
   GET    /admin/orders                      cross-vendor view
   GET    /admin/analytics/overview
   GET    /admin/settlements
   POST   /admin/settlements/:id/pay
   GET    /admin/audit-logs
   GET/PUT /admin/settings

VENDOR                                       @Roles('vendor') + VendorScopeGuard
   GET/PUT /vendor/profile
   PATCH  /vendor/store/status               isOpen toggle
   CRUD   /vendor/categories
   CRUD   /vendor/products
   POST   /vendor/products/:id/images        → S3 presigned PUT
   GET    /vendor/inventory
   PATCH  /vendor/inventory/:productId       { delta, reason }
   GET    /vendor/orders ?status=
   PATCH  /vendor/orders/:id/accept
   PATCH  /vendor/orders/:id/reject          { reason }
   PATCH  /vendor/orders/:id/status          { status }
   CRUD   /vendor/delivery-partners
   POST   /vendor/orders/:id/assign          { partnerId }
   GET    /vendor/earnings
   GET    /vendor/reports/sales

CUSTOMER                                     @Roles('customer') + @Owns(...)
🔓 GET    /stores ?lat=&lng=&radius=         browse before login
🔓 GET    /stores/:slug
🔓 GET    /stores/:id/products ?category=&q=&page=
🔓 GET    /products/:id
   GET    /cart ?vendorId=
   POST   /cart/items                        { vendorId, productId, qty }
   PATCH  /cart/items/:productId             { qty }
   DELETE /cart/items/:productId
   POST   /cart/park                         switching store
   CRUD   /addresses
   POST   /checkout/validate                 stock + price + coupon re-check
   POST   /checkout                          Idempotency-Key REQUIRED
   POST   /payments/verify                   client signature verify
   GET    /orders ?page=
   GET    /orders/:id                        @Owns({ model:'Order', field:'customerId' })
   POST   /orders/:id/cancel                 { reason }
   GET    /orders/:id/track
   GET    /notifications

DELIVERY                                     @Roles('delivery')
   PATCH  /delivery/availability             { isOnline, isAvailable }
   GET    /delivery/offers
   POST   /delivery/offers/:id/accept
   POST   /delivery/offers/:id/reject
   GET    /delivery/orders/active
   PATCH  /delivery/orders/:id/picked-up
   PATCH  /delivery/orders/:id/out-for-delivery
   POST   /delivery/orders/:id/deliver       { otp, photoUrl? }
   POST   /delivery/orders/:id/failed        { reason }
   POST   /delivery/location                 { lat, lng }   ← every 10s

WEBHOOKS
🔓 POST   /webhooks/razorpay                 public route, HMAC-verified (§8.3)
```

## 6.3 Socket.IO contract

**Connection:** `io(url, { auth: { token } })`. The gateway verifies the JWT in `handleConnection`
and **disconnects immediately** if invalid. No unauthenticated socket ever exists.

**Rooms — assigned by the server, never requested by the client:**

| Room | Who is auto-joined |
|---|---|
| `user:{userId}` | that user, always |
| `vendor:{vendorId}` | vendor owner + their staff |
| `order:{orderId}` | the customer, the vendor, the assigned partner — verified against the DB on join |
| `admin` | `role=admin` only |

```ts
// The single rule that satisfies Challenge #1 and the source doc's explicit warning:
// "A client must never be allowed to subscribe to another vendor, order or customer
//  room simply by changing an identifier."
@SubscribeMessage('order:subscribe')
async subscribe(@ConnectedSocket() s: Socket, @MessageBody() { orderId }) {
  const order = await this.orders.findById(orderId);
  if (!order) throw new WsException('not_found');

  const u = s.data.user;
  const mayView =
    (u.role === 'customer' && order.customerId.equals(u.sub))          ||
    (u.role === 'vendor'   && order.vendorId.equals(u.vendorId))       ||
    (u.role === 'delivery' && order.deliveryPartnerId?.equals(u.sub))  ||
    (u.role === 'admin');

  if (!mayView) throw new WsException('forbidden');   // changing the id gets you nothing
  s.join(`order:${orderId}`);
}
```

**The 7 events from the source document, with payload shapes:**

| Event | Emitted to | Payload |
|---|---|---|
| `order.created` | `vendor:{vendorId}` | `{ orderId, orderNo, itemCount, total, placedAt }` |
| `order.accepted` | `order:{orderId}` | `{ orderId, status, etaMinutes, acceptedAt }` |
| `order.status_changed` | `order:{orderId}` | `{ orderId, from, to, at, actorRole }` |
| `delivery.assigned` | `user:{partnerId}` | `{ assignmentId, orderId, pickup, drop, payout, expiresAt }` |
| `delivery.location_updated` | `order:{orderId}` | `{ orderId, lat, lng, at, etaMinutes }` |
| `payment.updated` | `order:{orderId}` + `admin` | `{ orderId, status, amount, at }` |
| `notification.created` | `user:{userId}` | `{ id, type, title, body, data }` |

All payload types live in `packages/shared-types`, imported by both the API and the web app — so a
payload change breaks the build instead of breaking production silently.

---

# 7. BUILD PLAN — 10 PHASES

Estimates assume **one full-time senior developer**. Two developers ≈ 0.6× wall-clock, because
frontend and backend split cleanly from Phase 3 onward.

---

## PHASE 0 — Design System, Repo & Landing Page · 4 days

*Built first, deliberately. Every screen after this inherits it.*

1. `pnpm init` workspace + Turborepo. Create `apps/` and `packages/` per §3.2.
2. `packages/config` — ESLint (airbnb-typescript) **including the rule banning `process.env.X || 'fallback'`**, Prettier, base tsconfig with `strict: true`.
3. **`packages/design-system`:**
   - `tokens.css` — every value from §2.3, defined on bare `:root` **first**, then `@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`, then `:root[data-theme="dark"]`. *A token defined only inside a media query is the classic unreadable-UI bug.*
   - `<AisleProvider>` — stamps `data-aisle` on `<html>` from the route segment
   - `<CircadianProvider>` — client-only, computes the window, stamps `data-time`, re-checks hourly
   - Primitives: `Button`, `Input`, `Select`, `Sheet`, `Dialog`, `Toast`, `Skeleton`, `EmptyState`
   - Signature components: **`Basket`** (fill-mass + catch animation), **`ProductCard`** (editorial), **`JourneyRibbon`** (stamp milestones), `StatusPill`, `PriceTag` (mono, tabular-nums)
   - Fonts via `next/font/google` — self-hosted, zero layout shift
4. **Storybook on the design system.** Every primitive rendered in light + dark × all 8 aisle hues = 16 combinations. This is the contrast-checking surface — catch problems here, not in production.
5. **Landing page** (`app/(marketing)`) — SSG, full metadata, OG images, JSON-LD, sitemap, robots. The hero cycles slowly through the aisle hues. This is the first thing anyone sees and it is the design pitch.
6. `docker-compose.yml` — mongo as **replica set** (`--replSet rs0` + init container running `rs.initiate()`), redis, mongo-express.
7. `.env.example` committed with empty values in both `apps/web` and `apps/api`. `.gitignore` covers `.env*` except `.env.example`.

**Exit criteria:** `pnpm dev` boots. Landing page scores ≥95 Lighthouse. Storybook shows 16 theme×aisle combinations. Mongo transactions verified working.

---

## PHASE 1 — Backend Foundation & Config Security · 4 days

1. NestJS app with **`ConfigModule` + the Joi schema from §4.1** — `abortEarly: false`, no defaults on any secret. Verify the process refuses to boot with a missing var *before* writing anything else.
2. Mongoose connection with retry + health indicator.
3. `common/` layer:
   - Global `ValidationPipe` — `whitelist: true, forbidNonWhitelisted: true, transform: true`
   - Global exception filter → RFC 7807, **with the log scrubber** on `password`, `token`, `otp`, `secret`, `signature`, `authorization`
   - Logging interceptor with a per-request correlation id
   - `TransactionService` — a `withTransaction(fn)` helper wrapping session lifecycle
4. `HealthModule` — `/health/live`, `/health/ready` (checks Mongo + Redis).
5. Swagger at `/api/docs`, **admin-gated in production**.
6. Redis module + BullMQ with a separate worker process entry point.
7. `IdempotencyKey` collection + `@Idempotent()` interceptor (TTL 24h).
8. **gitleaks in CI** + `.env.example` lint check (fails if a key exists in `.env.example` that is missing from the Joi schema, or vice versa).
9. Seed script: admin user (password from env, **never hardcoded**), 8 platform categories with `aisleKey` matching §2.2.

**Exit criteria:** `/health/ready` green. Boot fails loudly on a missing secret. gitleaks passes. Transaction helper tested.

---

## PHASE 2 — Auth, RBAC & The Guard Chain · 5 days

**Backend**
1. `argon2id` hashing (`memoryCost: 19456, timeCost: 2, parallelism: 1`) + pepper from `ARGON2_SECRET`.
2. Register / login → access JWT (15m, memory) + refresh (7d, httpOnly cookie).
3. **Refresh rotation with reuse detection** (§4.3) — a token used twice revokes the whole family.
4. OTP: 6-digit, Redis key `otp:{phone}`, TTL 5 min, max 3 attempts, 60s resend cooldown.
5. **★ The global guard chain of §4.2** — `ThrottlerGuard` → `JwtAuthGuard` → `RolesGuard` → `VendorScopeGuard` registered as `APP_GUARD`. `@Public()` decorator. `@Owns()` generic ownership guard.
6. **The public-route assertion test** — enumerates every registered route, asserts that the set carrying `@Public()` exactly equals the list in §6.2. A new unintentionally-public endpoint fails CI.

**Frontend (Next.js)**
7. `app/layout.tsx` with fonts, tokens, providers. Route groups per §3.2.
8. **`middleware.ts`** — the §4.4 edge guard, plus server-side checks in each protected layout.
9. Redux Toolkit + RTK Query base with silent refresh on 401 and request replay. **Access token in memory only.**
10. Login screens in each surface's own visual identity (§2.4) — customer login editorial, delivery login two huge fields.
11. App shells: customer (aisle rail + basket dock), vendor (ops sidebar), delivery (single-column), admin (data sidebar).

**Exit criteria:** All four roles log in, land on their own shell, refresh silently, and are blocked from each other's routes **by the API** — verified with curl, not just the router.

---

## PHASE 3 — Vendor, Catalog & Inventory · 6 days

1. Vendor registration → `status: pending`. Admin approve/suspend. Store profile, hours, `2dsphere` location.
2. Category CRUD, **each mapped to an `aisleKey`** — the field that drives the entire chromatic-aisle UI.
3. Product CRUD with DTO validation. `slug` and `searchText` auto-generated on save.
4. **Image upload via S3 presigned PUT** — the file never passes through the API. Client-side resize to ≤1600px and WebP conversion before upload. Content-type allowlist, 5MB cap.
5. Inventory: one doc per product. `PATCH /vendor/inventory/:productId` with `{ delta, reason }` → **always** writes an `InventoryLog` row in the same transaction. Stock is never *set*, only *adjusted*, so the log always reconstructs the current value.
6. Low-stock threshold → BullMQ job → notification.
7. **Vendor UI:** product table (sortable, filterable, bulk actions), product editor with a live `ProductCard` preview, inventory board with inline stock editing and a low-stock rail.

**Exit criteria:** Vendor creates a category, adds a product with images, sets stock. Admin sees it. Every stock change has a log row. Vendor A cannot touch vendor B's product by id.

---

## PHASE 4 — Discovery, Browse & Cart · 6 days

**Backend**
1. `GET /stores?lat=&lng=` — `$geoNear` against `serviceRadiusKm`, nearest first, `isOpen` surfaced.
2. Product listing with pagination + category filter + text search. **Never a regex `$or` scan** — MongoDB text index now, with a documented cut-over to Atlas Search past ~50k products.
3. Cart: one active cart per `(customerId, vendorId)`. Adding from a different vendor **parks** the current cart rather than destroying it (decision #1).
4. `GET /cart` re-validates every line against live price and stock, returning per-line flags: `price_changed`, `out_of_stock`, `reduced_qty`. Stale carts are the #1 source of checkout failures.

**Frontend — where Mandi becomes visible**
5. Store pages SSR with full product metadata for SEO.
6. **Aisle rail** — `/aisle/[aisleKey]` layout stamps `data-aisle`; the whole interface re-tints over 480ms. *This is the demo moment.*
7. Product grid two-across, editorial cards, `next/image` with blur placeholders, skeletons matching the real card shape.
8. Product sheet — large image, mono price, quantity stepper.
9. **Basket dock** — fill mass, arc-and-catch on add, spring settle.
10. Cart screen with stale-line warnings as inline chips, not a modal.

**Exit criteria:** A customer finds a nearby store, walks the aisles watching the app change colour, builds a valid cart, and a stale cart shows honest warnings.

---

## PHASE 5 — Checkout & Payments · 5 days
*Requires: Razorpay keys in `.env`*

1. Address book with map-pin picker (Google Places autocomplete, **browser key referrer-restricted**).
2. `POST /checkout/validate` — re-price everything server-side. **Client-sent prices are never trusted.**
3. Coupon validation: min order, usage caps, per-user limit, window.
4. **`POST /checkout` — the critical transaction.** Full implementation in §8.2.
5. `PaymentProvider` interface + `RazorpayProvider`. Secrets read from config, never inline.
6. Razorpay Checkout on the client (`NEXT_PUBLIC_RAZORPAY_KEY_ID` only) → `POST /payments/verify` (HMAC, server-side, using `RAZORPAY_KEY_SECRET`).
7. **`POST /webhooks/razorpay`** — the authority, not the client callback. Raw-body HMAC verification, `event.id` deduped through `IdempotencyKey`. See §8.3.
8. COD path: skips the gateway, `payment.status = 'pending'`, marked paid on delivery.
9. Refund endpoint + the partial-refund path for unfulfilled lines.

**Exit criteria:** Prepaid and COD both produce a correct order. Killing the browser mid-payment still settles via webhook. Replaying a webhook changes nothing.

---

## PHASE 6 — Orders, Delivery & Assignment · 7 days
*Requires: commission %, partner ownership model*

1. Order state machine (§5.3) as a standalone module. Every transition: validate → check actor role → write status + history **in one transaction**.
2. Vendor order board — three lanes (New / Preparing / Ready), audible + visual alert on `order.created`, accept/reject with reason.
3. Partial fulfilment: vendor unticks a line → recompute totals → queue refund for the difference.
4. Delivery partner CRUD, onboarding, availability toggle, online/offline.
5. **Assignment engine (§8.5):** `$geoNear` nearest available partner → 45s offer TTL → on reject/expiry offer the next → after 3 attempts escalate to the vendor.
6. Delivery panel: offer screen with countdown, accept/reject, pickup confirm, OTP entry on delivery, photo fallback.
7. OTP proof: 4 digits, **hashed** in the order doc, revealed to the customer only after `OUT_FOR_DELIVERY`.
8. Commission: on `DELIVERED`, write `LedgerEntry` rows — `sale` (+) and `commission` (−) — using the **snapshot percentage from the order**, never the vendor's current rate.
9. Weekly settlement job (BullMQ repeatable, Monday 02:00).

**Exit criteria:** Full journey — place → accept → pack → ready → assign → accept → pickup → deliver with OTP → ledger balances. Invalid transitions return 409. A partner rejecting causes reassignment.

---

## PHASE 7 — Realtime & Live Tracking · 5 days

1. Socket.IO gateway with JWT auth in `handleConnection` and **`@socket.io/redis-adapter` wired from day one**.
2. Auto-join `user:` and `vendor:` rooms on connect. `order:` rooms verified against the DB per §6.3.
3. Emit all 7 events. **Emission happens after the transaction commits, never inside it** — otherwise a rollback broadcasts an event for an order that does not exist.
4. Client `useSocket()` hook: connect, reconnect with backoff, re-subscribe on reconnect, dispatch into the RTK Query cache so the UI updates without a refetch.
5. Rider location: `navigator.geolocation.watchPosition`, throttled to 10s, batched, only while `OUT_FOR_DELIVERY`. Pings write to `LocationPing` (7-day TTL) and broadcast to `order:{id}`.
6. **The Journey Ribbon** (§2.2 Pillar 4) — fills with the aisle colour, milestones land as stamps.
7. Google Maps below the ribbon — desaturated custom style, store pin, drop pin, live rider marker interpolated between pings so it glides instead of teleporting.
8. Connection-state banner: `live` / `reconnecting` / `last seen 2m ago`. **Stale location is shown honestly, never faked.**

**Exit criteria:** Two browsers side by side — vendor accepts, customer sees it instantly. Rider moves, ribbon advances. Kill the network; the banner says so; reconnect restores state.

---

## PHASE 8 — Notifications, Reports & Audit · 5 days

1. Notification service: one call fans out to in-app + email + SMS + push by user preference. **Every external send is a BullMQ job** with exponential backoff and 3 retries — a slow SendGrid call must never block an order API.
2. Templates: placed / accepted / out for delivery / delivered / cancelled / refunded.
3. Email via SES or SendGrid. SMS/OTP via MSG91. Push via FCM + web service worker.
4. In-app notification centre with unread counts, driven by `notification.created`.
5. Admin analytics: GMV, orders/day, AOV, top vendors, top products, cancellation rate. **Pre-aggregated nightly** into `DailyStat` — never `$group` over raw orders on page load.
6. Vendor reports: sales by period, best sellers, earnings, settlement history. CSV export.
7. `AuditInterceptor` on every admin and vendor mutation → `AuditLog` with before/after diff.
8. Admin audit viewer with filters.

**Exit criteria:** Every transition notifies the right people through the right channels. A dead SMS provider degrades to a retry, never a 500. Reports load under 500ms.

---

## PHASE 9 — Hardening, Testing & Deployment · 6 days

1. **Security pass:** helmet, CORS allowlist from env, CSP per §4.5, rate limits, `express-mongo-sanitize`, payload caps, dependency audit, **full secret-handling review against §4.1**.
2. **The isolation test suite** — the most valuable tests in the repo. For every vendor endpoint, authenticate as vendor A and address vendor B's resource. All must 403/404.
3. **The public-route assertion test** (from Phase 2) runs in CI on every PR.
4. Unit tests (Jest): state machine exhaustively, pricing, commission, coupons, OTP.
5. Integration tests (Supertest + `mongodb-memory-server`): every endpoint × every role, happy + forbidden.
6. **Concurrency test:** 50 parallel checkouts against 10 units of stock → exactly 10 succeed, 40 get a clean `409`, final stock is 0. Never −40.
7. E2E (Playwright): customer journey, vendor accept, rider delivery.
8. Load smoke (k6): 200 concurrent sockets, 50 orders/min.
9. Multi-stage Dockerfiles (build → slim runtime, non-root user). **No secrets in `ARG`, no `COPY .env`.**
10. Nginx: TLS via certbot, HTTP/2, brotli, security headers, `/socket.io` proxied with correct upgrade headers and `ip_hash` sticky sessions.
11. GitHub Actions: gitleaks → lint → typecheck → unit → integration → build → image push → deploy. Staging on `develop`, production on tag.
12. Sentry (API + web, release tracking, sourcemaps, **PII scrubbing on**). `/metrics` for Prometheus. Uptime on `/health/ready`.
13. Backups: nightly `mongodump` to S3, 30-day retention, **and a restore drill that has actually been run once**.

**Exit criteria:** Green pipeline. Staging deployed. Load test passes. A restore has been performed successfully.

---

# 8. HARD PROBLEMS, SOLVED

The source document lists 17 technical challenges. These six will actually break the product if
handled casually.

## 8.1 Multi-vendor data isolation (Challenge #1)

**Risk:** vendor A changes an id in a URL and reads vendor B's orders or revenue.

**Never rely on the frontend, or on remembering to add a filter.** Four layers:

```ts
// 1. The vendorId comes from the VERIFIED JWT. Never from params or body.
@Injectable()
export class VendorScopeGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.role === 'admin') return true;     // admin is cross-vendor by design
    if (!req.user?.vendorId) throw new ForbiddenException();
    req.vendorScope = req.user.vendorId;             // injected, not requested
    return true;
  }
}

// 2. Every vendor-owned repository method REQUIRES the scope in its signature.
//    There is no overload without it, so it cannot be forgotten.
async findOrder(orderId: string, vendorScope: string) {
  return this.model.findOne({ _id: orderId, vendorId: vendorScope });  // both, always
}

// 3. Socket rooms assigned server-side only (§6.3).
// 4. The isolation test suite (§9.1) — isolation you have not tried to break
//    is isolation you do not have.
```

## 8.2 Inventory race conditions (Challenge #4)

**Risk:** two customers buy the last unit simultaneously; both orders succeed; stock goes negative.

`findOne` → check → `save` **is the bug**. The check and the write must be one atomic operation,
with the filter itself enforcing the invariant:

```ts
async checkout(dto: CheckoutDto, customerId: string) {
  return this.txn.withTransaction(async (session) => {

    // ── 1. Atomically reserve every line.
    //    { stock: { $gte: qty } } in the FILTER means Mongo will not match a
    //    document that lacks the stock. Check and decrement are ONE operation.
    for (const line of dto.items) {
      const res = await this.inventory.updateOne(
        { productId: line.productId, stock: { $gte: line.qty } },
        { $inc: { stock: -line.qty, reserved: line.qty } },
        { session },
      );
      if (res.modifiedCount === 0) {
        throw new ConflictException({        // rolls back every prior line
          code: 'OUT_OF_STOCK', productId: line.productId,
        });
      }
    }

    // ── 2. Re-price server-side. Client totals are advisory at best.
    const pricing = await this.pricing.compute(dto, { session });

    // ── 3. Create the order in the SAME transaction.
    const [order] = await this.orders.create([{
      ...dto, pricing, status: 'PLACED',
      statusHistory: [{ from: null, to: 'PLACED', byUserId: customerId, at: new Date() }],
      deliveryOtpHash: await hash(generateOtp()),
    }], { session });

    return order;
  });
  // Emit order.created only AFTER this returns — never inside the transaction.
}
```

`reserved` is released by a BullMQ job if payment does not complete within 15 minutes, and
converted to a permanent decrement on `DELIVERED`.

**Proven by the Phase 9 concurrency test:** 50 parallel checkouts, 10 units → exactly 10 succeed.

## 8.3 Payment reliability (Challenge #5)

**Risk:** the customer pays, their browser dies before the callback, the order never confirms — or a
retried webhook creates a second order.

**Rule: the webhook is the source of truth. The browser callback is an optimisation.**

```ts
@Public()
@Post('webhooks/razorpay')
@HttpCode(200)                                   // always 200, or Razorpay retries forever
async handle(@Req() req: RawBodyRequest<Request>,
             @Headers('x-razorpay-signature') sig: string) {

  // 1. Verify against the RAW body. A parsed body will not match the HMAC.
  //    Secret from config — never inline, never with a fallback.
  const expected = createHmac('sha256', this.config.getOrThrow('RAZORPAY_WEBHOOK_SECRET'))
    .update(req.rawBody).digest('hex');
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    throw new UnauthorizedException();

  const event = JSON.parse(req.rawBody.toString());

  // 2. Dedupe on the provider's own event id. Razorpay WILL send duplicates.
  const fresh = await this.idem.claim(`rzp:${event.id}`);
  if (!fresh) return { ok: true };                // already processed, silently succeed

  // 3. Process in a transaction, keyed on the ORDER — never on amount or user.
  await this.payments.applyWebhook(event);
  return { ok: true };
}
```

Plus a reconciliation job: every 15 minutes, any order sitting in `payment.status = 'pending'` for
over 20 minutes is checked directly against the Razorpay API and resolved. This catches the webhook
that never arrived.

## 8.4 Invalid order transitions (Challenge #6)

Solved structurally by §5.3. The `TRANSITIONS` map is the single source of truth, imported by both
the service and the tests, so a new status cannot be added without the tests demanding its
transitions be declared. The UI only offers buttons for transitions the map permits.

## 8.5 Delivery assignment & partner failure (Challenge #7)

```
READY_FOR_PICKUP
   ↓
$geoNear → nearest available partner within 5km
   ↓
create DeliveryAssignment { status:'offered', expiresAt: now + 45s }
emit delivery.assigned
   ↓
BullMQ delayed job at expiresAt
   ├─ accepted  → order → ASSIGNED, partner.activeOrderId set
   ├─ rejected  → next partner, attemptNo++
   └─ expired   → next partner, attemptNo++
   ↓
after 3 attempts → notify vendor + admin → manual assignment
```

**Partner goes offline after accepting:** a socket heartbeat every 30s. Two consecutive misses →
partner marked offline → if the order is not yet `PICKED_UP`, it returns to `READY_FOR_PICKUP` and
re-enters the pool. After `PICKED_UP` it escalates to a human — because the goods are physically on
a scooter and no algorithm can fix that.

## 8.6 WebSocket scaling (Challenge #8)

Two API replicas without the Redis adapter means a vendor connected to replica A never receives an
event emitted from replica B. Symptom: *"realtime works locally, fails in production."*

```ts
const pub = createClient({ url: this.config.getOrThrow('REDIS_URL') });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
server.adapter(createAdapter(pub, sub));
```

Nginx needs `ip_hash` so the HTTP long-poll handshake lands on the same replica as the upgrade. Both
go in during Phase 7, not when scaling becomes urgent.

## 8.7 The rest, briefly

| Challenge | Approach |
|---|---|
| **#9 Mongo growth** | Every query has a covering index (§5.1). `LocationPing` 7-day TTL. Notifications 90-day TTL. Analytics pre-aggregated nightly into `DailyStat`, never computed on request. |
| **#10 Search** | Text index in v1. Documented cut-over to Atlas Search past ~50k products. Regex `$or` scans are banned — they table-scan and ignore indexes. |
| **#11 Maps cost** | Geocode once per address and store the result. Never geocode on render. Debounce Places autocomplete at 300ms. Distance from the stored `2dsphere` point, not a Distance Matrix call. Cost alerts at 60% of budget. |
| **#12 Notification failure** | Every external send is a BullMQ job with backoff. A dead provider degrades to a retry, never a failed API response. |
| **#13 Reconciliation** | Append-only `LedgerEntry` in integer paise. Nothing is ever updated, only offset by a new entry. Every entry traces to an order. |
| **#16 PWA limits** | Accepted and designed around: the delivery panel keeps a wake-lock and shows an honest *"location last updated 40s ago"* instead of pretending. The backend is unchanged by a future React Native app — same REST, same sockets. |
| **#17 Third-party outage** | Every provider behind an interface with a timeout and a circuit breaker. Maps down → text address. SMS down → in-app only. Payments down → COD still works. |

---

# 9. TESTING & DEPLOYMENT

## 9.1 Test strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Jest | State machine (exhaustive), pricing, commission, coupons, OTP |
| Integration | Supertest + `mongodb-memory-server` | Every endpoint × every role, happy + forbidden |
| **Isolation** | Supertest | **Vendor A against vendor B's every resource. All must fail.** |
| **Public-route assertion** | Jest | The `@Public()` set exactly equals §6.2. A new public route fails CI. |
| **Secret hygiene** | gitleaks + custom lint | No committed secrets, no `\|\|` fallbacks |
| **Concurrency** | Jest + `Promise.all` | 50 checkouts vs 10 stock → exactly 10 succeed |
| E2E | Playwright | Customer journey, vendor accept, rider delivery |
| Load | k6 | 200 sockets, 50 orders/min |

The isolation, public-route and concurrency suites are the three that protect the business.
Everything else protects the code.

## 9.2 Security checklist

**Credentials**
- [ ] Joi schema validates every env var at boot, `abortEarly: false`
- [ ] **Zero `process.env.X || 'fallback'` anywhere** — enforced by ESLint rule, not convention
- [ ] `.env.example` committed with empty values; `.env*` gitignored
- [ ] gitleaks passing on every PR, including history
- [ ] Production secrets from a secret manager, injected at container start
- [ ] No secrets in Docker `ARG`, image layers, or CI logs
- [ ] Log scrubber on `password`, `token`, `otp`, `secret`, `signature`, `authorization`
- [ ] Key rotation runbook written and tested

**API**
- [ ] Global `APP_GUARD` chain — deny by default
- [ ] `@Public()` list matches §6.2 exactly, asserted by test
- [ ] `VendorScopeGuard` on every vendor route, verified by the isolation suite
- [ ] `@Owns()` on every customer-resource route, 404 (not 403) on mismatch
- [ ] `whitelist: true, forbidNonWhitelisted: true`
- [ ] `express-mongo-sanitize` against operator injection
- [ ] Rate limits: 5/min auth, 1/min OTP resend, 100/min general
- [ ] Swagger admin-gated in production

**Auth**
- [ ] argon2id + pepper, never bcrypt defaults
- [ ] Refresh rotation with reuse detection
- [ ] Access token in memory only, never `localStorage`
- [ ] Refresh in httpOnly + Secure + SameSite=Strict cookie

**Transport & client**
- [ ] CSP per §4.5, HSTS with preload, `frame-ancestors 'none'`
- [ ] CORS allowlist from env, never `*`
- [ ] Maps browser key HTTP-referrer restricted in GCP
- [ ] Razorpay `key_secret` never reaches the client bundle
- [ ] Socket rooms assigned server-side only
- [ ] Webhook HMAC verified against the raw body
- [ ] S3 presigned uploads, content-type allowlist, 5MB cap

## 9.3 Environments

| Env | Where | Secrets from | Deploys on |
|---|---|---|---|
| Local | Docker Compose | `.env.local` (gitignored) | — |
| Staging | 1 VPS, Compose | Secret manager | merge to `develop` |
| Production | 2+ API replicas behind Nginx, Mongo Atlas M10+, managed Redis | Secret manager, injected at container start | tag `v*` |

## 9.4 Pre-launch gate

- [ ] Concurrency test passes
- [ ] Isolation suite passes
- [ ] Public-route assertion passes
- [ ] gitleaks clean on full history
- [ ] Webhook replay is a no-op
- [ ] **Backup restore drill actually performed**
- [ ] Sentry receiving from API + web, PII scrubbed
- [ ] Lighthouse ≥ 90 on customer app, ≥ 95 on landing
- [ ] Contrast verified across all 8 aisles × 2 themes
- [ ] Full keyboard path through browse → checkout

---

# 10. TIMELINE REALITY

## 10.1 Effort

| Phase | Days | Cumulative |
|---|---|---|
| 0 · Design system, repo, landing | 4 | 4 |
| 1 · Backend foundation & config security | 4 | 8 |
| 2 · Auth, RBAC, guard chain | 5 | 13 |
| 3 · Vendor, catalog, inventory | 6 | 19 |
| 4 · Discovery, browse, cart | 6 | 25 |
| 5 · Checkout & payments | 5 | 30 |
| 6 · Orders, delivery, assignment | 7 | 37 |
| 7 · Realtime & tracking | 5 | 42 |
| 8 · Notifications, reports, audit | 5 | 47 |
| 9 · Hardening, testing, deploy | 6 | **53** |

**53 working days ≈ 10.5 weeks for one developer.** With two (backend + frontend splitting from
Phase 3): **≈ 7 weeks.**

## 10.2 What 4 weeks actually buys

20 working days gets through **Phase 6, partially**:

| Status | Scope |
|---|---|
| ✅ Ships | Design system, landing page, auth + RBAC + full guard chain, 4 shells, vendor catalog + inventory, customer browse + cart, checkout + Razorpay, order lifecycle, basic delivery assignment |
| ⚠️ Thin | Realtime (core events only, no live map), admin panel (approve vendors + view orders only) |
| ❌ Deferred | Live location tracking, the Journey Ribbon, SMS/email/push, analytics, audit logs, coupons, settlement automation, full test suite, CI/CD |

**Recommendation:** ship a **6-week demoable MVP** (through Phase 7 — including the tracking
experience, because that is the screen that sells the product), then a **4-week hardening release**
for Phases 8–9. Calling a 10-week build "4 weeks" does not make it faster; it only moves the
discovery to week 4.

## 10.3 Top risks

| Risk | Impact | Mitigation |
|---|---|---|
| Razorpay KYC delay | Blocks Phase 5 | Start the application **today**. Build against test keys meanwhile. |
| Partner ownership undecided | Blocks Phase 6 assignment | Needed by day 19. Decide by day 12. |
| Mongo standalone instead of replica set | Transactions silently unavailable → oversell in production | Verified in Phase 0 exit criteria. Non-negotiable. |
| Redis adapter skipped | Realtime breaks on the second replica | In from Phase 7 day one. |
| A secret reaches the repo | Full credential rotation + possible breach | gitleaks in CI from Phase 1, plus the ESLint fallback ban. |
| Frontend route guard mistaken for security | Data exposed to any curl request | §4.4 states the rule explicitly. The isolation suite proves the API, not the router. |
| Scope creep from the 18-module list | Everything ships half-done | Phases are ordered by dependency. Do not start Phase N+1 before N's exit criteria pass. |
| Design system built last | Four surfaces drift into four looks | Phase 0 exists precisely to prevent this. |

---

## NEXT STEP

Confirm or change the 11 locked decisions in §1, then pick where to start:

1. **Phase 0** — scaffold the Next.js + NestJS monorepo, build the Mandi design system (Storybook, all 8 aisles, both themes), and ship the landing page
2. **Phase 1 + 2** — backend foundation, the Joi env gate, the deny-by-default guard chain, auth, four shells
3. **A live UI prototype first** — customer browse + aisle-shift + basket + Journey Ribbon, clickable, so you can see the design before any backend exists

**If the UI is what matters most to you, start with 3.**
