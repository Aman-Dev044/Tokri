import 'reflect-metadata';

import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { getConnectionToken } from '@nestjs/mongoose';

import { SeedRolesModule } from './seed-roles.module';
import { PasswordService } from '../../common/utils/password.service';
import { Role, UserStatus } from '../../common/constants/roles.enum';
import { User, UserDocument } from '../schemas/user.schema';
import { Vendor, VendorDocument } from '../schemas/vendor.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
} from '../schemas/delivery-partner.schema';

/**
 * Mandi — one real account per operating role, for manual testing.
 *
 *   pnpm --filter @mandi/api seed:roles
 *   pnpm --filter @mandi/api seed:roles -- --wipe-demo
 *   pnpm --filter @mandi/api seed:roles -- --force
 *
 * Creates VENDOR, CUSTOMER and DELIVERY accounts from the SEED_* values in
 * `.env`, each wired to the structural record its role actually needs:
 * a vendor without a Vendor document is 403'd by VendorScopeGuard on every
 * route, and a rider without a DeliveryPartner document has no offers, no
 * availability and no location.
 *
 * The three rules of `seed.ts` apply here unchanged:
 *   1. No credential in source — every value comes from the validated config.
 *   2. No password is ever printed.
 *   3. Running it twice is safe; `--force` resets the passwords.
 *
 * `--wipe-demo` additionally deletes every record marked `isDemo: true`.
 * It is deliberately a separate flag: wiping a database should never be a
 * side effect of creating an account.
 */

const ARGS = process.argv.slice(2);
const FORCE = ARGS.includes('--force') || process.env.SEED_FORCE === 'true';
const WIPE_DEMO = ARGS.includes('--wipe-demo');

const logger = new Logger('SeedRoles');

/**
 * Collections that carry demo rows.
 *
 * These are the ACTUAL collection names as Mongoose created them, which is
 * not what naive pluralisation predicts: `audit_logs`, not `auditlogs`;
 * `ledger_entries`, not `ledgerentries`; `inventory`, not `inventories`.
 * Guessing here silently deletes nothing and leaves orphans behind, which
 * is exactly what happened the first time.
 */
const DEMO_COLLECTIONS = [
  'users',
  'vendors',
  'categories',
  'products',
  'inventory',
  'inventory_logs',
  'orders',
  'delivery_partners',
  'delivery_assignments',
  'location_pings',
  'ledger_entries',
  'settlements',
  'coupons',
  'coupon_redemptions',
  'audit_logs',
  'addresses',
  'issues',
  'carts',
];

async function wipeDemo(connection: Connection): Promise<void> {
  logger.warn('Wiping demo data (isDemo: true) …');
  const db = connection.db;
  if (!db) throw new Error('No database handle');

  const existing = new Set(
    (await db.listCollections().toArray()).map((c) => c.name),
  );

  let total = 0;
  for (const name of DEMO_COLLECTIONS) {
    if (!existing.has(name)) continue;
    const { deletedCount } = await db
      .collection(name)
      .deleteMany({ isDemo: true });
    if (deletedCount) {
      logger.log(`  ${name.padEnd(22)} ${String(deletedCount).padStart(5)} removed`);
      total += deletedCount;
    }
  }

  // Not every row carries `isDemo`. Anything still pointing at a vendor or
  // product that no longer exists is an orphan: invisible to a query that
  // joins, but it still inflates counts and corrupts settlement totals.
  const ids = async (collection: string) =>
    (
      await db.collection(collection).find({}, { projection: { _id: 1 } }).toArray()
    ).map((d) => d._id);

  const liveVendorIds = await ids('vendors');
  const liveProductIds = await ids('products');

  const orphanSweeps: { collection: string; field: string; live: unknown[] }[] = [
    { collection: 'orders', field: 'vendorId', live: liveVendorIds },
    { collection: 'carts', field: 'vendorId', live: liveVendorIds },
    { collection: 'ledger_entries', field: 'vendorId', live: liveVendorIds },
    { collection: 'settlements', field: 'vendorId', live: liveVendorIds },
    { collection: 'inventory', field: 'productId', live: liveProductIds },
    { collection: 'inventory_logs', field: 'productId', live: liveProductIds },
  ];

  for (const { collection, field, live } of orphanSweeps) {
    if (!existing.has(collection)) continue;
    const { deletedCount } = await db
      .collection(collection)
      .deleteMany({ [field]: { $nin: live } });
    if (deletedCount) {
      logger.log(
        `  ${collection.padEnd(22)} ${String(deletedCount).padStart(5)} orphaned removed`,
      );
      total += deletedCount;
    }
  }

  // Purely derived records. Every one of these describes activity against
  // data that has just been deleted, so none of it can be meaningful. They
  // are cleared wholesale rather than filtered — an audit row about a
  // vendor that no longer exists is noise, not an audit trail.
  for (const name of [
    'audit_logs',
    'delivery_assignments',
    'location_pings',
    'idempotency_keys',
    'coupon_redemptions',
    'order_counters',
  ]) {
    if (!existing.has(name)) continue;
    const { deletedCount } = await db.collection(name).deleteMany({});
    if (deletedCount) {
      logger.log(`  ${name.padEnd(22)} ${String(deletedCount).padStart(5)} cleared`);
      total += deletedCount;
    }
  }

  logger.warn(`Demo wipe complete — ${total} document(s) removed.`);
}

type Outcome = 'created' | 'password-reset' | 'skipped';

async function upsertUser(
  users: Model<UserDocument>,
  passwords: PasswordService,
  spec: {
    name: string;
    email: string;
    phone: string;
    password: string;
    role: Role;
    vendorId?: Types.ObjectId | null;
  },
): Promise<{ id: Types.ObjectId; outcome: Outcome }> {
  const existing = await users
    .findOne({ $or: [{ email: spec.email }, { phone: spec.phone }] })
    .select('_id role');

  if (existing) {
    if (!FORCE) return { id: existing._id, outcome: 'skipped' };

    await users.updateOne(
      { _id: existing._id },
      {
        name: spec.name,
        email: spec.email,
        phone: spec.phone,
        role: spec.role,
        status: UserStatus.ACTIVE,
        vendorId: spec.vendorId ?? null,
        passwordHash: await passwords.hash(spec.password),
        // Resetting a password must also end live sessions, or the old
        // credential keeps working through an outstanding refresh token.
        refreshTokenHash: null,
        refreshTokenFamily: null,
      },
    );
    return { id: existing._id, outcome: 'password-reset' };
  }

  const created = await users.create({
    name: spec.name,
    email: spec.email,
    phone: spec.phone,
    role: spec.role,
    status: UserStatus.ACTIVE,
    vendorId: spec.vendorId ?? null,
    passwordHash: await passwords.hash(spec.password),
    isSystemAccount: false,
    isDemo: false,
  });

  return { id: created._id, outcome: 'created' };
}

async function run(ctx: INestApplicationContext): Promise<void> {
  const config = ctx.get(ConfigService);
  const passwords = ctx.get(PasswordService);
  const connection = ctx.get<Connection>(getConnectionToken());
  const users = ctx.get<Model<UserDocument>>(getModelToken(User.name));
  const vendors = ctx.get<Model<VendorDocument>>(getModelToken(Vendor.name));
  const partners = ctx.get<Model<DeliveryPartnerDocument>>(
    getModelToken(DeliveryPartner.name),
  );

  if (WIPE_DEMO) await wipeDemo(connection);

  // getOrThrow, never a `||` fallback: a missing SEED_* value must stop the
  // run rather than quietly create an account nobody can log in to.
  const g = (key: string) => config.getOrThrow<string>(key);

  const results: { role: string; email: string; outcome: Outcome }[] = [];

  // ── VENDOR — needs a User AND a Vendor store document ──────────────
  const vendorEmail = g('seed.vendor.email');
  const storeName = g('seed.vendor.storeName');
  const slug = storeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Create the owner first without a vendorId, then link both ways: the
  // Vendor needs an ownerId and the User needs a vendorId.
  const vendorUser = await upsertUser(users, passwords, {
    name: g('seed.vendor.name'),
    email: vendorEmail,
    phone: g('seed.vendor.phone'),
    password: g('seed.vendor.password'),
    role: Role.VENDOR,
  });

  let store = await vendors.findOne({ ownerId: vendorUser.id });
  if (!store) {
    store = await vendors.create({
      ownerId: vendorUser.id,
      storeName,
      slug,
      description: 'Fresh groceries, dairy and daily staples.',
      address: {
        line1: '1st Main Road, HSR Layout Sector 2',
        line2: null,
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560102',
      },
      // [lng, lat] — GeoJSON order, not lat/lng. Reversing this silently
      // places the store in the ocean and every $geoNear returns nothing.
      location: { type: 'Point', coordinates: [77.6387, 12.9121] },
      serviceRadiusKm: 5,
      commissionPct: 8,
      codEnabled: true,
      codMaxAmount: 200_000, // ₹2,000 in paise
      isOpen: true,
      openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        day,
        open: '07:00',
        close: '23:00',
      })),
      status: 'approved',
      rating: 0,
      isDemo: false,
    });
  }

  await users.updateOne({ _id: vendorUser.id }, { vendorId: store._id });
  results.push({ role: 'VENDOR', email: vendorEmail, outcome: vendorUser.outcome });

  // ── CUSTOMER — a plain user, nothing else to wire ──────────────────
  const customerEmail = g('seed.customer.email');
  const customer = await upsertUser(users, passwords, {
    name: g('seed.customer.name'),
    email: customerEmail,
    phone: g('seed.customer.phone'),
    password: g('seed.customer.password'),
    role: Role.CUSTOMER,
  });
  results.push({ role: 'CUSTOMER', email: customerEmail, outcome: customer.outcome });

  // ── DELIVERY — needs a User AND a DeliveryPartner document ─────────
  // vendorId stays null: this rider is on the platform pool, which is a
  // supported configuration (plan section 5.1) and what VendorScopeGuard
  // now allows after the fix.
  const riderEmail = g('seed.delivery.email');
  const rider = await upsertUser(users, passwords, {
    name: g('seed.delivery.name'),
    email: riderEmail,
    phone: g('seed.delivery.phone'),
    password: g('seed.delivery.password'),
    role: Role.DELIVERY,
  });

  const existingPartner = await partners.findOne({ userId: rider.id });
  if (!existingPartner) {
    await partners.create({
      userId: rider.id,
      vendorId: null,
      vehicleType: 'scooter',
      isAvailable: true,
      isOnline: false,
      currentLocation: { type: 'Point', coordinates: [77.6387, 12.9121] },
      locationAt: new Date(),
      activeOrderId: null,
      completedCount: 0,
      rating: 0,
      status: 'active',
      isDemo: false,
    });
  }
  results.push({ role: 'DELIVERY', email: riderEmail, outcome: rider.outcome });

  logger.log('Role accounts:');
  for (const r of results) {
    logger.log(`  ${r.role.padEnd(10)} ${r.email.padEnd(24)} ${r.outcome}`);
  }
  logger.log(`  store linked: "${storeName}" (${slug}) — status approved`);
  if (results.some((r) => r.outcome === 'skipped')) {
    logger.log('  (re-run with --force to reset passwords from .env)');
  }
}

async function main(): Promise<void> {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.SEED_ALLOW_PRODUCTION !== 'true'
  ) {
    logger.error(
      'Refusing to run against NODE_ENV=production without SEED_ALLOW_PRODUCTION=true.',
    );
    process.exit(1);
  }

  let ctx: INestApplicationContext | undefined;
  try {
    ctx = await NestFactory.createApplicationContext(SeedRolesModule, {
      logger: ['error', 'warn', 'log'],
    });
    await run(ctx);
  } catch (error) {
    logger.error(
      `Seed failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (String(error).includes('ECONNREFUSED') || String(error).includes('timed out')) {
      logger.error(
        'Could not reach MongoDB. If this is Atlas, check the Network Access allowlist.',
      );
    }
    process.exitCode = 1;
  } finally {
    await ctx?.close();
  }
}

void main();
