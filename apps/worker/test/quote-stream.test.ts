import {
  createAdapterRegistry,
  createFakeAdapter,
  fakeMarket,
  type SocketLike,
} from '@paras/adapters';
import { createDb, schema, upsertMarkets, upsertVenue, type DbHandle } from '@paras/db';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPollQuotesJob } from '../src/jobs/venue-sync.js';
import { startPolymarketStream } from '../src/jobs/quote-stream.js';

let testDb: TestDatabase;
let handle: DbHandle;

beforeAll(async () => {
  testDb = await createTestDatabase();
  handle = createDb(testDb.url);
});
afterAll(async () => {
  await handle.close();
  await testDb.drop();
});

describe('polymarket quote stream in the worker', () => {
  it('writes streamed books to latest_quotes; polling covers only what the socket does not', async () => {
    const { db } = handle;
    const venue = createFakeAdapter({
      id: 'polymarket',
      markets: [fakeMarket('a', { venueId: 'polymarket', volume: '9000' })],
    });
    venue.setBook('a-no', {
      bids: [{ price: '0.55', size: '10' }],
      asks: [{ price: '0.60', size: '10' }],
    });
    await upsertVenue(db, venue);
    await upsertMarkets(db, (await venue.listMarkets()).items);

    let ws!: SocketLike & { sent: string[] };
    const stream = startPolymarketStream(
      {
        db,
        streamOptions: {
          flushMs: 20,
          createSocket: () =>
            (ws = {
              sent: [],
              send(d: string) {
                this.sent.push(d);
              },
              close() {
                this.onclose?.({});
              },
              onopen: null,
              onmessage: null,
              onclose: null,
              onerror: null,
            }),
        },
      },
      { refreshMs: 60_000 },
    );
    await expect.poll(() => Boolean(ws), { timeout: 5000 }).toBe(true);
    ws.onopen?.({});
    expect(JSON.parse(ws.sent[0]!).assets_ids).toEqual(['a-yes', 'a-no']);

    ws.onmessage?.({
      data: JSON.stringify([
        {
          event_type: 'book',
          asset_id: 'a-yes',
          timestamp: String(Date.now()),
          bids: [{ price: '0.40', size: '100' }],
          asks: [{ price: '0.45', size: '50' }],
        },
      ]),
    });
    await expect
      .poll(async () => (await db.select().from(schema.latestQuotes)).length, { timeout: 5000 })
      .toBe(1);
    const [row] = await db
      .select({ q: schema.latestQuotes })
      .from(schema.latestQuotes)
      .innerJoin(schema.outcomes, eq(schema.outcomes.id, schema.latestQuotes.outcomeId))
      .where(eq(schema.outcomes.externalId, 'a-yes'));
    expect(row?.q).toMatchObject({ bid: '0.4', ask: '0.45' });

    // Poll only fetches the uncovered Outcome (a-no) while the socket is up...
    const job = createPollQuotesJob({
      db,
      adapters: createAdapterRegistry([venue]),
      streamCovers: stream.covers,
    });
    await job.handler({ venue: 'polymarket', topMarkets: 10 });
    const ids = async () =>
      (
        await db
          .select({ id: schema.outcomes.externalId })
          .from(schema.latestQuotes)
          .innerJoin(schema.outcomes, eq(schema.outcomes.id, schema.latestQuotes.outcomeId))
      )
        .map((r) => r.id)
        .sort();
    expect(await ids()).toEqual(['a-no', 'a-yes']);
    // a-yes untouched by the poll (the fake book for it is empty).
    const [still] = await db
      .select({ q: schema.latestQuotes })
      .from(schema.latestQuotes)
      .innerJoin(schema.outcomes, eq(schema.outcomes.id, schema.latestQuotes.outcomeId))
      .where(eq(schema.outcomes.externalId, 'a-yes'));
    expect(still?.q.bid).toBe('0.4');

    // ...and everything when it is down.
    ws.onclose?.({});
    expect(stream.covers('polymarket', 'a-yes')).toBe(false);
    stream.stop();
  });
});
