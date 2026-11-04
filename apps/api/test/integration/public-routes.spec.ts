import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, Reflector } from '@nestjs/core';
import request from 'supertest';
import type { Server } from 'node:http';

import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import {
  TestContext,
  closeTestApp,
  createTestApp,
  nextIp,
} from '../utils/test-app';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  THE PUBLIC-ROUTE ALLOWLIST
 * ════════════════════════════════════════════════════════════════════════
 *
 * This is the single most important test in the suite.
 *
 * The API is deny-by-default: `JwtAuthGuard` is an APP_GUARD, so every
 * route requires a valid access token unless it carries `@Public()`.
 * That inversion means a FORGOTTEN decorator locks a route down — good.
 * The remaining risk is the opposite mistake: someone adds `@Public()` to
 * get past a 401 while debugging, and it ships.
 *
 * So the complete set of public routes is asserted here, exactly. Adding,
 * removing or renaming a public route WILL fail this test, and the fix is
 * to edit this list — a deliberate, reviewable, blame-able change rather
 * than a decorator nobody noticed in a 40-file diff.
 *
 * ── The current set, and why each one is public ─────────────────────────
 *   POST /auth/login    You cannot present a token before you have one.
 *   POST /auth/refresh  Authenticated by the httpOnly refresh COOKIE, not
 *                       by a bearer token; rotation + reuse detection are
 *                       the controls here (§4.3).
 *   GET  /health/live   Liveness probe — the orchestrator has no identity.
 *   GET  /health/ready  Readiness probe, same reason. Returns only
 *                       up/down and whether transactions are available.
 *
 * ── The customer browse routes (added with the shop module) ─────────────
 * All five are CATALOGUE: which stores exist, what they stock, what it
 * costs. None of them is personal, none of them writes anything, and none
 * of them takes an identifier that belongs to a user. "Browse before
 * login" is an explicit requirement of §6.2, and a grocery app that
 * demands an account before it will show a price loses the customer at
 * the front door.
 *
 *   GET /stores                 The store list. Takes lat/lng from the
 *                               QUERY, which is a location the caller
 *                               already knows — it is not read from any
 *                               stored profile.
 *   GET /stores/:slug           One store, addressed by its public,
 *                               human-readable slug.
 *   GET /stores/:id/categories  Aisle navigation for that store.
 *   GET /stores/:id/products    That store's catalogue, with live stock.
 *   GET /products/:id           One product. Also the SEO/SSR entry
 *                               point for a shared product link.
 *   GET /products                Market-wide search and aisle browsing —
 *                               `q`/`aisleKey` across every APPROVED,
 *                               OPEN vendor at once instead of one
 *                               store's shelf. Same CATALOGUE guarantee
 *                               as the five above: nothing personal,
 *                               nothing writable, only APPROVED+OPEN
 *                               vendors and ACTIVE products.
 *   GET /pincodes/:pincode      One serviceable PIN code to its
 *                               approximate centre, read from the same
 *                               static `pincode-table` the two browse
 *                               routes already expose through
 *                               `?pincode=`. It is a fact about WHERE
 *                               THE PLATFORM DELIVERS, not about who is
 *                               asking: the input is supplied by the
 *                               caller, the output is identical for
 *                               everyone, nothing is read from or
 *                               written to any account, and it reveals
 *                               nothing `GET /stores?pincode=` does not
 *                               already imply. It is public because it
 *                               HAS to be: it is the non-map way to get
 *                               the lat/lng `CreateAddressDto` requires,
 *                               and a customer who denied geolocation on
 *                               a deployment with no Maps billing cannot
 *                               save an address — and therefore cannot
 *                               check out — without it. A location
 *                               fallback gated behind a login would fail
 *                               precisely the customer it exists for.
 *
 * Every one of them returns only APPROVED vendors and ACTIVE products,
 * so a suspended store is invisible rather than merely unbuyable. The
 * moment any of them starts returning something personal — a saved
 * store, a recent search, a personalised price — it stops being public
 * and comes off this list.
 *
 * ── Signup (added with the registration flow) ────────────────────────────
 * You cannot present a token before you have an account, so every entry
 * point INTO an account is necessarily public. Each one is hardened a
 * different way instead of relying on authentication:
 *
 *   POST /auth/register/request-otp   Hardest-throttled route in the API
 *                                     (3/min). Behaves IDENTICALLY whether
 *                                     or not the phone already has an
 *                                     account — no enumeration oracle.
 *   POST /auth/register/verify-otp    Guarded by the OTP itself: 3 wrong
 *                                     guesses locks the challenge, and it
 *                                     expires in 5 minutes regardless.
 *   POST /auth/register               Cannot succeed without a
 *                                     `registrationToken`, which only
 *                                     `verify-otp` can mint, and only for
 *                                     a phone that was just proven to
 *                                     belong to the caller.
 *   POST /auth/apply/vendor           Creates User+Vendor BOTH `pending`.
 *                                     The account cannot log in
 *                                     (`AuthService.login` rejects
 *                                     anything but ACTIVE) until an admin
 *                                     approves it — signup is not login.
 *   POST /auth/apply/rider            Same shape as apply/vendor, but for
 *                                     the shared platform delivery pool
 *                                     (`DeliveryPartner.vendorId: null`).
 *
 * ── The payment webhook (added with the payments phase, §8.3) ───────────
 *   POST /webhooks/razorpay   Razorpay is a server-to-server caller with
 *                             no session to present — it cannot send a
 *                             bearer token, so `@Public()` is the only
 *                             way it can reach the API at all. Trust
 *                             comes entirely from `PaymentsService.
 *                             handleWebhook`, which verifies an
 *                             HMAC-SHA256 signature over the RAW request
 *                             body (never the parsed one) against
 *                             `RAZORPAY_WEBHOOK_SECRET` before it
 *                             believes a single byte of the payload, and
 *                             answers 401 for anything that does not
 *                             verify. It writes nothing based on
 *                             `req.user` because there is none.
 *
 * Deliberately NOT present:
 *   Any admin/super-admin self-signup route — there is none, on purpose.
 *                         An admin account is created only by another
 *                         admin or by the bootstrap seed.
 */
const EXPECTED_PUBLIC_ROUTES: readonly string[] = [
  'POST /auth/login',
  'POST /auth/refresh',
  'GET /health/live',
  'GET /health/ready',

  // ── Customer browse (shop module) ─────────────────────────────────
  'GET /stores',
  'GET /stores/:slug',
  'GET /stores/:id/categories',
  'GET /stores/:id/products',
  'GET /products/:id',
  // Market-wide search/browse across every APPROVED, OPEN vendor — the
  // same CATALOGUE guarantee as the five rows above it, just not scoped
  // to one store first. `?pincode=` on `GET /stores` (above) is the
  // other half of this task's public surface: a query-string addition
  // to an ALREADY-public route, not a new route signature, so it needs
  // no separate line here.
  'GET /products',
  // The non-map lat/lng fallback. Static table in, static centre out —
  // see the justification in the header block above.
  'GET /pincodes/:pincode',
  // The top eight search terms of the last week. An aggregate over
  // per-day counters that hold a term, a day and a number — no user id,
  // no IP, no field to put one in — so it is the same eight words for
  // every caller. A term needs two searches in the window to show.
  'GET /search/popular',
  // Verified-purchase reviews of one product. The same CATALOGUE
  // guarantee: only ACTIVE products of APPROVED stores, only reviews an
  // admin has not hidden, and each author shown as "First L." — never an
  // id, phone or full name. Read-only; writing a review needs a CUSTOMER
  // token and a delivered order.
  'GET /products/:id/reviews',

  // ── Signup ──────────────────────────────────────────────────────────
  'POST /auth/register/request-otp',
  'POST /auth/register/verify-otp',
  'POST /auth/register',
  'POST /auth/apply/vendor',
  'POST /auth/apply/rider',

  // ── Payments (§8.3) ───────────────────────────────────────────────
  'POST /webhooks/razorpay',

  // ── Help / privacy / terms ──────────────────────────────────────────
  // Six non-sensitive settings — platform name, support email and
  // phone, delivery fee, free-delivery threshold, default radius — that
  // are already printed on public pages. Identical for every caller,
  // read-only, and built key by key from an allowlist; commission, the
  // COD ceiling, maintenance mode and ops thresholds are never in it.
  // `public-settings.spec.ts` asserts the exact key set.
  'GET /settings/public',
];

interface RouteInfo {
  signature: string;
  controller: string;
  handler: string;
  isPublic: boolean;
}

/** Strips leading/trailing slashes so segments join cleanly. */
const normalise = (segment: unknown): string =>
  typeof segment === 'string' ? segment.replace(/^\/+|\/+$/g, '') : '';

/**
 * Walks every controller Nest actually registered and reports each route
 * with its `@Public()` status.
 *
 * This reads the SAME metadata `JwtAuthGuard` reads at runtime, via the
 * same `Reflector`, so the test cannot drift from the guard's behaviour.
 */
function enumerateRoutes(
  discovery: DiscoveryService,
  reflector: Reflector,
): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance;
    const metatype = wrapper.metatype;
    if (!instance || typeof metatype !== 'function') continue;

    const controllerPath = normalise(
      Reflect.getMetadata(PATH_METADATA, metatype),
    );
    const prototype = Object.getPrototypeOf(instance) as object;

    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;

      // Read the descriptor rather than the property, so a getter on the
      // prototype is never invoked just by enumerating.
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      const handler = descriptor.value as (...args: unknown[]) => unknown;
      if (!Reflect.hasMetadata(PATH_METADATA, handler)) continue;

      const methodPath = normalise(Reflect.getMetadata(PATH_METADATA, handler));
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;

      const segments = [controllerPath, methodPath].filter(Boolean);
      const path = `/${segments.join('/')}`;
      const method = RequestMethod[verb ?? RequestMethod.GET];

      routes.push({
        signature: `${method} ${path}`,
        controller: metatype.name,
        handler: name,
        isPublic:
          reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            handler,
            metatype,
          ]) === true,
      });
    }
  }

  return routes;
}

describe('Deny-by-default: the public-route allowlist', () => {
  let ctx: TestContext;
  let routes: RouteInfo[];

  beforeAll(async () => {
    ctx = await createTestApp();
    routes = enumerateRoutes(
      ctx.app.get(DiscoveryService),
      ctx.app.get(Reflector),
    );
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  it('enumerates the application successfully (guards the test itself)', () => {
    // If route discovery silently returned nothing, every assertion below
    // would pass vacuously. This is the canary for that.
    expect(routes.length).toBeGreaterThanOrEqual(
      EXPECTED_PUBLIC_ROUTES.length + 1,
    );
    expect(routes.map((r) => r.signature)).toContain('GET /auth/me');
  });

  it('exposes EXACTLY the approved public routes — no more, no fewer', () => {
    const actual = routes
      .filter((route) => route.isPublic)
      .map((route) => route.signature)
      .sort();

    const expected = [...EXPECTED_PUBLIC_ROUTES].sort();

    const unexpected = routes.filter(
      (route) => route.isPublic && !EXPECTED_PUBLIC_ROUTES.includes(route.signature),
    );
    const missing = expected.filter((sig) => !actual.includes(sig));

    const failure = [
      unexpected.length
        ? 'UNAUTHORISED PUBLIC ROUTE(S) — these carry @Public() but are not on the allowlist:\n' +
          unexpected
            .map(
              (route) =>
                `    ${route.signature}   (${route.controller}.${route.handler})`,
            )
            .join('\n') +
          '\n  Every @Public() route is an UNAUTHENTICATED entry point into the API.\n' +
          '  If it genuinely must be public, add it to EXPECTED_PUBLIC_ROUTES in\n' +
          '  this file together with a one-line justification. If it must not be,\n' +
          '  delete the @Public() decorator.'
        : '',
      missing.length
        ? 'MISSING PUBLIC ROUTE(S) — on the allowlist but no longer public:\n' +
          missing.map((sig) => `    ${sig}`).join('\n') +
          '\n  Either the route was renamed/removed (update the allowlist) or it\n' +
          '  lost its @Public() decorator (login and the health probes must stay\n' +
          '  reachable without a token).'
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    // Thrown rather than asserted so the explanation above is what the
    // developer actually reads, instead of a bare array diff.
    if (unexpected.length || missing.length) throw new Error(`\n\n${failure}\n`);

    expect(actual).toEqual(expected);
  });

  it('rejects every non-public route with 401 when no token is presented', async () => {
    const server = ctx.app.getHttpServer() as Server;
    const protectedRoutes = routes.filter((route) => !route.isPublic);

    expect(protectedRoutes.length).toBeGreaterThan(0);

    for (const route of protectedRoutes) {
      const [method, path] = route.signature.split(' ');
      const verb = method.toLowerCase() as
        | 'get'
        | 'post'
        | 'put'
        | 'patch'
        | 'delete';

      const response = await request(server)
        [verb](path)
        .set('X-Forwarded-For', nextIp());

      // 401 — not 403, not 400, not 404. The guard chain rejects an
      // anonymous caller before any routing parameter, body validation or
      // database lookup happens.
      if (response.status !== 401) {
        throw new Error(
          `\n\nUNPROTECTED ROUTE: ${route.signature} ` +
            `(${route.controller}.${route.handler}) returned ` +
            `${response.status} to an anonymous request; expected 401.\n` +
            `A route without @Public() must never be reachable without a ` +
            `valid access token.\n`,
        );
      }
      expect(response.status).toBe(401);
    }
  }, 60_000);
});
