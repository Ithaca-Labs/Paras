import {
  createAdapterRegistry,
  createFakeAdapter,
  fakeMarket,
  type FakeAdapter,
} from '@paras/adapters';
import { createDb, schema, type DbHandle } from '@paras/db';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildJobs, buildSchedules } from '../src/jobs/index.js';
import { buildWorker } from '../src/worker.js';

let testDb: TestDatabase;
let handle: DbHandle;
let db: DbHandle['db'];
let venue: FakeAdapter;
let worker: ReturnType<typeof buildWorker>;

beforeAll(async () => {
  testDb = await createTestDatabase();
  handle = createDb(testDb.url);
  db = handle.db;
  venue = createFakeAdapter({
    id: 'fake-venue',
    markets: [
      fakeMarket('a', { volume: '5000' }),
      fakeMarket('b', { volume: '9000' }),
      fakeMarket('closed', { status: 'closed' }),
    ],
  });
  venue.setBook('a-yes', {
    bids: [{ price: '0.40', size: '100' }],
    asks: [{ price: '0.45', size: '50' }],
  });
  venue.setBook('a-no', {
    bids: [{ price: '0.55', size: '50' }],
    asks: [{ price: '0.60', size: '100' }],
  });
  venue.setBook('b-yes', { bids: [], asks: [{ price: '0.9', size: '10' }] });
  worker = buildWorker({
    databaseUrl: testDb.url,
    jobs: buildJobs({ db: handle.db, adapters: createAdapterRegistry([venue]) }),
    schedules: buildSchedules(['fake-venue']),
    startup: [{ queue: 'venue.sync-markets', data: { venue: 'fake-venue' } }],
  });
  await worker.start();
});
afterAll(async () => {
  await worker.stop();
  await handle.close();
  await testDb.drop();
});

describe('venue sync jobs', () => {
  it('syncs open Markets, Outcomes and one single-Venue Event per Market on startup', async () => {
    await expect
      .poll(async () => (await db.select().from(schema.markets)).length, { timeout: 20_000 })
      .toBe(2);
    expect(await db.select().from(schema.venues)).toMatchObject([
      { id: 'fake-venue', capabilities: { orderBook: true } },
    ]);
    expect(await db.select().from(schema.outcomes)).toHaveLength(4);
    const events = await db.select().from(schema.events);
    expect(events.map((e) => e.title).sort()).toEqual(['Will a happen?', 'Will b happen?']);
    expect(await db.select().from(schema.eventMarkets)).toHaveLength(2);
  });

  it('polls Quotes into latest_quotes and records snapshots', async () => {
    await worker.boss.send('venue.poll-quotes', { venue: 'fake-venue' });
    await expect
      .poll(async () => (await db.select().from(schema.latestQuotes)).length, { timeout: 20_000 })
      .toBe(3);

    const [yes] = await db
      .select({ q: schema.latestQuotes })
      .from(schema.latestQuotes)
      .innerJoin(schema.outcomes, eq(schema.outcomes.id, schema.latestQuotes.outcomeId))
      .where(eq(schema.outcomes.externalId, 'a-yes'));
    expect(yes?.q).toMatchObject({ bid: '0.4', ask: '0.45', bidDepth: '40', askDepth: '22.5' });
    const snaps = await db.select().from(schema.quoteSnapshots);
    expect(snaps).toHaveLength(3);
  });

  it('skips unchanged snapshots but still refreshes latest observedAt', async () => {
    const before = await db.select().from(schema.latestQuotes);
    await new Promise((r) => setTimeout(r, 20));
    await worker.boss.send('venue.poll-quotes', { venue: 'fake-venue' });
    await expect
      .poll(
        async () => {
          const now = await db.select().from(schema.latestQuotes);
          return now.every(
            (q) => q.observedAt > before.find((b) => b.outcomeId === q.outcomeId)!.observedAt,
          );
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    expect(await db.select().from(schema.quoteSnapshots)).toHaveLength(3);
  });

  it('records a new snapshot when a Quote changes and re-sync is idempotent', async () => {
    venue.setBook('a-yes', {
      bids: [{ price: '0.42', size: '100' }],
      asks: [{ price: '0.45', size: '50' }],
    });
    await worker.boss.send('venue.poll-quotes', { venue: 'fake-venue' });
    await expect
      .poll(async () => (await db.select().from(schema.quoteSnapshots)).length, {
        timeout: 20_000,
      })
      .toBe(4);

    venue.setMarkets([
      fakeMarket('a', { volume: '7000', question: 'Renamed?' }),
      fakeMarket('b', { volume: '9000' }),
    ]);
    await worker.boss.send('venue.sync-markets', { venue: 'fake-venue' });
    await expect
      .poll(async () => (await db.select().from(schema.events)).map((e) => e.title).sort(), {
        timeout: 20_000,
      })
      .toEqual(['Renamed?', 'Will b happen?']);
    expect(await db.select().from(schema.markets)).toHaveLength(2);
    expect(await db.select().from(schema.events)).toHaveLength(2);
    expect(await db.select().from(schema.outcomes)).toHaveLength(4);
  });
});
