import {
  createAdapterRegistry,
  createFakeAdapter,
  createOpinionAdapter,
  createProbableAdapter,
  fakeMarket,
} from '@paras/adapters';
import { createDb, schema, type DbHandle } from '@paras/db';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildJobs, buildSchedules } from '../src/jobs/index.js';
import { buildWorker } from '../src/worker.js';

let testDb: TestDatabase;
let handle: DbHandle;
let worker: ReturnType<typeof buildWorker>;
let hits = 0;

beforeAll(async () => {
  testDb = await createTestDatabase();
  handle = createDb(testDb.url);
  const core = createFakeAdapter({
    id: 'core',
    markets: [fakeMarket('a', { venueId: 'core' }), fakeMarket('b', { venueId: 'core' })],
  });
  // Long-tail Venues are down: every request fails.
  const down = async () => {
    hits++;
    return new Response('bad gateway', { status: 502 });
  };
  const longTail = [createOpinionAdapter({ fetch: down }), createProbableAdapter({ fetch: down })];
  const adapters = createAdapterRegistry([core, ...longTail]);
  const venues = [...adapters.keys()];
  worker = buildWorker({
    databaseUrl: testDb.url,
    jobs: buildJobs({ db: handle.db, adapters }),
    schedules: buildSchedules(venues),
    startup: venues.map((venue) => ({ queue: 'venue.sync-markets', data: { venue } })),
  });
  await worker.start();
});
afterAll(async () => {
  await worker.stop();
  await handle.close();
  await testDb.drop();
});

describe('long-tail Venue outage', () => {
  it('leaves core Venue sync unaffected and long-tail Venues empty', async () => {
    await expect
      .poll(async () => (await handle.db.select().from(schema.markets)).length, { timeout: 20_000 })
      .toBe(2);
    await expect.poll(() => hits, { timeout: 20_000 }).toBeGreaterThan(0);
    const rows = await handle.db.select().from(schema.markets);
    expect(new Set(rows.map((m) => m.venueId))).toEqual(new Set(['core']));
  });
});
