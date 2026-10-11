import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import { schema, upsertMarkets, upsertVenue } from '@paras/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const NOW = new Date('2026-10-09T12:00:00Z');
const mk = (id: string) =>
  fakeMarket(id, {
    question: `Will ${id} happen?`,
    volume: '5000',
    liquidity: '3000',
    endDate: '2027-06-30T00:00:00.000Z',
  });

let t: TestApp;
let venue: FakeAdapter;
const eventOf: Record<string, string> = {};

beforeAll(async () => {
  venue = createFakeAdapter({
    id: 'fake-venue',
    markets: [mk('alpha'), mk('beta')],
    now: () => NOW,
  });
  t = await createTestApp({ adapters: [venue], now: () => NOW });
  await upsertVenue(t.db, venue);
  await upsertMarkets(t.db, (await venue.listMarkets({ status: 'all' })).items);
  const { items } = await t.client.listEvents({ query: { limit: 10 } });
  for (const e of items) eventOf[e.title.match(/Will (\w+)/)![1]!] = e.id;
  // Nansen signal on beta only: profitable holders + flow lean NO.
  const betaMarket = (await t.db.select().from(schema.markets)).find(
    (x) => x.externalId === 'beta',
  )!;
  await t.db.insert(schema.smartMoneySignals).values({
    marketId: betaMarket.id,
    signal: {
      lean: -0.9,
      strength: 0.9,
      yesShare: 0.05,
      smartHolders: 7,
      flowUsd: -12_000,
      netflow24hUsd: null,
    },
    updatedAt: NOW,
  });
});
afterAll(() => t.close());

describe('smart money (Nansen) in the API', () => {
  it('Feed ranks the Event with a strong lean first, with reason text', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/feed?limit=10' });
    const { items } = res.json() as { items: { event: { id: string }; reason: string }[] };
    expect(items.map((i) => i.event.id)).toEqual([eventOf.beta, eventOf.alpha]);
    expect(items[0]!.reason).toBe('Smart money is leaning NO');
  });

  it('Event API exposes smartMoney (null when unknown)', async () => {
    const beta = await t.client.getEvent({ params: { id: eventOf.beta! } });
    expect(beta.smartMoney).toMatchObject({
      leaning: 'NO',
      strength: 0.9,
      smartHolders: 7,
      reason: 'Smart money is leaning NO',
    });
    expect((await t.client.getEvent({ params: { id: eventOf.alpha! } })).smartMoney).toBeNull();
  });

  it('explainEvent summarises the move and the signal', async () => {
    const r = await t.client.explainEvent({ params: { id: eventOf.beta! } });
    expect(r.smartMoney?.leaning).toBe('NO');
    expect(r.summary).toContain('Smart money is leaning NO');
    expect(r.summary).toContain('5% of profitable-holder value is on YES');
    const none = await t.client.explainEvent({ params: { id: eventOf.alpha! } });
    expect(none.summary).toContain('No smart-money data');
  });
});
