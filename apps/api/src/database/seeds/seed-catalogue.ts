import 'reflect-metadata';

import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { SeedCatalogueModule } from './seed-catalogue.module';
import { DEMO_CATEGORIES, DEMO_PRODUCTS } from './demo-catalogue';
import { Category, CategoryDocument } from '../schemas/category.schema';
import { Inventory, InventoryDocument } from '../schemas/inventory.schema';
import { Product, ProductDocument } from '../schemas/product.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { Vendor, VendorDocument } from '../schemas/vendor.schema';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  A CATALOGUE, AND NOTHING ELSE
 * ════════════════════════════════════════════════════════════════════════
 *
 *   pnpm --filter @mandi/api seed:catalogue
 *   pnpm --filter @mandi/api seed:catalogue -- --wipe
 *
 * ── Why this exists next to `seed:demo` ─────────────────────────────────
 * `seed:demo` builds a whole fictional business: eight vendors, forty
 * customers, twelve riders and roughly four hundred invented orders with
 * progressing status timelines. That was deliberately wiped, because four
 * hundred fake orders in the admin console make every real number
 * unreadable.
 *
 * But wiping it left ONE product in the database, and an empty grid looks
 * exactly like a broken page: every screen rendered correctly and showed
 * nothing. This seeds the part that has to exist for the app to be usable
 * — the shelf — and none of the part that made the console unreadable.
 *
 * So: categories, products, stock. No customers, no riders, no orders, no
 * settlements, no issues. Orders are placed through the real API, by a
 * real signed-in customer, which is also the only way to know checkout
 * actually works.
 *
 * ── What it attaches to ─────────────────────────────────────────────────
 * The vendor seeded by `seed:roles` from SEED_VENDOR_EMAIL. Products
 * belong to a vendor in this data model — there is no such thing as a
 * platform-wide product — so a catalogue needs a real shop to hang off.
 *
 * ── The three rules of every seed in this folder ─────────────────────────
 *   1. No credential in source: the vendor is located by the email in the
 *      validated config, never by a literal.
 *   2. Running it twice is safe. Products are upserted on
 *      (vendorId, sku), so a second run updates prices rather than
 *      creating ninety duplicates.
 *   3. Everything written is marked `isDemo: true`, so
 *      `seed:roles -- --wipe-demo` removes all of it in one command. A
 *      catalogue you cannot delete is worse than no catalogue.
 */

const STOCK_PER_PRODUCT = 40;
const LOW_STOCK_THRESHOLD = 8;

const logger = new Logger('SeedCatalogue');

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function run(ctx: INestApplicationContext): Promise<void> {
  const config = ctx.get(ConfigService);
  const users = ctx.get<Model<UserDocument>>(getModelToken(User.name));
  const vendors = ctx.get<Model<VendorDocument>>(getModelToken(Vendor.name));
  const categories = ctx.get<Model<CategoryDocument>>(
    getModelToken(Category.name),
  );
  const products = ctx.get<Model<ProductDocument>>(getModelToken(Product.name));
  const inventory = ctx.get<Model<InventoryDocument>>(
    getModelToken(Inventory.name),
  );

  const wipe = process.argv.includes('--wipe');

  // ── Locate the vendor ────────────────────────────────────────────────
  const vendorEmail = config.getOrThrow<string>('seed.vendor.email');
  const vendorUser = await users.findOne({ email: vendorEmail }).lean();
  if (!vendorUser) {
    logger.error(
      `No user with SEED_VENDOR_EMAIL (${vendorEmail}). Run seed:roles first — ` +
        'a catalogue has to belong to a shop.',
    );
    process.exitCode = 1;
    return;
  }
  if (!vendorUser.vendorId) {
    logger.error(
      `${vendorEmail} exists but has no vendorId. Run seed:roles, which ` +
        'creates the Vendor document the VENDOR role needs.',
    );
    process.exitCode = 1;
    return;
  }

  const vendorId = new Types.ObjectId(vendorUser.vendorId.toString());
  const vendor = await vendors.findById(vendorId).lean();
  if (!vendor) {
    logger.error(`Vendor ${vendorId.toString()} is referenced but missing.`);
    process.exitCode = 1;
    return;
  }
  logger.log(`Vendor: ${vendor.storeName}`);

  if (wipe) {
    const p = await products.deleteMany({ vendorId, isDemo: true });
    const i = await inventory.deleteMany({ vendorId, isDemo: true });
    logger.warn(
      `--wipe: removed ${p.deletedCount} products and ${i.deletedCount} ` +
        'inventory rows. Categories are left alone: they are platform-wide ' +
        'and the aisle rail reads from them.',
    );
    return;
  }

  // ── Categories ───────────────────────────────────────────────────────
  // Platform-wide (`vendorId: null`), one per aisle. Upserted by slug, so
  // the nine that already exist are reused rather than duplicated.
  const categoryIdByAisle = new Map<string, Types.ObjectId>();
  for (const spec of DEMO_CATEGORIES) {
    const existing = await categories.findOneAndUpdate(
      { slug: spec.slug, vendorId: null },
      {
        $set: {
          name: spec.name,
          aisleKey: spec.aisleKey,
          sortOrder: spec.sortOrder,
          isActive: true,
        },
        $setOnInsert: { vendorId: null, parentId: null, isDemo: true },
      },
      { upsert: true, new: true },
    );
    categoryIdByAisle.set(spec.aisleKey, existing._id);
  }
  logger.log(`Categories ready: ${categoryIdByAisle.size}`);

  // ── Products + stock ─────────────────────────────────────────────────
  let created = 0;
  let updated = 0;

  for (const [index, spec] of DEMO_PRODUCTS.entries()) {
    const categoryId = categoryIdByAisle.get(spec.aisleKey);
    if (!categoryId) {
      logger.warn(`No category for aisle ${spec.aisleKey}; skipping ${spec.name}`);
      continue;
    }

    // Stable per (vendor, product): the upsert key, so a second run is an
    // update. Derived from the position, never random.
    const sku = `TKR-${String(1001 + index)}`;

    // Integer paise throughout, and the percentage is rounded here rather
    // than computed in a view, so every surface shows the same number.
    const discountPct =
      spec.mrp > 0 ? Math.round(((spec.mrp - spec.price) / spec.mrp) * 100) : 0;

    const searchText = [spec.name, spec.brand ?? '', spec.aisleKey]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const before = await products.findOne({ vendorId, sku }).select('_id').lean();

    const doc = await products.findOneAndUpdate(
      { vendorId, sku },
      {
        $set: {
          categoryId,
          name: spec.name,
          slug: slugify(spec.name),
          brand: spec.brand,
          unit: spec.unit,
          unitValue: spec.unitValue,
          mrp: spec.mrp,
          price: spec.price,
          discountPct,
          isActive: true,
          searchText,
          description: `${spec.name}${spec.brand ? ` by ${spec.brand}` : ''}.`,
        },
        // `images: []` on insert only — never on update, or a vendor who
        // uploaded a photo would lose it on the next seed run.
        $setOnInsert: { vendorId, sku, images: [], isDemo: true },
      },
      { upsert: true, new: true },
    );

    if (before) {
      updated++;
    } else {
      created++;
    }

    await inventory.findOneAndUpdate(
      { vendorId, productId: doc._id },
      {
        // `stock` is $set, not $inc: re-running the seed should restore the
        // shelf to a known quantity, not stack forty more units each time.
        $set: { stock: STOCK_PER_PRODUCT, lowStockThreshold: LOW_STOCK_THRESHOLD },
        // `reserved` is NEVER touched after insert. It belongs to live
        // checkouts; resetting it would release stock that a real order in
        // flight is holding.
        $setOnInsert: { vendorId, productId: doc._id, reserved: 0, isDemo: true },
      },
      { upsert: true },
    );
  }

  logger.log(
    `Products: ${created} created, ${updated} updated. ` +
      `${STOCK_PER_PRODUCT} units of stock each.`,
  );
  logger.log(
    'Everything written is isDemo:true — remove it with ' +
      '`seed:roles -- --wipe-demo`, or just this catalogue with ' +
      '`seed:catalogue -- --wipe`.',
  );
}

async function main(): Promise<void> {
  let ctx: INestApplicationContext | undefined;
  try {
    ctx = await NestFactory.createApplicationContext(SeedCatalogueModule, {
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
