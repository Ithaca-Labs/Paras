import { fakeMarket } from '@paras/adapters';
import {
  createDb,
  listPollTargets,
  schema,
  upsertMarkets,
  upsertVenue,
  type DbHandle,
} from '@paras/db';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe('listPollTargets', () => {
  it('puts followed Events and open positions first, then fills by volume within the cap', async () => {
    const { db } = handle;
    await upsertVenue(db, {
      id: 'fake-venue',
      name: 'Fake',
      capabilities: { orderBook: true } as never,
    });
    await upsertMarkets(db, [
      fakeMarket('big1', { volume: '9000' }),
      fakeMarket('big2', { volume: '8000' }),
      fakeMarket('followed', { volume: '1' }),
      fakeMarket('held', { volume: '2' }),
      fakeMarket('closedpos', { volume: '3' }),
    ]);
    const market = async (externalId: string) =>
      (await db.select().from(schema.markets).where(eq(schema.markets.externalId, externalId)))[0]!;
    const followed = await market('followed');
    const [link] = await db
      .select()
      .from(schema.eventMarkets)
      .where(eq(schema.eventMarkets.marketId, followed.id));
    await db
      .insert(schema.follows)
      .values({ ownerKey: 'u:1', kind: 'event', targetId: link!.eventId });

    const [user] = await db.insert(schema.users).values({}).returning();
    const hold = async (externalId: string, status: 'open' | 'closed') => {
      const m = await market(externalId);
      const [o] = await db.select().from(schema.outcomes).where(eq(schema.outcomes.marketId, m.id));
      const [intent] = await db
        .insert(schema.intents)
        .values({
          userId: user!.id,
          userAddress: '0xabc',
          intentId: `0x${externalId}`,
          amountUsdc: '1',
          expiry: new Date(),
          details: {} as never,
          detailsHash: '0x',
        })
        .returning();
      await db.insert(schema.positions).values({
        userId: user!.id,
        intentRowId: intent!.id,
        userAddress: '0xabc',
        eventId: link!.eventId,
        marketId: m.id,
        outcomeId: o!.id,
        venueId: 'fake-venue',
        tokenId: o!.externalId,
        conditionId: externalId,
        outcomeIndex: 0,
        sharesBought: '1',
        shares: '1',
        costUsdc: '1',
        status,
      });
    };
    await hold('held', 'open');
    await hold('closedpos', 'closed');

    const targets = await listPollTargets(db, 'fake-venue', 3);
    expect(targets).toHaveLength(6);
    expect(targets.slice(0, 4).sort()).toEqual(
      ['followed-yes', 'followed-no', 'held-yes', 'held-no'].sort(),
    );
    expect(targets.slice(4).every((t) => t.startsWith('big1'))).toBe(true);
  });
});
