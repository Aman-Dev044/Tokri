import 'reflect-metadata';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import type { Server } from 'node:http';

import { Role } from '../../src/common/constants/roles.enum';
import {
  SearchTermCount,
  SearchTermCountDocument,
} from '../../src/modules/shop/schemas/search-term-count.schema';
import { normaliseSearchTerm } from '../../src/modules/shop/search/popular-searches.service';
import { TestContext, closeTestApp, createTestApp, nextIp } from '../utils/test-app';
import { StoreSeeder, runPassword } from '../utils/store-fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight, `daysAgo` days before today — how the counter keys a day. */
function utcDay(daysAgo: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      daysAgo * DAY_MS,
  );
}

/**
 * Popular searches: counted, never attributed.
 *
 * The write is fire-and-forget, so a spec cannot simply read the
 * collection after the search returns — the count may land a moment
 * later. `countOf` polls for it, and an ABSENCE is only asserted after a
 * later, valid term has landed (writes from one process arrive in order
 * closely enough for that; a bad term is dropped before any write).
 */
describe('Popular searches (integration)', () => {
  let ctx: TestContext;
  let server: Server;
  let seed: StoreSeeder;
  let counts: Model<SearchTermCountDocument>;
  let customerToken: string;

  async function countOf(term: string, expected: number): Promise<number> {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const row = await counts.findOne({ term }).lean().exec();
      const count = row?.count ?? 0;
      if (count >= expected || Date.now() > deadline) return count;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  const search = (q: string, extra: Record<string, unknown> = {}) =>
    request(server)
      .get('/products')
      .query({ q, ...extra })
      .set('X-Forwarded-For', nextIp());

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
    seed = new StoreSeeder(ctx, runPassword());
    counts = ctx.app.get(getModelToken(SearchTermCount.name));
    await counts.init();

    // An open store with something to find, so the searches are real.
    await seed.store('Search', [{ name: 'Amul Butter', price: 5600, mrp: 6000 }]);
    const customer = await seed.user(Role.CUSTOMER, null);
    customerToken = await seed.token(customer.phone);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  it('normalises a term: trimmed, lowercased, whitespace collapsed', () => {
    expect(normaliseSearchTerm('  Amul   BUTTER ')).toBe('amul butter');
    expect(normaliseSearchTerm('a')).toBeNull();
    expect(normaliseSearchTerm('   b   ')).toBeNull();
    expect(normaliseSearchTerm('x'.repeat(41))).toBeNull();
    expect(normaliseSearchTerm('x'.repeat(40))).toBe('x'.repeat(40));
  });

  it('counts a signed-in search with NO user id and NO IP — only term, day, count', async () => {
    const res = await search('  Amul   BUTTER ')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('X-Forwarded-For', '203.0.113.77');
    expect(res.status).toBe(200);
    await search('amul butter');

    expect(await countOf('amul butter', 2)).toBe(2);

    const raw = await counts.collection.findOne({ term: 'amul butter' });
    expect(raw).not.toBeNull();
    expect(Object.keys(raw ?? {}).sort()).toEqual(['_id', 'count', 'day', 'term']);
    expect(raw?.day).toEqual(utcDay(0));

    // Belt and braces: nothing anywhere in the collection mentions who.
    const everything = JSON.stringify(await counts.collection.find().toArray());
    expect(everything).not.toContain('203.0.113.77');
    expect(everything).not.toMatch(/user|customer|ip"|session/i);
  });

  it('ignores terms under 2 or over 40 characters', async () => {
    const tooLong = 'y'.repeat(41);
    await search('z');
    await search('   q   ');
    await search(tooLong);
    // A later valid term has landed ⇒ the bad ones were dropped, not slow.
    await search('ghee');
    expect(await countOf('ghee', 1)).toBe(1);

    expect(await counts.countDocuments({ term: { $in: ['z', 'q', tooLong] } })).toBe(0);
  });

  it('counts the first page only — "show more" is not a second search', async () => {
    await search('paneer', { page: 2 });
    await search('paneer');
    expect(await countOf('paneer', 1)).toBe(1);
    expect(await countOf('paneer', 2)).toBe(1);
  });

  it('counts an in-store search too', async () => {
    const store = await seed.store('Instore', [{ name: 'Curd', price: 3000, mrp: 3200 }]);
    const res = await request(server)
      .get(`/stores/${store.vendorId}/products`)
      .query({ q: 'Curd' })
      .set('X-Forwarded-For', nextIp());
    expect(res.status).toBe(200);
    expect(await countOf('curd', 1)).toBe(1);
  });

  it('a failing counter never fails the search', async () => {
    const spy = jest.spyOn(counts, 'updateOne').mockImplementation(() => {
      throw new Error('counter collection unavailable');
    });
    try {
      const res = await search('butter');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('a hung counter never slows the search', async () => {
    const spy = jest.spyOn(counts, 'updateOne').mockImplementation(
      () =>
        ({
          exec: () => new Promise(() => undefined),
        }) as unknown as ReturnType<Model<SearchTermCountDocument>['updateOne']>,
    );
    try {
      const started = Date.now();
      const res = await search('butter');
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('GET /search/popular is public and returns the top 8 of the last 7 days', async () => {
    await counts.deleteMany({});
    await counts.insertMany([
      // Inside the window, summed across days.
      { term: 'milk', day: utcDay(0), count: 30 },
      { term: 'milk', day: utcDay(6), count: 20 },
      { term: 'bread', day: utcDay(1), count: 40 },
      { term: 'eggs', day: utcDay(2), count: 35 },
      { term: 'atta', day: utcDay(3), count: 25 },
      { term: 'rice', day: utcDay(4), count: 15 },
      { term: 'dal', day: utcDay(5), count: 12 },
      { term: 'onion', day: utcDay(0), count: 10 },
      { term: 'tomato', day: utcDay(0), count: 9 },
      // Ninth by count — falls off the top 8.
      { term: 'banana', day: utcDay(0), count: 3 },
      // Huge, but eight days ago: outside the window.
      { term: 'diwali sweets', day: utcDay(7), count: 999 },
      // One search is one person, not "popular".
      { term: 'rare thing', day: utcDay(0), count: 1 },
    ]);

    const res = await request(server)
      .get('/search/popular')
      .set('X-Forwarded-For', nextIp());

    expect(res.status).toBe(200);
    expect(res.body.windowDays).toBe(7);
    expect(res.body.terms).toEqual([
      { term: 'milk', count: 50 },
      { term: 'bread', count: 40 },
      { term: 'eggs', count: 35 },
      { term: 'atta', count: 25 },
      { term: 'rice', count: 15 },
      { term: 'dal', count: 12 },
      { term: 'onion', count: 10 },
      { term: 'tomato', count: 9 },
    ]);
  });
});
