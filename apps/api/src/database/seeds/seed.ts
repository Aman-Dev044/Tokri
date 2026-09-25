import 'reflect-metadata';

import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { SeedModule } from './seed.module';
import { SeedResult, SeedUsersService } from './seed-users';

/**
 * Mandi — bootstrap account seeder.
 *
 *   pnpm --filter @mandi/api seed
 *   pnpm --filter @mandi/api seed -- --force
 *
 * Creates exactly two platform accounts, SUPER_ADMIN and ADMIN, from the
 * SEED_* variables in `.env`.
 *
 * Three rules this file exists to enforce:
 *
 *  1. No credential is ever written in source. Every value comes through
 *     the Joi-validated config the application itself uses, so a missing
 *     or too-short seed password stops the run instead of creating a weak
 *     account that nobody will remember to fix.
 *  2. No password is ever printed. Email, role and outcome only. A seeded
 *     password echoed into a CI log is a leak with a very long tail.
 *  3. Running it twice is safe. Existing accounts are reported and left
 *     alone unless --force is given.
 */

const FORCE =
  process.argv.slice(2).includes('--force') || process.env.SEED_FORCE === 'true';

const logger = new Logger('Seed');

function describe(result: SeedResult): string {
  const outcome =
    result.outcome === 'created'
      ? 'created'
      : result.outcome === 'password-reset'
        ? 'password reset from .env'
        : 'already exists, skipped';

  return `  ${result.label.padEnd(11)} ${result.email.padEnd(32)} ${outcome}`;
}

/**
 * The footgun guard.
 *
 * Seeding a production database with development credentials from a local
 * `.env` is how a known-password admin ends up on a live platform. Running
 * there has to be a deliberate, explicit act.
 */
function assertNotProduction(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.SEED_ALLOW_PRODUCTION === 'true') {
    logger.warn(
      'NODE_ENV=production and SEED_ALLOW_PRODUCTION=true — proceeding. ' +
        'Rotate these passwords immediately after the run.',
    );
    return;
  }
  throw new Error(
    'Refusing to seed with NODE_ENV=production. ' +
      'Set SEED_ALLOW_PRODUCTION=true to override, and only if you are certain.',
  );
}

async function main(): Promise<void> {
  // Cheap pre-check: catches an exported NODE_ENV before we dial the
  // database at all. Re-checked below once `.env` has been loaded.
  assertNotProduction();

  let app: INestApplicationContext | undefined;

  try {
    // A standalone application context, not a full HTTP app: it gives us
    // the real ConfigService, the real PasswordService and a real Mongoose
    // connection, with no server listening on a port.
    app = await NestFactory.createApplicationContext(SeedModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
    });

    // Authoritative check — ConfigModule has now merged `.env` into
    // process.env, so NODE_ENV is whatever the app would actually see.
    assertNotProduction();

    if (FORCE) {
      logger.warn(
        '--force: the two system accounts will have their passwords reset ' +
          'to the current .env values and their sessions revoked.',
      );
    }

    const results = await app.get(SeedUsersService).run(FORCE);

    logger.log('Seed complete:');
    for (const result of results) logger.log(describe(result));

    if (!FORCE && results.every((r) => r.outcome === 'skipped')) {
      logger.log(
        'Nothing changed. To reset these passwords: edit .env, then re-run with --force.',
      );
    }
  } finally {
    // Always release the Mongoose connection, success or failure — a
    // dangling Atlas connection keeps the process alive forever.
    await app?.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Seed failed: ${message}`);
    if (/timed out|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ServerSelection/i.test(message)) {
      logger.error(
        'Could not reach MongoDB. If this is Atlas, check that this machine\u2019s ' +
          'public IP is on the cluster\u2019s Network Access allowlist.',
      );
    }
    process.exit(1);
  });
