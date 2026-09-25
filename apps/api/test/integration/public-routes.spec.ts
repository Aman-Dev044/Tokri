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
 * Deliberately NOT present:
 *   POST /auth/register — the signup flow (role selection, OTP, vendor KYC
 *                         gate) is still being specified; it is not
 *                         implemented, so it is not public.
 *   The catalog browse routes (GET /stores, GET /products/:id) and
 *   POST /webhooks/razorpay arrive in later phases. Each one is a new
 *   line in this list at the time it lands.
 */
const EXPECTED_PUBLIC_ROUTES: readonly string[] = [
  'POST /auth/login',
  'POST /auth/refresh',
  'GET /health/live',
  'GET /health/ready',
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
