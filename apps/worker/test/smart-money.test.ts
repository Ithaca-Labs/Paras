import { createFakeAdapter, createNansenClient, fakeMarket } from '@paras/adapters';
import { createDb, schema, upsertMarkets, upsertVenue, type DbHandle } from '@paras/db';
import { createFixtureFetch } from '@paras/testkit';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAlertScanJob } from '../src/jobs/notifications.js';
import { createSmartMoneyJob } from '../src/jobs/smart-money.js';

// Replays the hand-written Nansen fixtures recorded for the adapters package.
const replay = createFixtureFetch({
  dir: new URL('../../../packages/adapters/test/fixtures/nansen/', import.meta.url),
});
let calls = 0;
const nansen = createNansenClient({
  apiKey: 'k',
  fetch: (...a) => {
    calls++;
    return replay(...a);
  },
});
const NOW = new Date('2026-10-11T00:00:00Z');

let testDb: TestDatabase;
let handle: DbHandle;
let db: DbHandle['db'];

beforeAll(async () => {
  testDb = await createTestDatabase();
  handle = createDb(testDb.url);
  db = handle.db;
  const venue = createFakeAdapter({ id: 'polymarket' });
  await upsertVenue(db, venue);
  await upsertMarkets(db, [
    fakeMarket('0xcond1', {
      venueId: 'polymarket',
      question: 'Will BTC hit 200k?',
      volume: '9000',
    }),
  ]);
});
afterAll(async () => {
  await handle.close();
  await testDb.drop();
});

const job = (cap: number) =>
  createSmartMoneyJob({ db, nansen, nansenDailyCap: cap, now: () => NOW });

describe('nansen.refresh-signals', () => {
  it('spends holders + trades + netflow (3 credits) within the cap', async () => {
    await job(3).handler({ maxMarkets: 3 });
    expect(await db.select().from(schema.smartMoneySignals)).toHaveLength(1);
  });

  it('is a no-op while the cached signal is fresh', async () => {
    calls = 0;
    await job(8).handler({ maxMarkets: 3 });
    expect(calls).toBe(0);
  });

  it('refuses to spend past the cap on a new day', async () => {
    calls = 0;
    const later = createSmartMoneyJob({
      db,
      nansen,
      nansenDailyCap: 1,
      now: () => new Date('2026-10-13T00:00:00Z'),
    });
    await later.handler({ maxMarkets: 3 });
    expect(calls).toBe(0);
  });

  it('stored signal leans YES (profitable holders + buys) and includes BTC netflow', async () => {
    const [row] = await db.select().from(schema.smartMoneySignals);
    expect(row!.signal.lean).toBeGreaterThan(0.5);
    expect(row!.signal.netflow24hUsd).toBe(2_500_000);
  });

  it('records credits spent for the day', async () => {
    const [u] = await db
      .select()
      .from(schema.nansenUsage)
      .where(eq(schema.nansenUsage.day, '2026-10-11'));
    expect(u!.credits).toBe(3);
  });
});

describe('smart-money alert', () => {
  it('raises smart_money for a follower of the Event, once', async () => {
    const [ev] = await db.select().from(schema.events);
    await db.insert(schema.follows).values({ ownerKey: 'a:fan', kind: 'event', targetId: ev!.id });
    const scan = createAlertScanJob({ db, now: () => NOW });
    const t = { moveThreshold: 0.1, closingWithinHours: 24 };
    await scan.handler(t);
    await scan.handler(t);
    const inbox = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.ownerKey, 'a:fan'));
    expect(inbox.filter((n) => n.kind === 'smart_money')).toHaveLength(1);
    expect(inbox.find((n) => n.kind === 'smart_money')!.body).toContain('leaning YES');
  });
});
