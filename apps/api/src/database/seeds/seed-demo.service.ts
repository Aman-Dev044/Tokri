import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Role, UserStatus } from '../../common/constants/roles.enum';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '../../common/constants/order-status.enum';
import { PasswordService } from '../../common/utils/password.service';

import { User, UserDocument } from '../schemas/user.schema';
import { Vendor, VendorDocument, VendorStatus } from '../schemas/vendor.schema';
import { Category, CategoryDocument } from '../schemas/category.schema';
import { Product, ProductDocument } from '../schemas/product.schema';
import { Inventory, InventoryDocument } from '../schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../schemas/inventory-log.schema';
import { Order, OrderDocument } from '../schemas/order.schema';
import {
  DeliveryPartner,
  DeliveryPartnerDocument,
  PartnerStatus,
} from '../schemas/delivery-partner.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
  LedgerEntryType,
} from '../schemas/ledger-entry.schema';
import {
  Settlement,
  SettlementDocument,
  SettlementStatus,
} from '../schemas/settlement.schema';
import { Coupon, CouponDocument, CouponType } from '../schemas/coupon.schema';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';
import { Address, AddressDocument } from '../schemas/address.schema';
import {
  ISSUE_PRIORITY_RANK,
  Issue,
  IssueDocument,
  IssueStatus,
} from '../schemas/issue.schema';
import { point } from '../schemas/geo-point';

import {
  DEMO_CATEGORIES,
  DEMO_COUPONS,
  DEMO_CUSTOMER_NAMES,
  DEMO_LOCALITIES,
  DEMO_PRODUCTS,
  DEMO_RIDER_NAMES,
  DEMO_VEHICLES,
  DEMO_VENDORS,
} from './demo-catalogue';
import {
  DEMO_ISSUES,
  DEMO_ISSUE_REPLIES,
  OPS_FIXTURES,
  OpsFixtureSpec,
} from './demo-ops-catalogue';

// ── Tunables ────────────────────────────────────────────────────────────

const WINDOW_DAYS = 90;
const TARGET_ORDERS = 400;
const MS_PER_DAY = 86_400_000;

/** Platform pricing used by the generated orders. INTEGER PAISE. */
const DELIVERY_FEE = 2900;
const FREE_DELIVERY_THRESHOLD = 49900;
const GST_RATE = 0.05;

/**
 * Weekly seasonality. Indian grocery peaks at the weekend and troughs
 * mid-week; a flat random series produces a chart that looks like noise
 * and tells the viewer nothing about the business.
 * Index 0 = Sunday, matching `Date#getUTCDay()`.
 */
const WEEKDAY_WEIGHT = [1.35, 0.78, 0.8, 0.86, 0.95, 1.18, 1.45];

/** Gentle growth across the window, so the 90-day curve trends upward. */
const growthFactor = (dayIndex: number): number =>
  1 + (dayIndex / WINDOW_DAYS) * 0.45;

/** Statuses whose timeline has finished running. */
const TERMINAL_DEMO_STATUSES: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.REJECTED,
]);

export interface DemoSeedSummary {
  vendors: number;
  categories: number;
  products: number;
  inventory: number;
  customers: number;
  addresses: number;
  riders: number;
  orders: number;
  ledgerEntries: number;
  settlements: number;
  coupons: number;
  auditLogs: number;
  issues: number;
}

/**
 * Deterministic PRNG (mulberry32).
 *
 * `Math.random()` would make every run produce different totals, so a
 * screenshot of the dashboard could never be reproduced and a chart bug
 * could never be reliably reported. The seed is fixed; the data is
 * pseudo-random but identical on every machine.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

@Injectable()
export class SeedDemoService {
  private readonly logger = new Logger('SeedDemo');
  private readonly rng = mulberry32(20260924);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Vendor.name) private readonly vendors: Model<VendorDocument>,
    @InjectModel(Category.name)
    private readonly categories: Model<CategoryDocument>,
    @InjectModel(Product.name)
    private readonly products: Model<ProductDocument>,
    @InjectModel(Inventory.name)
    private readonly inventory: Model<InventoryDocument>,
    @InjectModel(InventoryLog.name)
    private readonly inventoryLogs: Model<InventoryLogDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(DeliveryPartner.name)
    private readonly partners: Model<DeliveryPartnerDocument>,
    @InjectModel(LedgerEntry.name)
    private readonly ledger: Model<LedgerEntryDocument>,
    @InjectModel(Settlement.name)
    private readonly settlements: Model<SettlementDocument>,
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogs: Model<AuditLogDocument>,
    @InjectModel(Address.name)
    private readonly addresses: Model<AddressDocument>,
    @InjectModel(Issue.name) private readonly issues: Model<IssueDocument>,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
  ) {}

  // ── Random helpers ────────────────────────────────────────────────────

  private int(min: number, max: number): number {
    return min + Math.floor(this.rng() * (max - min + 1));
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  private chance(probability: number): boolean {
    return this.rng() < probability;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Cheap presence check that makes a repeat run a no-op. */
  async hasDemoData(): Promise<boolean> {
    const count = await this.vendors.countDocuments({ isDemo: true }).exec();
    return count > 0;
  }

  /**
   * Deletes ONLY documents carrying `isDemo: true`.
   *
   * Never `drop()` and never an unfiltered `deleteMany({})`. This seeder
   * is routinely pointed at a shared Atlas database that also holds the
   * two real bootstrap accounts and any hand-made test data; "wipe the
   * demo data" must not mean "empty the collections".
   */
  async wipe(): Promise<Record<string, number>> {
    const filter = { isDemo: true };

    const [
      users,
      vendors,
      categories,
      products,
      inventory,
      inventoryLogs,
      orders,
      partners,
      ledger,
      settlements,
      coupons,
      auditLogs,
      addresses,
      issues,
    ] = await Promise.all([
      this.users.deleteMany(filter).exec(),
      this.vendors.deleteMany(filter).exec(),
      this.categories.deleteMany(filter).exec(),
      this.products.deleteMany(filter).exec(),
      this.inventory.deleteMany(filter).exec(),
      this.inventoryLogs.deleteMany(filter).exec(),
      this.orders.deleteMany(filter).exec(),
      this.partners.deleteMany(filter).exec(),
      this.ledger.deleteMany(filter).exec(),
      this.settlements.deleteMany(filter).exec(),
      this.coupons.deleteMany(filter).exec(),
      this.auditLogs.deleteMany(filter).exec(),
      this.addresses.deleteMany(filter).exec(),
      this.issues.deleteMany(filter).exec(),
    ]);

    return {
      users: users.deletedCount ?? 0,
      vendors: vendors.deletedCount ?? 0,
      categories: categories.deletedCount ?? 0,
      products: products.deletedCount ?? 0,
      inventory: inventory.deletedCount ?? 0,
      inventoryLogs: inventoryLogs.deletedCount ?? 0,
      orders: orders.deletedCount ?? 0,
      deliveryPartners: partners.deletedCount ?? 0,
      ledgerEntries: ledger.deletedCount ?? 0,
      settlements: settlements.deletedCount ?? 0,
      coupons: coupons.deletedCount ?? 0,
      auditLogs: auditLogs.deletedCount ?? 0,
      addresses: addresses.deletedCount ?? 0,
      issues: issues.deletedCount ?? 0,
    };
  }

  async run(): Promise<DemoSeedSummary> {
    /**
     * The shared demo password, hashed ONCE.
     *
     * Every demo account uses the same credential from SEED_DEMO_PASSWORD,
     * so hashing it sixty times would produce sixty different salts for
     * one secret and add roughly a minute to every seed run (argon2id at
     * 19 MiB is deliberately expensive). The plaintext is read here and
     * never stored on `this`, never returned and never logged.
     */
    const passwordHash = await this.passwords.hash(
      this.config.getOrThrow<string>('seed.demoPassword'),
    );

    const superAdmin = await this.users
      .findOne({ role: Role.SUPER_ADMIN })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();
    const actorId = superAdmin?._id ?? null;

    // The operations console is the ADMIN surface, so the demo issue
    // queue has to be owned by a real ADMIN account rather than by the
    // super admin. Falls back to whoever exists: a missing assignee
    // leaves tickets in the shared queue, which is a valid state, not a
    // reason to fail the seed.
    const adminUser = await this.users
      .findOne({ role: Role.ADMIN, isSystemAccount: true })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();
    const adminId = adminUser?._id ?? actorId;

    const now = new Date();
    // Everything is anchored to midnight UTC so a re-run on the same day
    // reproduces the same buckets as the aggregation pipelines use.
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );

    this.logger.log('Planting vendors and owner accounts...');
    const vendors = await this.seedVendors(passwordHash, today);

    this.logger.log('Planting categories and products...');
    const categories = await this.seedCategories();
    const products = await this.seedProducts(vendors, categories);
    const inventoryCount = await this.seedInventory(products, today);

    this.logger.log('Planting customers and delivery partners...');
    const customers = await this.seedCustomers(passwordHash, today);
    const addressCount = await this.seedAddresses(customers);
    const riders = await this.seedRiders(passwordHash, today);

    this.logger.log(`Generating ~${TARGET_ORDERS} orders over ${WINDOW_DAYS} days...`);
    const orderStats = await this.seedOrders(
      vendors,
      products,
      customers,
      riders,
      today,
    );

    this.logger.log('Planting live operations fixtures...');
    const fixtures = await this.seedOpsFixtures(
      vendors,
      products,
      customers,
      riders,
      now,
    );

    this.logger.log('Generating settlements...');
    const settlementCount = await this.seedSettlements(vendors, today);

    this.logger.log('Planting coupons and audit history...');
    const couponCount = await this.seedCoupons(vendors, today);
    const auditCount = await this.seedAuditLogs(vendors, actorId, today);

    this.logger.log('Planting the support queue...');
    const issueCount = await this.seedIssues(
      vendors,
      customers,
      riders,
      adminId,
      now,
    );

    return {
      vendors: vendors.length,
      categories: categories.length,
      products: products.length,
      inventory: inventoryCount,
      customers: customers.length,
      addresses: addressCount,
      riders: riders.length,
      orders: orderStats.orders + fixtures,
      ledgerEntries: orderStats.ledgerEntries,
      settlements: settlementCount,
      coupons: couponCount,
      auditLogs: auditCount,
      issues: issueCount,
    };
  }

  // ── Vendors ───────────────────────────────────────────────────────────

  private async seedVendors(
    passwordHash: string,
    today: Date,
  ): Promise<SeededVendor[]> {
    const seeded: SeededVendor[] = [];

    for (let index = 0; index < DEMO_VENDORS.length; index += 1) {
      const spec = DEMO_VENDORS[index];
      const vendorId = new Types.ObjectId();
      // Registered between 120 and 200 days ago, so every vendor predates
      // the 90-day order window and the "new vendors" delta is meaningful.
      const createdAt = new Date(
        today.getTime() - (120 + index * 11) * MS_PER_DAY,
      );

      const owner = await this.users.create({
        name: spec.ownerName,
        email: `${slugify(spec.ownerName)}@demo.mandi.app`,
        phone: spec.ownerPhone,
        passwordHash,
        role: Role.VENDOR,
        status:
          spec.status === VendorStatus.APPROVED
            ? UserStatus.ACTIVE
            : spec.status === VendorStatus.SUSPENDED
              ? UserStatus.SUSPENDED
              : UserStatus.PENDING,
        vendorId,
        isSystemAccount: false,
        isDemo: true,
        createdAt,
      });

      await this.vendors.create({
        _id: vendorId,
        ownerId: owner._id,
        storeName: spec.storeName,
        slug: spec.slug,
        description: spec.description,
        logoUrl: null,
        bannerUrl: null,
        address: {
          line1: spec.line1,
          line2: null,
          city: spec.city,
          state: spec.state,
          pincode: spec.pincode,
        },
        location: point(spec.lng, spec.lat),
        serviceRadiusKm: 5,
        commissionPct: spec.commissionPct,
        codEnabled: spec.codEnabled,
        codMaxAmount: 200000,
        isOpen: spec.status === VendorStatus.APPROVED,
        openingHours: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          day,
          open: '07:00',
          close: '22:00',
        })),
        status: spec.status,
        rating: spec.rating,
        statusReason:
          spec.status === VendorStatus.SUSPENDED
            ? 'FSSAI licence expired - suspended pending re-verification'
            : null,
        isDemo: true,
        createdAt,
      });

      seeded.push({
        id: vendorId,
        slug: spec.slug,
        storeName: spec.storeName,
        commissionPct: spec.commissionPct,
        status: spec.status,
        codEnabled: spec.codEnabled,
        city: spec.city,
      });
    }

    return seeded;
  }

  // ── Catalogue ─────────────────────────────────────────────────────────

  private async seedCategories(): Promise<SeededCategory[]> {
    const docs = DEMO_CATEGORIES.map((spec) => ({
      _id: new Types.ObjectId(),
      // Platform-global: one shared taxonomy rather than eight private
      // copies, so sales-by-aisle rolls up across every vendor.
      vendorId: null,
      name: spec.name,
      slug: spec.slug,
      parentId: null,
      aisleKey: spec.aisleKey,
      imageUrl: null,
      sortOrder: spec.sortOrder,
      isActive: true,
      isDemo: true,
    }));

    await this.categories.insertMany(docs);

    return docs.map((doc) => ({
      id: doc._id,
      aisleKey: doc.aisleKey,
      name: doc.name,
    }));
  }

  private async seedProducts(
    vendors: SeededVendor[],
    categories: SeededCategory[],
  ): Promise<SeededProduct[]> {
    const categoryByAisle = new Map(
      categories.map((category) => [category.aisleKey, category.id]),
    );

    const docs = DEMO_PRODUCTS.map((spec, index) => {
      // Round-robin so every vendor carries ten products spread across
      // several aisles, rather than one vendor owning a whole aisle.
      const vendor = vendors[index % vendors.length];
      const categoryId = categoryByAisle.get(spec.aisleKey);
      if (!categoryId) {
        throw new Error(`No demo category for aisle ${spec.aisleKey}`);
      }

      const discountPct =
        spec.mrp > 0
          ? Math.round(((spec.mrp - spec.price) / spec.mrp) * 100)
          : 0;

      return {
        _id: new Types.ObjectId(),
        vendorId: vendor.id,
        categoryId,
        name: spec.name,
        slug: `${slugify(spec.name)}-${vendor.slug}`,
        description: `${spec.name}${spec.brand ? ` by ${spec.brand}` : ''}, ${spec.unitValue}${spec.unit}.`,
        images: [],
        brand: spec.brand,
        unit: spec.unit,
        unitValue: spec.unitValue,
        sku: `MND-${index + 1001}`,
        mrp: spec.mrp,
        price: spec.price,
        discountPct,
        isActive: true,
        searchText:
          `${spec.name} ${spec.brand ?? ''} ${spec.aisleKey}`.toLowerCase(),
        isDemo: true,
      };
    });

    await this.products.insertMany(docs);

    return docs.map((doc) => ({
      id: doc._id,
      vendorId: doc.vendorId,
      name: doc.name,
      unit: `${doc.unitValue}${doc.unit}`,
      price: doc.price,
    }));
  }

  private async seedInventory(
    products: SeededProduct[],
    today: Date,
  ): Promise<number> {
    const rows = [];
    const logs = [];

    for (const product of products) {
      const threshold = this.pick([8, 10, 12, 15]);
      // Roughly one product in eight sits at or under its threshold, so
      // the low-stock panel on the dashboard is never empty.
      const low = this.chance(0.12);
      const stock = low ? this.int(0, threshold) : this.int(threshold + 5, 140);

      rows.push({
        vendorId: product.vendorId,
        productId: product.id,
        stock,
        reserved: this.chance(0.15) ? this.int(1, 4) : 0,
        lowStockThreshold: threshold,
        isDemo: true,
      });

      logs.push({
        vendorId: product.vendorId,
        productId: product.id,
        delta: stock,
        reason: InventoryReason.RESTOCK,
        refId: null,
        byUserId: null,
        at: new Date(today.getTime() - this.int(1, 20) * MS_PER_DAY),
        isDemo: true,
      });
    }

    await this.inventory.insertMany(rows);
    await this.inventoryLogs.insertMany(logs);
    return rows.length;
  }

  // ── People ────────────────────────────────────────────────────────────

  private async seedCustomers(
    passwordHash: string,
    today: Date,
  ): Promise<SeededCustomer[]> {
    const docs = DEMO_CUSTOMER_NAMES.map((name, index) => ({
      _id: new Types.ObjectId(),
      name,
      email: `${slugify(name)}@demo.mandi.app`,
      phone: `9820${String(200000 + index).padStart(6, '0')}`,
      passwordHash,
      role: Role.CUSTOMER,
      // A couple of suspended customers, so the filter has something to
      // find and the status column is not a single repeated value.
      status: index % 19 === 0 ? UserStatus.SUSPENDED : UserStatus.ACTIVE,
      vendorId: null,
      isSystemAccount: false,
      isDemo: true,
      // Signed up between 100 and 10 days ago, spread evenly so the
      // customer-growth delta is a real number.
      createdAt: new Date(
        today.getTime() - (100 - Math.floor(index * 2.2)) * MS_PER_DAY,
      ),
      lastLoginAt: new Date(today.getTime() - this.int(0, 14) * MS_PER_DAY),
    }));

    await this.users.insertMany(docs);

    return docs.map((doc) => ({ id: doc._id, name: doc.name, phone: doc.phone }));
  }

  private async seedAddresses(customers: SeededCustomer[]): Promise<number> {
    const rows = [];

    for (const customer of customers) {
      const count = this.chance(0.35) ? 2 : 1;
      for (let index = 0; index < count; index += 1) {
        const locality = this.pick(DEMO_LOCALITIES);
        rows.push({
          customerId: customer.id,
          label: index === 0 ? 'Home' : 'Work',
          line1: locality.line1,
          line2: null,
          city: locality.city,
          pincode: locality.pincode,
          // Jittered by up to ~1km so the map is a cluster, not a pin.
          location: point(
            locality.lng + (this.rng() - 0.5) * 0.02,
            locality.lat + (this.rng() - 0.5) * 0.02,
          ),
          isDefault: index === 0,
          phone: customer.phone,
          isDemo: true,
        });
      }
    }

    await this.addresses.insertMany(rows);
    return rows.length;
  }

  private async seedRiders(
    passwordHash: string,
    today: Date,
  ): Promise<SeededRider[]> {
    const riders: SeededRider[] = [];

    for (let index = 0; index < DEMO_RIDER_NAMES.length; index += 1) {
      const name = DEMO_RIDER_NAMES[index];
      const userId = new Types.ObjectId();
      const partnerId = new Types.ObjectId();
      const createdAt = new Date(
        today.getTime() - (80 - index * 4) * MS_PER_DAY,
      );

      // Platform pool for most; a few belong to a specific vendor, which
      // is the split the assignment algorithm will have to handle.
      const online = index % 5 !== 0 && index < 9;
      const locality = DEMO_LOCALITIES[index % DEMO_LOCALITIES.length];

      riders.push({ id: partnerId, userId, name });

      await this.users.create({
        _id: userId,
        name,
        email: `${slugify(name)}@demo.mandi.app`,
        phone: `9830${String(300000 + index).padStart(6, '0')}`,
        passwordHash,
        role: Role.DELIVERY,
        status: UserStatus.ACTIVE,
        vendorId: null,
        isSystemAccount: false,
        isDemo: true,
        createdAt,
      });

      await this.partners.create({
        _id: partnerId,
        userId,
        vendorId: null,
        vehicleType: DEMO_VEHICLES[index % DEMO_VEHICLES.length],
        isOnline: online,
        isAvailable: online && this.chance(0.7),
        currentLocation: point(
          locality.lng + (this.rng() - 0.5) * 0.03,
          locality.lat + (this.rng() - 0.5) * 0.03,
        ),
        locationAt: online
          ? new Date(Date.now() - this.int(5, 600) * 1000)
          : new Date(today.getTime() - this.int(1, 5) * MS_PER_DAY),
        activeOrderId: null,
        completedCount: this.int(40, 520),
        rating: Math.round((3.8 + this.rng() * 1.2) * 10) / 10,
        status: PartnerStatus.ACTIVE,
        isDemo: true,
        createdAt,
      });
    }

    return riders;
  }

  // ── Orders ────────────────────────────────────────────────────────────

  /**
   * ~400 orders across 90 days with real weekly seasonality.
   *
   * ── The pricing arithmetic, all INTEGER PAISE ────────────────────────
   *   itemsSubtotal    sum of price x qty
   *   discount         a coupon-sized reduction on some orders
   *   deliveryFee      0 above the free-delivery threshold, else flat
   *   taxes            5% GST on the subtotal
   *   grandTotal       itemsSubtotal - discount + deliveryFee + taxes
   *   commissionPct    SNAPSHOT of the vendor's rate at this moment
   *   commissionAmount round(itemsSubtotal x commissionPct / 100)
   *   vendorPayout     itemsSubtotal - commissionAmount
   *
   * The delivery fee is absent from the payout on purpose: it is platform
   * revenue, not the vendor's (locked decision #5).
   *
   * `statusHistory` timestamps genuinely progress — each step is minutes
   * after the one before it — so the tracking timeline and the "time to
   * deliver" report have something real to read.
   */
  private async seedOrders(
    vendors: SeededVendor[],
    products: SeededProduct[],
    customers: SeededCustomer[],
    riders: SeededRider[],
    today: Date,
  ): Promise<{ orders: number; ledgerEntries: number }> {
    // Pending vendors have never traded; the suspended one traded until
    // it was suspended. That is what makes the vendor table believable.
    const trading = vendors.filter(
      (vendor) => vendor.status !== VendorStatus.PENDING,
    );

    const catalogue = new Map<string, SeededProduct[]>();
    for (const product of products) {
      const key = product.vendorId.toString();
      const list = catalogue.get(key) ?? [];
      list.push(product);
      catalogue.set(key, list);
    }

    const weights: number[] = [];
    for (let day = 0; day < WINDOW_DAYS; day += 1) {
      const date = new Date(today.getTime() - (WINDOW_DAYS - 1 - day) * MS_PER_DAY);
      weights.push(WEEKDAY_WEIGHT[date.getUTCDay()] * growthFactor(day));
    }
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

    const orderDocs: Record<string, unknown>[] = [];
    const ledgerDocs: Record<string, unknown>[] = [];
    const perDaySequence = new Map<string, number>();
    const nowMs = Date.now();

    for (let day = 0; day < WINDOW_DAYS; day += 1) {
      const daysAgo = WINDOW_DAYS - 1 - day;
      const dayStart = new Date(today.getTime() - daysAgo * MS_PER_DAY);
      const count = Math.max(
        1,
        Math.round((TARGET_ORDERS * weights[day]) / weightSum),
      );

      for (let n = 0; n < count; n += 1) {
        const vendor = this.pickTradingVendor(trading, daysAgo);
        const vendorProducts = catalogue.get(vendor.id.toString()) ?? [];
        if (vendorProducts.length === 0) continue;

        const customer = this.pick(customers);
        const locality = this.pick(DEMO_LOCALITIES);

        // Orders cluster around the morning and evening peaks.
        const hour = this.chance(0.45)
          ? this.int(8, 11)
          : this.chance(0.7)
            ? this.int(17, 21)
            : this.int(12, 16);
        const slot =
          dayStart.getTime() +
          hour * 3_600_000 +
          this.int(0, 59) * 60_000 +
          this.int(0, 59) * 1000;

        const status = this.statusFor(daysAgo);

        /**
         * CLAMP TO THE PAST, with enough headroom for the timeline.
         *
         * Today's slots run to 21:00 UTC, so a run at noon would
         * otherwise write orders dated eight hours from now — and every
         * analytics window ends at `now`, so those orders would silently
         * vanish from the dashboard they were generated for. Worse, the
         * ones that vanish are the live ones, which is precisely the set
         * the operations board exists to show.
         *
         * The lead also has to cover the status timeline: a DELIVERED
         * order placed three minutes ago would have a deliveredAt in the
         * future, which reads as a completed delivery that has not
         * happened yet.
         */
        const leadMinutes = TERMINAL_DEMO_STATUSES.has(status)
          ? this.int(95, 300)
          : this.int(4, 45);
        const placedAt = new Date(
          Math.min(slot, nowMs - leadMinutes * 60_000),
        );

        const items = this.buildItems(vendorProducts);
        const itemsSubtotal = items.reduce(
          (sum, item) => sum + item.lineTotal,
          0,
        );

        const discount = this.discountFor(itemsSubtotal);
        const deliveryFee =
          itemsSubtotal - discount >= FREE_DELIVERY_THRESHOLD
            ? 0
            : DELIVERY_FEE;
        const taxes = Math.round(itemsSubtotal * GST_RATE);
        const grandTotal = itemsSubtotal - discount + deliveryFee + taxes;
        const commissionAmount = Math.round(
          (itemsSubtotal * vendor.commissionPct) / 100,
        );
        const vendorPayout = itemsSubtotal - commissionAmount;

        const method =
          vendor.codEnabled && this.chance(0.45)
            ? PaymentMethod.COD
            : PaymentMethod.ONLINE;

        const dayKey = placedAt.toISOString().slice(0, 10).replace(/-/g, '');
        const sequence = (perDaySequence.get(dayKey) ?? 0) + 1;
        perDaySequence.set(dayKey, sequence);

        const timeline = this.buildTimeline(placedAt, status);
        const rider =
          timeline.assignedAt && riders.length > 0
            ? this.pick(riders)
            : null;

        const orderId = new Types.ObjectId();
        const payment = this.paymentFor(
          method,
          status,
          placedAt,
          timeline.deliveredAt,
          grandTotal,
        );

        // One delivered order in twenty is partially fulfilled — the
        // vendor dropped a line and it was auto-refunded (decision #9).
        // This is what puts non-zero `refunds` on a settlement.
        let partialRefund = 0;
        if (status === OrderStatus.DELIVERED && items.length > 2 && this.chance(0.05)) {
          const dropped = items[items.length - 1];
          dropped.fulfilled = false;
          partialRefund = dropped.lineTotal;
          payment.status = PaymentStatus.PARTIALLY_REFUNDED;
          payment.refundedAmount = partialRefund;
        }

        orderDocs.push({
          _id: orderId,
          orderNo: `MND-${dayKey}-${String(sequence).padStart(4, '0')}`,
          customerId: customer.id,
          vendorId: vendor.id,
          deliveryPartnerId: rider ? rider.id : null,
          items,
          pricing: {
            itemsSubtotal,
            discount,
            deliveryFee,
            taxes,
            grandTotal,
            commissionPct: vendor.commissionPct,
            commissionAmount,
            vendorPayout,
          },
          address: {
            label: 'Home',
            line1: locality.line1,
            line2: null,
            city: locality.city,
            pincode: locality.pincode,
            location: point(
              locality.lng + (this.rng() - 0.5) * 0.02,
              locality.lat + (this.rng() - 0.5) * 0.02,
            ),
            phone: customer.phone,
          },
          payment,
          status,
          statusHistory: timeline.history,
          // Only live orders carry an OTP. A delivered order's OTP has
          // been spent, and storing spent proof material forever is a
          // liability with no operational use.
          deliveryOtpHash: null,
          proof: {
            otpVerifiedAt: timeline.deliveredAt,
            photoUrl: null,
          },
          cancellation:
            status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED
              ? {
                  by: status === OrderStatus.REJECTED ? Role.VENDOR : Role.CUSTOMER,
                  byUserId: null,
                  reason:
                    status === OrderStatus.REJECTED
                      ? this.pick([
                          'Items out of stock',
                          'Store closing early today',
                          'Unable to fulfil within the promised window',
                        ])
                      : this.pick([
                          'Ordered by mistake',
                          'Found a better price elsewhere',
                          'Delivery window too late',
                        ]),
                  at: timeline.terminalAt,
                }
              : {},
          placedAt,
          acceptedAt: timeline.acceptedAt,
          readyAt: timeline.readyAt,
          pickedUpAt: timeline.pickedUpAt,
          deliveredAt: timeline.deliveredAt,
          isDemo: true,
          createdAt: placedAt,
          updatedAt: timeline.terminalAt ?? placedAt,
        });

        // ── Ledger ────────────────────────────────────────────────────
        if (status === OrderStatus.DELIVERED && timeline.deliveredAt) {
          ledgerDocs.push({
            vendorId: vendor.id,
            orderId,
            type: LedgerEntryType.SALE,
            amount: itemsSubtotal,
            note: `Sale MND-${dayKey}-${String(sequence).padStart(4, '0')}`,
            settlementId: null,
            at: timeline.deliveredAt,
            isDemo: true,
          });
          ledgerDocs.push({
            vendorId: vendor.id,
            orderId,
            type: LedgerEntryType.COMMISSION,
            amount: -commissionAmount,
            note: `Commission at ${vendor.commissionPct}%`,
            settlementId: null,
            at: timeline.deliveredAt,
            isDemo: true,
          });

          if (partialRefund > 0) {
            ledgerDocs.push({
              vendorId: vendor.id,
              orderId,
              type: LedgerEntryType.REFUND,
              amount: -partialRefund,
              note: 'Auto-refund for an unfulfilled line',
              settlementId: null,
              at: timeline.deliveredAt,
              isDemo: true,
            });
          }
        }

        // A cancelled PREPAID order refunds the customer. The row is
        // recorded against the vendor for traceability, but no settlement
        // ever picks it up: settlements sweep DELIVERED orders only, so
        // the vendor is not debited for money they were never credited.
        if (
          (status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED) &&
          payment.status === PaymentStatus.REFUNDED
        ) {
          ledgerDocs.push({
            vendorId: vendor.id,
            orderId,
            type: LedgerEntryType.REFUND,
            amount: -grandTotal,
            note: 'Refund for a cancelled prepaid order',
            settlementId: null,
            at: timeline.terminalAt ?? placedAt,
            isDemo: true,
          });
        }
      }
    }

    // Live orders get a real, hashed OTP. Only a handful, so the argon2
    // cost is bounded — see the note on the shared password hash.
    for (const doc of orderDocs) {
      const status = doc.status as OrderStatus;
      if (
        status === OrderStatus.OUT_FOR_DELIVERY ||
        status === OrderStatus.PICKED_UP ||
        status === OrderStatus.ASSIGNED
      ) {
        doc.deliveryOtpHash = await this.passwords.hash(
          String(this.int(1000, 9999)),
        );
      }
    }

    await this.orders.insertMany(orderDocs);
    await this.ledger.insertMany(ledgerDocs);

    return { orders: orderDocs.length, ledgerEntries: ledgerDocs.length };
  }

  /** The suspended store stops taking orders three weeks ago. */
  private pickTradingVendor(
    trading: SeededVendor[],
    daysAgo: number,
  ): SeededVendor {
    const eligible =
      daysAgo > 21
        ? trading
        : trading.filter((vendor) => vendor.status === VendorStatus.APPROVED);
    return this.pick(eligible.length > 0 ? eligible : trading);
  }

  private buildItems(vendorProducts: SeededProduct[]): OrderItemDoc[] {
    const wanted = Math.min(this.int(2, 6), vendorProducts.length);
    const chosen = new Set<number>();
    while (chosen.size < wanted) {
      chosen.add(Math.floor(this.rng() * vendorProducts.length));
    }

    return [...chosen].map((index) => {
      const product = vendorProducts[index];
      const qty = this.chance(0.7) ? this.int(1, 2) : this.int(2, 4);
      return {
        productId: product.id,
        name: product.name,
        image: null,
        unit: product.unit,
        price: product.price,
        qty,
        lineTotal: product.price * qty,
        fulfilled: true,
      };
    });
  }

  private discountFor(itemsSubtotal: number): number {
    if (itemsSubtotal >= FREE_DELIVERY_THRESHOLD && this.chance(0.28)) {
      return 10000;
    }
    if (itemsSubtotal >= 19900 && this.chance(0.14)) return 5000;
    return 0;
  }

  /**
   * Status mix: mostly DELIVERED, roughly 8% cancelled or rejected, and
   * a live tail in the last 48 hours so the operations board is not a
   * screen of completed history.
   */
  private statusFor(daysAgo: number): OrderStatus {
    if (daysAgo <= 1 && this.chance(0.5)) {
      return this.pick([
        OrderStatus.PLACED,
        OrderStatus.ACCEPTED,
        OrderStatus.PACKING,
        OrderStatus.READY_FOR_PICKUP,
        OrderStatus.ASSIGNED,
        OrderStatus.PICKED_UP,
        OrderStatus.OUT_FOR_DELIVERY,
      ]);
    }
    if (this.chance(0.08)) {
      return this.chance(0.6) ? OrderStatus.CANCELLED : OrderStatus.REJECTED;
    }
    return OrderStatus.DELIVERED;
  }

  private buildTimeline(placedAt: Date, target: OrderStatus): Timeline {
    const history: StatusChangeDoc[] = [
      { from: null, to: OrderStatus.PLACED, byUserId: null, byRole: Role.CUSTOMER, reason: null, at: placedAt },
    ];

    const timeline: Timeline = {
      history,
      acceptedAt: null,
      readyAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      assignedAt: null,
      terminalAt: null,
    };

    let cursor = placedAt;
    const advance = (minutes: number): Date => {
      cursor = new Date(cursor.getTime() + minutes * 60_000);
      return cursor;
    };

    if (target === OrderStatus.PLACED) return timeline;

    if (target === OrderStatus.REJECTED) {
      const at = advance(this.int(2, 9));
      history.push({ from: OrderStatus.PLACED, to: OrderStatus.REJECTED, byUserId: null, byRole: Role.VENDOR, reason: 'Items out of stock', at });
      timeline.terminalAt = at;
      return timeline;
    }

    if (target === OrderStatus.CANCELLED) {
      // Half are cancelled before the vendor ever accepts (free), half
      // after — which is the case that needs approval and a refund.
      if (this.chance(0.5)) {
        const at = advance(this.int(1, 6));
        history.push({ from: OrderStatus.PLACED, to: OrderStatus.CANCELLED, byUserId: null, byRole: Role.CUSTOMER, reason: 'Ordered by mistake', at });
        timeline.terminalAt = at;
        return timeline;
      }
      const acceptedAt = advance(this.int(2, 6));
      history.push({ from: OrderStatus.PLACED, to: OrderStatus.ACCEPTED, byUserId: null, byRole: Role.VENDOR, reason: null, at: acceptedAt });
      timeline.acceptedAt = acceptedAt;
      const at = advance(this.int(3, 15));
      history.push({ from: OrderStatus.ACCEPTED, to: OrderStatus.CANCELLED, byUserId: null, byRole: Role.ADMIN, reason: 'Cancelled on customer request after acceptance', at });
      timeline.terminalAt = at;
      return timeline;
    }

    const acceptedAt = advance(this.int(2, 6));
    history.push({ from: OrderStatus.PLACED, to: OrderStatus.ACCEPTED, byUserId: null, byRole: Role.VENDOR, reason: null, at: acceptedAt });
    timeline.acceptedAt = acceptedAt;
    timeline.terminalAt = acceptedAt;
    if (target === OrderStatus.ACCEPTED) return timeline;

    const packingAt = advance(this.int(1, 4));
    history.push({ from: OrderStatus.ACCEPTED, to: OrderStatus.PACKING, byUserId: null, byRole: Role.VENDOR, reason: null, at: packingAt });
    timeline.terminalAt = packingAt;
    if (target === OrderStatus.PACKING) return timeline;

    const readyAt = advance(this.int(4, 12));
    history.push({ from: OrderStatus.PACKING, to: OrderStatus.READY_FOR_PICKUP, byUserId: null, byRole: Role.VENDOR, reason: null, at: readyAt });
    timeline.readyAt = readyAt;
    timeline.terminalAt = readyAt;
    if (target === OrderStatus.READY_FOR_PICKUP) return timeline;

    const assignedAt = advance(this.int(1, 5));
    history.push({ from: OrderStatus.READY_FOR_PICKUP, to: OrderStatus.ASSIGNED, byUserId: null, byRole: Role.ADMIN, reason: null, at: assignedAt });
    timeline.assignedAt = assignedAt;
    timeline.terminalAt = assignedAt;
    if (target === OrderStatus.ASSIGNED) return timeline;

    const pickedUpAt = advance(this.int(2, 7));
    history.push({ from: OrderStatus.ASSIGNED, to: OrderStatus.PICKED_UP, byUserId: null, byRole: Role.DELIVERY, reason: null, at: pickedUpAt });
    timeline.pickedUpAt = pickedUpAt;
    timeline.terminalAt = pickedUpAt;
    if (target === OrderStatus.PICKED_UP) return timeline;

    const outAt = advance(this.int(1, 3));
    history.push({ from: OrderStatus.PICKED_UP, to: OrderStatus.OUT_FOR_DELIVERY, byUserId: null, byRole: Role.DELIVERY, reason: null, at: outAt });
    timeline.terminalAt = outAt;
    if (target === OrderStatus.OUT_FOR_DELIVERY) return timeline;

    const deliveredAt = advance(this.int(6, 22));
    history.push({ from: OrderStatus.OUT_FOR_DELIVERY, to: OrderStatus.DELIVERED, byUserId: null, byRole: Role.DELIVERY, reason: null, at: deliveredAt });
    timeline.deliveredAt = deliveredAt;
    timeline.terminalAt = deliveredAt;
    return timeline;
  }

  private paymentFor(
    method: PaymentMethod,
    status: OrderStatus,
    placedAt: Date,
    deliveredAt: Date | null,
    grandTotal: number,
  ): PaymentDoc {
    const prepaid = method === PaymentMethod.ONLINE;

    if (status === OrderStatus.DELIVERED) {
      return {
        method,
        status: PaymentStatus.PAID,
        provider: prepaid ? 'razorpay' : null,
        providerOrderId: prepaid ? `order_demo${this.int(100000, 999999)}` : null,
        providerPaymentId: prepaid ? `pay_demo${this.int(100000, 999999)}` : null,
        paidAt: prepaid ? placedAt : deliveredAt,
        refundedAmount: 0,
      };
    }

    if (status === OrderStatus.CANCELLED || status === OrderStatus.REJECTED) {
      return prepaid
        ? {
            method,
            status: PaymentStatus.REFUNDED,
            provider: 'razorpay',
            providerOrderId: `order_demo${this.int(100000, 999999)}`,
            providerPaymentId: `pay_demo${this.int(100000, 999999)}`,
            paidAt: placedAt,
            refundedAmount: grandTotal,
          }
        : {
            method,
            status: PaymentStatus.PENDING,
            provider: null,
            providerOrderId: null,
            providerPaymentId: null,
            paidAt: null,
            refundedAmount: 0,
          };
    }

    // Still in flight: prepaid is already captured, COD is not.
    return prepaid
      ? {
          method,
          status: PaymentStatus.PAID,
          provider: 'razorpay',
          providerOrderId: `order_demo${this.int(100000, 999999)}`,
          providerPaymentId: `pay_demo${this.int(100000, 999999)}`,
          paidAt: placedAt,
          refundedAmount: 0,
        }
      : {
          method,
          status: PaymentStatus.PENDING,
          provider: null,
          providerOrderId: null,
          providerPaymentId: null,
          paidAt: null,
          refundedAmount: 0,
        };
  }

  // OPS ── Live operations fixtures ─────────────────────────────────────

  /**
   * A deterministic tail of LIVE orders for the ADMIN operations console.
   *
   * The 90-day generator above is random by design, so on any given run
   * it may produce no unassigned order, nothing stuck and no SLA breach.
   * A demo of a work queue with no work in it demonstrates nothing, so
   * these eleven are planted with exact ages, measured against the
   * thresholds in `modules/admin/ops/sla.util.ts`.
   *
   * They are ordinary demo orders in every other respect: `isDemo: true`,
   * the same pricing arithmetic, a timeline that reads forwards.
   */
  private async seedOpsFixtures(
    vendors: SeededVendor[],
    products: SeededProduct[],
    customers: SeededCustomer[],
    riders: SeededRider[],
    now: Date,
  ): Promise<number> {
    const approved = vendors.filter(
      (vendor) => vendor.status === VendorStatus.APPROVED,
    );
    if (approved.length === 0 || customers.length === 0) return 0;

    const catalogue = new Map<string, SeededProduct[]>();
    for (const product of products) {
      const key = product.vendorId.toString();
      const list = catalogue.get(key) ?? [];
      list.push(product);
      catalogue.set(key, list);
    }

    const docs: Record<string, unknown>[] = [];
    const held: { riderId: Types.ObjectId; orderId: Types.ObjectId }[] = [];
    const perDaySequence = new Map<string, number>();

    for (let index = 0; index < OPS_FIXTURES.length; index += 1) {
      const spec: OpsFixtureSpec = OPS_FIXTURES[index];
      const vendor = approved[index % approved.length];
      const vendorProducts = catalogue.get(vendor.id.toString()) ?? [];
      if (vendorProducts.length === 0) continue;

      const customer = customers[(index * 7) % customers.length];
      const locality = DEMO_LOCALITIES[index % DEMO_LOCALITIES.length];

      const placedAt = new Date(now.getTime() - spec.placedMinutesAgo * 60_000);
      const lastChangeAt = new Date(
        now.getTime() - spec.inStatusMinutes * 60_000,
      );

      const items = this.buildItems(vendorProducts);
      const itemsSubtotal = items.reduce(
        (sum, item) => sum + item.lineTotal,
        0,
      );
      const discount = this.discountFor(itemsSubtotal);
      const deliveryFee =
        itemsSubtotal - discount >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
      const taxes = Math.round(itemsSubtotal * GST_RATE);
      const grandTotal = itemsSubtotal - discount + deliveryFee + taxes;
      const commissionAmount = Math.round(
        (itemsSubtotal * vendor.commissionPct) / 100,
      );

      const method =
        vendor.codEnabled && index % 3 === 0
          ? PaymentMethod.COD
          : PaymentMethod.ONLINE;

      // A high sequence block, so a fixture can never collide with an
      // order number the random generator already issued for the day.
      const dayKey = placedAt.toISOString().slice(0, 10).replace(/-/g, '');
      const sequence = (perDaySequence.get(dayKey) ?? 9000) + 1;
      perDaySequence.set(dayKey, sequence);

      const timeline = this.buildFixtureTimeline(
        placedAt,
        lastChangeAt,
        spec.status,
      );

      const rider =
        spec.withRider && riders.length > 0
          ? riders[index % riders.length]
          : null;

      const orderId = new Types.ObjectId();
      if (rider) held.push({ riderId: rider.id, orderId });

      docs.push({
        _id: orderId,
        orderNo: `MND-${dayKey}-${String(sequence).padStart(4, '0')}`,
        customerId: customer.id,
        vendorId: vendor.id,
        deliveryPartnerId: rider ? rider.id : null,
        items,
        pricing: {
          itemsSubtotal,
          discount,
          deliveryFee,
          taxes,
          grandTotal,
          commissionPct: vendor.commissionPct,
          commissionAmount,
          vendorPayout: itemsSubtotal - commissionAmount,
        },
        address: {
          label: 'Home',
          line1: locality.line1,
          line2: null,
          city: locality.city,
          pincode: locality.pincode,
          location: point(
            locality.lng + (this.rng() - 0.5) * 0.02,
            locality.lat + (this.rng() - 0.5) * 0.02,
          ),
          phone: customer.phone,
        },
        payment: this.paymentFor(
          method,
          spec.status,
          placedAt,
          null,
          grandTotal,
        ),
        status: spec.status,
        statusHistory: timeline.history,
        deliveryOtpHash: null,
        proof: { otpVerifiedAt: null, photoUrl: null },
        cancellation: {},
        placedAt,
        acceptedAt: timeline.acceptedAt,
        readyAt: timeline.readyAt,
        pickedUpAt: timeline.pickedUpAt,
        deliveredAt: null,
        isDemo: true,
        createdAt: placedAt,
        updatedAt: lastChangeAt,
      });
    }

    // A live order carries an unspent OTP. Only a handful, so the argon2
    // cost stays bounded - see the note on the shared password hash.
    for (const doc of docs) {
      const status = doc.status as OrderStatus;
      if (
        status === OrderStatus.ASSIGNED ||
        status === OrderStatus.PICKED_UP ||
        status === OrderStatus.OUT_FOR_DELIVERY
      ) {
        doc.deliveryOtpHash = await this.passwords.hash(
          String(this.int(1000, 9999)),
        );
      }
    }

    await this.orders.insertMany(docs);

    // The riders carrying a fixture are online and HELD, so the dispatch
    // monitor shows a real job against them and POST /dispatch/assign has
    // a genuinely busy rider to reject with a 409.
    for (const assignment of held) {
      await this.partners
        .updateOne(
          { _id: assignment.riderId },
          {
            $set: {
              isOnline: true,
              isAvailable: false,
              activeOrderId: assignment.orderId,
              locationAt: new Date(now.getTime() - this.int(10, 240) * 1000),
            },
          },
        )
        .exec();
    }

    return docs.length;
  }

  /**
   * A timeline whose milestones are spread evenly between `placedAt` and
   * `lastChangeAt`.
   *
   * The random `buildTimeline` above advances by a few minutes per step,
   * which cannot hit an exact "22 minutes in READY_FOR_PICKUP" target
   * and would run past `now` on a young order. This one interpolates, so
   * both ends are exactly what the fixture asked for.
   */
  private buildFixtureTimeline(
    placedAt: Date,
    lastChangeAt: Date,
    target: OrderStatus,
  ): Timeline {
    const chain: OrderStatus[] = [
      OrderStatus.PLACED,
      OrderStatus.ACCEPTED,
      OrderStatus.PACKING,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.ASSIGNED,
      OrderStatus.PICKED_UP,
      OrderStatus.OUT_FOR_DELIVERY,
    ];
    const actor: Partial<Record<OrderStatus, Role>> = {
      [OrderStatus.ACCEPTED]: Role.VENDOR,
      [OrderStatus.PACKING]: Role.VENDOR,
      [OrderStatus.READY_FOR_PICKUP]: Role.VENDOR,
      [OrderStatus.ASSIGNED]: Role.ADMIN,
      [OrderStatus.PICKED_UP]: Role.DELIVERY,
      [OrderStatus.OUT_FOR_DELIVERY]: Role.DELIVERY,
    };

    const steps = Math.max(0, chain.indexOf(target));
    const span = lastChangeAt.getTime() - placedAt.getTime();

    const history: StatusChangeDoc[] = [
      {
        from: null,
        to: OrderStatus.PLACED,
        byUserId: null,
        byRole: Role.CUSTOMER,
        reason: null,
        at: placedAt,
      },
    ];

    const timeline: Timeline = {
      history,
      acceptedAt: null,
      readyAt: null,
      pickedUpAt: null,
      deliveredAt: null,
      assignedAt: null,
      terminalAt: placedAt,
    };

    for (let step = 1; step <= steps; step += 1) {
      const to = chain[step];
      const at = new Date(
        placedAt.getTime() + Math.round((span * step) / Math.max(1, steps)),
      );

      history.push({
        from: chain[step - 1],
        to,
        byUserId: null,
        byRole: actor[to] ?? Role.ADMIN,
        reason: null,
        at,
      });

      if (to === OrderStatus.ACCEPTED) timeline.acceptedAt = at;
      if (to === OrderStatus.READY_FOR_PICKUP) timeline.readyAt = at;
      if (to === OrderStatus.ASSIGNED) timeline.assignedAt = at;
      if (to === OrderStatus.PICKED_UP) timeline.pickedUpAt = at;
      timeline.terminalAt = at;
    }

    return timeline;
  }

  // OPS ── Support queue ────────────────────────────────────────────────

  /**
   * 35 issues across every type, priority and status.
   *
   * Codes are `ISS-YYYYMMDD-NNNN`, allocated per day exactly as
   * `AdminOpsIssuesService` allocates them, so the unique index is
   * exercised by the seed rather than first met in production.
   */
  private async seedIssues(
    vendors: SeededVendor[],
    customers: SeededCustomer[],
    riders: SeededRider[],
    adminId: Types.ObjectId | null,
    now: Date,
  ): Promise<number> {
    // Real orders to hang the order-linked tickets off, newest first, so
    // the detail view populates instead of showing a dangling id.
    const recent = await this.orders
      .find({ isDemo: true })
      .select('_id customerId vendorId')
      .sort({ placedAt: -1 })
      .limit(80)
      .lean<
        {
          _id: Types.ObjectId;
          customerId: Types.ObjectId;
          vendorId: Types.ObjectId;
        }[]
      >()
      .exec();

    const perDaySequence = new Map<string, number>();
    const docs: Record<string, unknown>[] = [];

    for (let index = 0; index < DEMO_ISSUES.length; index += 1) {
      const spec = DEMO_ISSUES[index];

      const createdAt = new Date(
        now.getTime() - spec.daysAgo * MS_PER_DAY - this.int(5, 600) * 60_000,
      );

      const dayKey = createdAt.toISOString().slice(0, 10).replace(/-/g, '');
      const sequence = (perDaySequence.get(dayKey) ?? 0) + 1;
      perDaySequence.set(dayKey, sequence);

      const order =
        spec.link === 'order' && recent.length > 0
          ? recent[index % recent.length]
          : null;
      const vendor = vendors[index % vendors.length];
      const rider = riders.length > 0 ? riders[index % riders.length] : null;

      const resolved =
        spec.status === IssueStatus.RESOLVED ||
        spec.status === IssueStatus.CLOSED;

      const messages: {
        byUserId: Types.ObjectId | null;
        byRole: Role;
        body: string;
        at: Date;
      }[] = [];
      for (let reply = 0; reply < spec.thread; reply += 1) {
        messages.push({
          byUserId: adminId,
          byRole: Role.ADMIN,
          body: DEMO_ISSUE_REPLIES[
            (index + reply) % DEMO_ISSUE_REPLIES.length
          ],
          at: new Date(createdAt.getTime() + (reply + 1) * 47 * 60_000),
        });
      }

      docs.push({
        code: `ISS-${dayKey}-${String(sequence).padStart(4, '0')}`,
        orderId: order ? order._id : null,
        customerId: order
          ? order.customerId
          : customers.length > 0
            ? customers[index % customers.length].id
            : null,
        vendorId:
          order?.vendorId ?? (spec.link === 'vendor' ? vendor.id : null),
        riderId: spec.link === 'rider' && rider ? rider.id : null,
        type: spec.type,
        priority: spec.priority,
        priorityRank: ISSUE_PRIORITY_RANK[spec.priority],
        status: spec.status,
        subject: spec.subject,
        description: spec.description,
        assignedToUserId: spec.assigned ? adminId : null,
        resolution: spec.resolution,
        resolvedAt: resolved
          ? new Date(createdAt.getTime() + this.int(2, 36) * 3_600_000)
          : null,
        resolvedBy: resolved ? adminId : null,
        messages,
        isDemo: true,
        createdAt,
        updatedAt: createdAt,
      });
    }

    await this.issues.insertMany(docs);
    return docs.length;
  }

  // ── Settlements ───────────────────────────────────────────────────────

  /**
   * Weekly settlements for the three most recent COMPLETE weeks.
   *
   * The arithmetic is deliberately identical to
   * `AdminFinanceService.generate`: grossSales from `itemsSubtotal`,
   * commission from the per-order SNAPSHOT, refunds from the ledger, and
   * netPayable as the difference. If the two ever disagree, the demo data
   * would make the finance screens look wrong when they are right.
   */
  private async seedSettlements(
    vendors: SeededVendor[],
    today: Date,
  ): Promise<number> {
    const approved = vendors.filter(
      (vendor) => vendor.status === VendorStatus.APPROVED,
    );

    // Walk back to the most recent Monday, then step a week at a time.
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const thisMonday = new Date(today.getTime() - mondayOffset * MS_PER_DAY);

    let created = 0;

    for (let week = 1; week <= 3; week += 1) {
      const periodStart = new Date(thisMonday.getTime() - week * 7 * MS_PER_DAY);
      const periodEnd = new Date(
        periodStart.getTime() + 7 * MS_PER_DAY - 1,
      );

      for (const vendor of approved) {
        const [totals] = await this.orders
          .aggregate<{
            grossSales: number;
            totalCommission: number;
            orderCount: number;
            orderIds: Types.ObjectId[];
          }>([
            {
              $match: {
                vendorId: vendor.id,
                status: OrderStatus.DELIVERED,
                deliveredAt: { $gte: periodStart, $lte: periodEnd },
              },
            },
            {
              $group: {
                _id: null,
                grossSales: { $sum: '$pricing.itemsSubtotal' },
                totalCommission: { $sum: '$pricing.commissionAmount' },
                orderCount: { $sum: 1 },
                orderIds: { $push: '$_id' },
              },
            },
          ])
          .exec();

        if (!totals || totals.orderCount === 0) continue;

        const [refundRow] = await this.ledger
          .aggregate<{ total: number }>([
            {
              $match: {
                orderId: { $in: totals.orderIds },
                type: LedgerEntryType.REFUND,
              },
            },
            { $group: { _id: null, total: { $sum: '$amount' } } },
            { $project: { _id: 0, total: { $abs: '$total' } } },
          ])
          .exec();

        const refunds = refundRow?.total ?? 0;
        const netPayable =
          totals.grossSales - totals.totalCommission - refunds;

        // The two older weeks are paid; the most recent complete week is
        // still pending, which is exactly the state a Monday morning
        // finance screen should show.
        const paid = week > 1;
        const paidAt = paid
          ? new Date(periodEnd.getTime() + MS_PER_DAY)
          : null;

        const settlement = await this.settlements.create({
          vendorId: vendor.id,
          periodStart,
          periodEnd,
          grossSales: totals.grossSales,
          totalCommission: totals.totalCommission,
          refunds,
          netPayable,
          orderCount: totals.orderCount,
          status: paid ? SettlementStatus.PAID : SettlementStatus.PENDING,
          paidAt,
          reference: paid ? `UTR${this.int(100000000, 999999999)}` : null,
          isDemo: true,
        });

        await this.ledger
          .updateMany(
            { orderId: { $in: totals.orderIds }, settlementId: null },
            { $set: { settlementId: settlement._id } },
          )
          .exec();

        if (paid && paidAt) {
          await this.ledger.create({
            vendorId: vendor.id,
            orderId: null,
            type: LedgerEntryType.PAYOUT,
            amount: -netPayable,
            note: `Weekly payout ${periodStart.toISOString().slice(0, 10)}`,
            settlementId: settlement._id,
            at: paidAt,
            isDemo: true,
          });
        }

        created += 1;
      }
    }

    return created;
  }

  // ── Coupons & audit ───────────────────────────────────────────────────

  private async seedCoupons(
    vendors: SeededVendor[],
    today: Date,
  ): Promise<number> {
    const docs = DEMO_COUPONS.map((spec) => ({
      vendorId:
        spec.vendorIndex === null ? null : vendors[spec.vendorIndex].id,
      code: spec.code,
      type: spec.type === 'percent' ? CouponType.PERCENT : CouponType.FLAT,
      value: spec.value,
      minOrder: spec.minOrder,
      maxDiscount: spec.maxDiscount,
      usageLimit: spec.usageLimit,
      usedCount: spec.usedCount,
      perUserLimit: spec.perUserLimit,
      validFrom: new Date(today.getTime() + spec.fromOffsetDays * MS_PER_DAY),
      validTo: new Date(today.getTime() + spec.toOffsetDays * MS_PER_DAY),
      isActive: spec.isActive,
      description: spec.description,
      isDemo: true,
    }));

    await this.coupons.insertMany(docs);
    return docs.length;
  }

  /**
   * ~60 audit entries spread across the window.
   *
   * Nothing here carries credential material: the entries are shaped like
   * the ones `AuditService` writes, and the real writer runs both sides of
   * every diff through the secret scrubber before it persists them.
   */
  private async seedAuditLogs(
    vendors: SeededVendor[],
    actorId: Types.ObjectId | null,
    today: Date,
  ): Promise<number> {
    const templates: {
      action: string;
      entity: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    }[] = [
      {
        action: 'vendor.status.update',
        entity: 'Vendor',
        before: { status: 'pending' },
        after: { status: 'approved', statusReason: null },
      },
      {
        action: 'vendor.commission.update',
        entity: 'Vendor',
        before: { commissionPct: 12 },
        after: { commissionPct: 14, reason: 'Renegotiated at quarterly review' },
      },
      {
        action: 'order.cancel',
        entity: 'Order',
        before: { status: 'ACCEPTED', paymentStatus: 'paid' },
        after: { status: 'CANCELLED', paymentStatus: 'refunded', reason: 'Customer request' },
      },
      {
        action: 'product.status.update',
        entity: 'Product',
        before: { isActive: true },
        after: { isActive: false, reason: 'Out of season' },
      },
      {
        action: 'coupon.create',
        entity: 'Coupon',
        before: {},
        after: { code: 'WEEKEND15', type: 'percent', value: 15, maxDiscount: 10000 },
      },
      {
        action: 'settlement.pay',
        entity: 'Settlement',
        before: { status: 'pending' },
        after: { status: 'paid', reference: 'UTR482910337' },
      },
      {
        action: 'settings.update',
        entity: 'Setting',
        before: { deliveryFeePaise: 3900 },
        after: { deliveryFeePaise: 2900 },
      },
      {
        action: 'customer.status.update',
        entity: 'User',
        before: { status: 'active' },
        after: { status: 'suspended', reason: 'Repeated fraudulent refund claims' },
      },
    ];

    const docs = [];
    for (let index = 0; index < 60; index += 1) {
      const template = templates[index % templates.length];
      const vendor = this.pick(vendors);

      docs.push({
        actorId,
        actorRole: Role.SUPER_ADMIN,
        action: template.action,
        entity: template.entity,
        entityId: vendor.id.toString(),
        before: template.before,
        after: template.after,
        ip: `203.0.113.${this.int(2, 250)}`,
        method: template.action.endsWith('.create') ? 'POST' : 'PATCH',
        path: `/api/v1/admin/${template.entity.toLowerCase()}s`,
        at: new Date(
          today.getTime() -
            this.int(0, WINDOW_DAYS - 1) * MS_PER_DAY -
            this.int(0, 23) * 3_600_000,
        ),
        isDemo: true,
      });
    }

    await this.auditLogs.insertMany(docs);
    return docs.length;
  }
}

// ── Internal shapes ─────────────────────────────────────────────────────

interface SeededVendor {
  id: Types.ObjectId;
  slug: string;
  storeName: string;
  commissionPct: number;
  status: VendorStatus;
  codEnabled: boolean;
  city: string;
}

interface SeededCategory {
  id: Types.ObjectId;
  aisleKey: string;
  name: string;
}

interface SeededProduct {
  id: Types.ObjectId;
  vendorId: Types.ObjectId;
  name: string;
  unit: string;
  price: number;
}

interface SeededCustomer {
  id: Types.ObjectId;
  name: string;
  phone: string;
}

interface SeededRider {
  id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
}

interface OrderItemDoc {
  productId: Types.ObjectId;
  name: string;
  image: string | null;
  unit: string;
  price: number;
  qty: number;
  lineTotal: number;
  fulfilled: boolean;
}

interface StatusChangeDoc {
  from: OrderStatus | null;
  to: OrderStatus;
  byUserId: Types.ObjectId | null;
  byRole: Role | null;
  reason: string | null;
  at: Date;
}

interface Timeline {
  history: StatusChangeDoc[];
  acceptedAt: Date | null;
  readyAt: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  assignedAt: Date | null;
  terminalAt: Date | null;
}

interface PaymentDoc {
  method: PaymentMethod;
  status: PaymentStatus;
  provider: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  paidAt: Date | null;
  refundedAmount: number;
}
