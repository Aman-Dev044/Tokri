import 'reflect-metadata';

import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { SeedDemoModule } from './seed-demo.module';
import { SeedDemoService } from './seed-demo.service';

/**
 * Mandi — demo dataset seeder.
 *
 *   pnpm --filter @mandi/api seed:demo
 *   pnpm --filter @mandi/api seed:demo -- --fresh
 *
 * Plants a believable 90 days of Indian grocery trade: eight vendors
 * (two awaiting approval, one suspended), eight aisles, eighty products
 * with real names and rupee prices, live inventory, forty customers,
 * twelve riders, ~400 orders with progressing status timelines, the
 * matching ledger rows, weekly settlements, coupons and audit history.
 *
 * ── Deliberately SEPARATE from `pnpm seed` ─────────────────────────────
 * `seed` provisions the two real platform accounts and must be safe to
 * run anywhere, including production. This one invents data. Merging them
 * would mean the only way to create a super-admin on a fresh production
 * database was to also create four hundred fictional orders in it.
 *
 * Three rules, same as the account seeder:
 *  1. No credential in source. The demo password comes from
 *     SEED_DEMO_PASSWORD and is never printed.
 *  2. Running it twice is safe — it detects existing demo data and stops.
 *  3. `--fresh` deletes ONLY records marked `isDemo: true`. Never a
 *     collection drop: this seeder is routinely pointed at a shared Atlas
 *     database that also holds the real bootstrap accounts.
 */

const args = process.argv.slice(2);
const FRESH = args.includes('--fresh') || process.env.SEED_FRESH === 'true';

const logger = new Logger('SeedDemo');

/**
 * The footgun guard.
 *
 * Fictional vendors and four hundred invented orders in a live database
 * is not a mistake anybody recovers from quickly. Running here has to be
 * a deliberate, explicit act.
 */
function assertNotProduction(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.SEED_ALLOW_PRODUCTION === 'true') {
    logger.warn(
      'NODE_ENV=production and SEED_ALLOW_PRODUCTION=true — planting DEMO ' +
        'data into a production database. This is almost certainly a mistake.',
    );
    return;
  }
  throw new Error(
    'Refusing to seed demo data with NODE_ENV=production. ' +
      'Set SEED_ALLOW_PRODUCTION=true to override, and only if you are certain.',
  );
}

async function main(): Promise<void> {
  // Cheap pre-check before we dial the database at all. Re-checked below
  // once ConfigModule has merged `.env` into process.env.
  assertNotProduction();

  let app: INestApplicationContext | undefined;

  try {
    app = await NestFactory.createApplicationContext(SeedDemoModule, {
      logger: ['error', 'warn', 'log'],
      abortOnError: false,
    });

    assertNotProduction();

    const seeder = app.get(SeedDemoService);

    if (FRESH) {
      logger.warn('--fresh: deleting every record marked isDemo: true.');
      const deleted = await seeder.wipe();
      for (const [collection, count] of Object.entries(deleted)) {
        if (count > 0) logger.log(`  removed ${String(count).padStart(5)} ${collection}`);
      }
    } else if (await seeder.hasDemoData()) {
      logger.log(
        'Demo data is already present — nothing to do. ' +
          'Re-run with `-- --fresh` to rebuild it from scratch.',
      );
      return;
    }

    const started = Date.now();
    const summary = await seeder.run();
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    logger.log(`Demo data planted in ${seconds}s:`);
    for (const [label, count] of Object.entries(summary)) {
      logger.log(`  ${label.padEnd(16)} ${String(count).padStart(5)}`);
    }
    logger.log(
      'Demo accounts use the password in SEED_DEMO_PASSWORD. ' +
        'Emails are <name>@demo.mandi.app.',
    );
  } finally {
    // Always release the Mongoose connection — a dangling Atlas
    // connection keeps the process alive forever.
    await app?.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Demo seed failed: ${message}`);
    if (/seed\.demoPassword/.test(message)) {
      logger.error(
        'SEED_DEMO_PASSWORD is not set. Add it to apps/api/.env (minimum 12 ' +
          'characters). The API itself does not need it — only this seeder does.',
      );
    }
    if (/timed out|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ServerSelection/i.test(message)) {
      logger.error(
        'Could not reach MongoDB. If this is Atlas, check that this machine’s ' +
          'public IP is on the cluster’s Network Access allowlist.',
      );
    }
    process.exit(1);
  });
