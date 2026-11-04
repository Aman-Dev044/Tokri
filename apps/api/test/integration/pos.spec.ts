import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';

import {
  Inventory,
  InventoryDocument,
} from '../../src/database/schemas/inventory.schema';
import {
  InventoryLog,
  InventoryLogDocument,
  InventoryReason,
} from '../../src/database/schemas/inventory-log.schema';
import {
  LedgerEntry,
  LedgerEntryDocument,
} from '../../src/database/schemas/ledger-entry.schema';
import {
  AuditLog,
  AuditLogDocument,
} from '../../src/database/schemas/audit-log.schema';
import {
  PosSale,
  PosSaleDocument,
} from '../../src/database/schemas/pos-sale.schema';
import { StaffRole } from '../../src/common/constants/permissions';
import { GST_PCT, percentOf } from '../../src/modules/shop/pricing/pricing';
import { financialYear } from '../../src/modules/vendor/pos/pos-pricing';
import { TestContext, closeTestApp, createTestApp } from '../utils/test-app';
import {
  SeededStore,
  StoreSeeder,
  runPassword,
  uniquePhone,
} from '../utils/store-fixtures';

/**
 * ════════════════════════════════════════════════════════════════════════
 *  COUNTER BILLING (POS)
 * ════════════════════════════════════════════════════════════════════════
 *
 *  · The server's total ignores anything the client says about price.
 *  · GST is the online checkout's rate and arithmetic (pricing.ts).
 *  · Stock decrements atomically; a short basket is a 409 that moves
 *    nothing — not stock, not the invoice sequence.
 *  · A replayed Idempotency-Key returns the same sale and sells nothing.
 *  · Invoice numbers are sequential and unique under concurrent sales.
 *  · A void restocks exactly once.
 *  · Nothing is ever written to the settlement ledger.
 */

const PASSWORD = runPassword();
const BARCODE = `890${Date.now().toString().slice(-10)}`;

describe('POS counter billing (integration)', () => {
  let ctx: TestContext;
  let seed: StoreSeeder;
  let inventory: Model<InventoryDocument>;
  let logs: Model<InventoryLogDocument>;
  let ledger: Model<LedgerEntryDocument>;
  let sales: Model<PosSaleDocument>;
  let audit: Model<AuditLogDocument>;

  let alpha: SeededStore;
  let bravo: SeededStore;
  let billerToken: string;
  let ledgerBefore: number;

  /** rice: ₹40 (MRP ₹50), dal: ₹24.99 short stock, an inactive one. */
  let rice: string;
  let dal: string;
  let retired: string;

  const stockOf = async (productId: string): Promise<number> =>
    (await inventory.findOne({ productId: new Types.ObjectId(productId) }).lean().exec())
      ?.stock ?? -1;

  const sell = (token: string, body: object, key: string = randomUUID()) =>
    seed.as(token, 'post', '/vendor/pos/sales').set('Idempotency-Key', key).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    seed = new StoreSeeder(ctx, PASSWORD);
    inventory = ctx.app.get(getModelToken(Inventory.name));
    logs = ctx.app.get(getModelToken(InventoryLog.name));
    ledger = ctx.app.get(getModelToken(LedgerEntry.name));
    sales = ctx.app.get(getModelToken(PosSale.name));
    audit = ctx.app.get(getModelToken(AuditLog.name));

    alpha = await seed.store('Alpha', [
      { name: 'Alpha Basmati Rice', price: 4_000, mrp: 5_000, stock: 200, barcode: BARCODE },
      { name: 'Alpha Toor Dal', price: 2_499, mrp: 2_800, stock: 3 },
      { name: 'Alpha Retired Item', price: 1_000, mrp: 1_000, stock: 10, isActive: false },
    ]);
    bravo = await seed.store('Bravo', [
      // The SAME barcode in another store is legal — unique per store.
      { name: 'Bravo Basmati Rice', price: 100, mrp: 100, stock: 10, barcode: BARCODE },
    ]);
    rice = alpha.products[0]?.id ?? '';
    dal = alpha.products[1]?.id ?? '';
    retired = alpha.products[2]?.id ?? '';

    const phone = uniquePhone();
    const password = runPassword();
    const hired = await seed
      .as(alpha.ownerToken, 'post', '/vendor/staff')
      .send({ name: 'Counter Biller', phone, password, staffRole: StaffRole.BILLER });
    expect(hired.status).toBe(201);
    billerToken = await seed.token(phone, password);

    ledgerBefore = await ledger.countDocuments().exec();
  }, 240_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  // ══════════════════════════════════════════════════════════════════
  //  Barcodes and lookup
  // ══════════════════════════════════════════════════════════════════

  describe('barcode and product lookup', () => {
    it('an exact barcode is a scanner hit; another store’s product never appears', async () => {
      const res = await seed.as(billerToken, 'get', `/vendor/pos/products?q=${BARCODE}`);
      expect(res.status).toBe(200);
      expect(res.body.barcodeMatch.id).toBe(rice);
      expect(res.body.barcodeMatch).toMatchObject({
        price: 4_000,
        mrp: 5_000,
        gstRate: GST_PCT,
        available: 200,
        unitLabel: '500 g',
      });
      expect(JSON.stringify(res.body)).not.toContain('Bravo');

      const byName = await seed.as(billerToken, 'get', '/vendor/pos/products?q=dal');
      expect(byName.body.barcodeMatch).toBeNull();
      expect(byName.body.items.map((row: { id: string }) => row.id)).toEqual([dal]);

      // Inactive products are not for sale at the counter either.
      const gone = await seed.as(billerToken, 'get', '/vendor/pos/products?q=retired');
      expect(gone.body.items).toEqual([]);
    });

    it('barcode is unique per store, settable on create and clearable on update', async () => {
      const body = {
        name: 'Second Rice',
        categoryId: alpha.categoryId,
        unit: 'kg',
        unitValue: 1,
        sku: 'ALPHA-NEW-1',
        mrp: 9_000,
        price: 8_000,
        barcode: BARCODE,
      };
      const dup = await seed.as(alpha.ownerToken, 'post', '/vendor/products').send(body);
      expect(dup.status).toBe(409);
      expect(dup.body.detail).toContain('Barcode');

      const created = await seed
        .as(alpha.ownerToken, 'post', '/vendor/products')
        .send({ ...body, barcode: `${BARCODE}9` });
      expect(created.status).toBe(201);
      expect(created.body.barcode).toBe(`${BARCODE}9`);

      const clash = await seed
        .as(alpha.ownerToken, 'patch', `/vendor/products/${created.body.id}`)
        .send({ barcode: BARCODE });
      expect(clash.status).toBe(409);

      const cleared = await seed
        .as(alpha.ownerToken, 'patch', `/vendor/products/${created.body.id}`)
        .send({ barcode: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.barcode).toBeNull();

      // Two products with no barcode do not collide on null.
      const another = await seed
        .as(alpha.ownerToken, 'post', '/vendor/products')
        .send({ ...body, sku: 'ALPHA-NEW-2', barcode: undefined });
      expect(another.status).toBe(201);
      expect(another.body.barcode).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  The server does the sums
  // ══════════════════════════════════════════════════════════════════

  describe('server-side totals', () => {
    it('refuses a client-supplied price outright', async () => {
      const res = await sell(billerToken, {
        items: [{ productId: rice, qty: 1, price: 1 }],
        paymentMode: 'upi',
      });
      expect(res.status).toBe(400);
    });

    it('prices from the product, taxes like pricing.ts, caps the discount, makes change', async () => {
      const before = await stockOf(rice);
      const res = await sell(billerToken, {
        items: [
          { productId: rice, qty: 2 },
          { productId: rice, qty: 1 }, // the same product twice merges
          { productId: dal, qty: 1 },
        ],
        paymentMode: 'cash',
        cashTenderedPaise: 20_000,
        discountPaise: 499,
        customerPhone: '9812345678',
        customerName: 'Walk-in Kumar',
      });
      expect(res.status).toBe(201);

      const subtotal = 4_000 * 3 + 2_499;
      const taxable = subtotal - 499;
      const taxes = percentOf(taxable, GST_PCT);
      expect(res.body).toMatchObject({
        status: 'completed',
        subtotal,
        discount: 499,
        taxableValue: taxable,
        taxes,
        grandTotal: taxable + taxes,
        paymentMode: 'cash',
        cashTendered: 20_000,
        change: 20_000 - (taxable + taxes),
        customer: { phone: '9812345678', name: 'Walk-in Kumar' },
        cashier: { name: 'Counter Biller', role: 'staff' },
        store: { id: alpha.vendorId, name: 'Alpha Store' },
      });
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({
        productId: rice,
        qty: 3,
        unitPrice: 4_000,
        mrp: 5_000,
        gstRate: GST_PCT,
        lineTotal: 12_000,
      });
      expect(
        res.body.items.reduce((sum: number, item: { gst: number }) => sum + item.gst, 0),
      ).toBe(taxes);
      expect(res.body.invoiceNo).toMatch(
        new RegExp(`^INV/[A-Z0-9]{2,6}/${financialYear(new Date())}/\\d{6}$`),
      );

      expect(await stockOf(rice)).toBe(before - 3);
      const trail = await logs
        .find({ refId: new Types.ObjectId(res.body.id as string) })
        .lean()
        .exec();
      expect(trail.map((log) => [log.reason, log.delta]).sort()).toEqual(
        [
          [InventoryReason.POS_SALE, -3],
          [InventoryReason.POS_SALE, -1],
        ].sort(),
      );

      expect(await audit.countDocuments({ action: 'vendor.pos.sale', entityId: res.body.id }).exec()).toBe(1);

      const capped = await sell(billerToken, {
        items: [{ productId: rice, qty: 1 }],
        paymentMode: 'card',
        discountPaise: 999_999,
      });
      expect(capped.status).toBe(201);
      expect(capped.body).toMatchObject({ discount: 4_000, taxes: 0, grandTotal: 0, change: null });
    });

    it('rejects cash below the total and moves no stock', async () => {
      const before = await stockOf(rice);
      const res = await sell(billerToken, {
        items: [{ productId: rice, qty: 1 }],
        paymentMode: 'cash',
        cashTenderedPaise: 4_000, // ₹40, but GST makes it ₹42
      });
      expect(res.status).toBe(400);
      expect(res.body.errors.code).toBe('CASH_SHORT');
      expect(await stockOf(rice)).toBe(before);

      const missing = await sell(billerToken, {
        items: [{ productId: rice, qty: 1 }],
        paymentMode: 'cash',
      });
      expect(missing.status).toBe(400);
    });

    it('refuses an inactive or another store’s product without leaking it', async () => {
      for (const productId of [retired, bravo.products[0]?.id ?? '']) {
        const res = await sell(billerToken, {
          items: [{ productId, qty: 1 }],
          paymentMode: 'upi',
        });
        expect(res.status).toBe(400);
        expect(res.body.errors.code).toBe('PRODUCT_UNAVAILABLE');
        expect(JSON.stringify(res.body)).not.toContain('Bravo');
      }
    });

    it('requires an Idempotency-Key', async () => {
      const res = await seed
        .as(billerToken, 'post', '/vendor/pos/sales')
        .send({ items: [{ productId: rice, qty: 1 }], paymentMode: 'upi' });
      expect(res.status).toBe(400);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  //  Stock and the 409
  // ══════════════════════════════════════════════════════════════════

  it('a short basket is a 409 listing the short lines, and moves nothing — not even the invoice sequence', async () => {
    const riceBefore = await stockOf(rice);
    const dalBefore = await stockOf(dal);
    const salesBefore = await sales.countDocuments().exec();

    const last = await sell(billerToken, { items: [{ productId: rice, qty: 1 }], paymentMode: 'upi' });
    const lastSeq = Number(String(last.body.invoiceNo).split('/').pop());

    const res = await sell(billerToken, {
      items: [
        { productId: rice, qty: 1 },
        { productId: dal, qty: dalBefore + 5 },
      ],
      paymentMode: 'upi',
    });
    expect(res.status).toBe(409);
    expect(res.body.errors.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.errors.lines).toEqual([
      { productId: dal, name: 'Alpha Toor Dal', requested: dalBefore + 5, available: dalBefore },
    ]);

    // Rolled back whole: the rice line that WAS available is untouched.
    expect(await stockOf(rice)).toBe(riceBefore - 1);
    expect(await stockOf(dal)).toBe(dalBefore);
    expect(await sales.countDocuments().exec()).toBe(salesBefore + 1);

    const next = await sell(billerToken, { items: [{ productId: rice, qty: 1 }], paymentMode: 'upi' });
    expect(Number(String(next.body.invoiceNo).split('/').pop())).toBe(lastSeq + 1);

    // Stock never goes below zero: sell exactly what is left, then one more.
    const exact = await sell(billerToken, {
      items: [{ productId: dal, qty: dalBefore }],
      paymentMode: 'upi',
    });
    expect(exact.status).toBe(201);
    expect(await stockOf(dal)).toBe(0);
    const over = await sell(billerToken, { items: [{ productId: dal, qty: 1 }], paymentMode: 'upi' });
    expect(over.status).toBe(409);
    expect(await stockOf(dal)).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════
  //  Idempotency and concurrency
  // ══════════════════════════════════════════════════════════════════

  it('an idempotent replay returns the same sale and sells nothing twice', async () => {
    const key = randomUUID();
    const body = { items: [{ productId: rice, qty: 2 }], paymentMode: 'upi' };
    const before = await stockOf(rice);

    const first = await sell(billerToken, body, key);
    const replay = await sell(billerToken, body, key);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.invoiceNo).toBe(first.body.invoiceNo);
    expect(await stockOf(rice)).toBe(before - 2);
    expect(await sales.countDocuments({ _id: first.body.id }).exec()).toBe(1);

    // The same key from a different person is not a replay of theirs.
    const stolen = await sell(alpha.ownerToken, body, key);
    expect(stolen.status).toBe(409);
  });

  it('invoice numbers are sequential and unique under concurrent sales', async () => {
    const N = 8;
    const before = await stockOf(rice);

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        sell(billerToken, { items: [{ productId: rice, qty: 1 }], paymentMode: 'cash', cashTenderedPaise: 5_000 }),
      ),
    );

    expect(results.map((res) => res.status)).toEqual(Array(N).fill(201));
    const numbers = results.map((res) => res.body.invoiceNo as string);
    expect(new Set(numbers).size).toBe(N);

    const seqs = numbers.map((no) => Number(no.split('/').pop())).sort((a, b) => a - b);
    const first = seqs[0] ?? 0;
    expect(seqs).toEqual(Array.from({ length: N }, (_, index) => first + index));

    // Gapless across the whole store's series, too.
    const all = await sales
      .find({ vendorId: new Types.ObjectId(alpha.vendorId) })
      .select('seq')
      .lean()
      .exec();
    const allSeqs = all.map((sale) => sale.seq).sort((a, b) => a - b);
    expect(allSeqs).toEqual(Array.from({ length: allSeqs.length }, (_, index) => index + 1));

    expect(await stockOf(rice)).toBe(before - N);
  }, 120_000);

  it('another store keeps its own sequence', async () => {
    const res = await sell(bravo.ownerToken, {
      items: [{ productId: bravo.products[0]?.id, qty: 1 }],
      paymentMode: 'upi',
    });
    expect(res.status).toBe(201);
    expect(String(res.body.invoiceNo).endsWith('/000001')).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════
  //  History and void
  // ══════════════════════════════════════════════════════════════════

  it('lists sales with today’s totals by payment mode, scoped to the store', async () => {
    const res = await seed.as(billerToken, 'get', '/vendor/pos/sales?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.meta.total).toBeGreaterThan(5);
    const completed = await sales
      .find({ vendorId: new Types.ObjectId(alpha.vendorId), status: 'completed' })
      .lean()
      .exec();
    expect(res.body.today.count).toBe(completed.length);
    expect(res.body.today.total).toBe(completed.reduce((sum, sale) => sum + sale.grandTotal, 0));
    const cash = completed.filter((sale) => sale.paymentMode === 'cash');
    expect(res.body.today.byMode.cash).toEqual({
      count: cash.length,
      total: cash.reduce((sum, sale) => sum + sale.grandTotal, 0),
    });

    const foreign = await seed.as(bravo.ownerToken, 'get', `/vendor/pos/sales/${res.body.data[0].id}`);
    expect(foreign.status).toBe(404);
  });

  it('a void restocks once, needs a reason and billing.void, and cannot run twice', async () => {
    const sale = await sell(billerToken, {
      items: [{ productId: rice, qty: 4 }],
      paymentMode: 'upi',
    });
    const id = sale.body.id as string;
    const afterSale = await stockOf(rice);

    // A BILLER has no billing.void.
    const denied = await seed
      .as(billerToken, 'post', `/vendor/pos/sales/${id}/void`)
      .send({ reason: 'Customer changed mind' });
    expect(denied.status).toBe(403);

    const noReason = await seed.as(alpha.ownerToken, 'post', `/vendor/pos/sales/${id}/void`).send({});
    expect(noReason.status).toBe(400);

    const [first, second] = await Promise.all([
      seed.as(alpha.ownerToken, 'post', `/vendor/pos/sales/${id}/void`).send({ reason: 'Returned unopened' }),
      seed.as(alpha.ownerToken, 'post', `/vendor/pos/sales/${id}/void`).send({ reason: 'Returned unopened' }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    const ok = first.status === 200 ? first : second;
    expect(ok.body.status).toBe('voided');
    expect(ok.body.void).toMatchObject({ reason: 'Returned unopened' });

    expect(await stockOf(rice)).toBe(afterSale + 4);

    const again = await seed
      .as(alpha.ownerToken, 'post', `/vendor/pos/sales/${id}/void`)
      .send({ reason: 'Trying again' });
    expect(again.status).toBe(409);
    expect(await stockOf(rice)).toBe(afterSale + 4);

    const voidLogs = await logs
      .find({ refId: new Types.ObjectId(id), reason: InventoryReason.POS_VOID })
      .lean()
      .exec();
    expect(voidLogs.map((log) => log.delta)).toEqual([4]);
    expect(await audit.countDocuments({ action: 'vendor.pos.void', entityId: id }).exec()).toBe(1);
  }, 60_000);

  // ══════════════════════════════════════════════════════════════════
  //  Not platform money
  // ══════════════════════════════════════════════════════════════════

  it('never writes a ledger entry', async () => {
    expect(await sales.countDocuments().exec()).toBeGreaterThan(10);
    expect(await ledger.countDocuments().exec()).toBe(ledgerBefore);
  });
});
