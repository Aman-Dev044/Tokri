import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';

import { AppModule } from '../../src/app.module';
import { applyTestEnv } from './test-env';

export interface TestContext {
  app: INestApplication;
  moduleRef: TestingModule;
  mongo: MongoMemoryReplSet;
}

/**
 * Boots the REAL `AppModule` against an in-memory MongoDB replica set.
 *
 * ── Why a replica set and not a standalone mongod ───────────────────────
 * MongoDB only supports multi-document transactions on a replica set. The
 * checkout stock reservation (§8.2) depends on them, and `/health/ready`
 * asserts the deployment is a replica set for exactly that reason. Testing
 * against a standalone would let a transaction bug pass CI and surface in
 * production, so the test topology matches production here.
 *
 * ── Why AppModule and not a hand-assembled module ───────────────────────
 * The global APP_GUARD chain lives in `AppModule`. A test that rebuilt the
 * module graph would quietly test a DIFFERENT application — one without
 * the guards — and the deny-by-default assertions would be worthless.
 */
export async function createTestApp(): Promise<TestContext> {
  const mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  applyTestEnv(mongo.getUri());

  const moduleRef = await Test.createTestingModule({
    // DiscoveryModule is additive — it lets `public-routes.spec.ts`
    // enumerate every registered controller. It adds no routes.
    imports: [AppModule, DiscoveryModule],
  }).compile();

  const app = moduleRef.createNestApplication({
    // Mirrors `main.ts`: without this, `req.rawBody` is never populated
    // and the Razorpay webhook's HMAC verification — which MUST run
    // against the exact bytes Razorpay sent, not a re-serialised body —
    // cannot be tested at all. See `test/integration/payments.spec.ts`.
    rawBody: true,
  });

  // Mirrors `main.ts`. The refresh token arrives in an httpOnly cookie, so
  // without cookie-parser `POST /auth/refresh` can never see it.
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Lets a spec present a distinct source IP per request via
  // `X-Forwarded-For`, so ThrottlerGuard's per-IP counters do not bleed
  // between test cases. Production sits behind Nginx and enables this too.
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.set('trust proxy', true);

  // No global prefix: route assertions read as the paths in §6.2.
  await app.init();

  return { app, moduleRef, mongo };
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.mongo.stop();
}

/**
 * A fresh source IP per request.
 *
 * `/auth/login` is rate-limited to 5 attempts per minute per IP — that
 * limit is a feature under test, not an obstacle to route around by
 * disabling the guard, so each case simply arrives from its own address.
 */
let ipCounter = 0;
export const nextIp = (): string => `10.100.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

/** Pulls one cookie's value out of a `Set-Cookie` response header. */
export function readCookie(
  setCookie: string | string[] | undefined,
  name: string,
): string | undefined {
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];

  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return undefined;

  return match.slice(name.length + 1).split(';')[0];
}

/** The raw `Set-Cookie` entry, so a spec can assert its attributes. */
export function rawCookie(
  setCookie: string | string[] | undefined,
  name: string,
): string | undefined {
  const cookies = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];

  return cookies.find((cookie) => cookie.startsWith(`${name}=`));
}
