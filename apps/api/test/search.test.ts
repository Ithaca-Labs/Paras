import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import {
  enrichEvents,
  recordQuotes,
  refreshEventSignals,
  schema,
  upsertMarkets,
  upsertVenue,
} from '@paras/db';
import { buildTaxonomyIndex } from '@paras/domain';
import { createFakeEmbedder } from '@paras/embeddings';
import { ApiError } from '@paras/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const embedder = createFakeEmbedder();
const T0 = new Date('2026-10-08T10:00:00Z');
const NOW = new Date('2026-10-09T12:00:00Z');

const markets = () => [
  fakeMarket('fomc', {
    question: 'FOMC to lower borrowing costs at its final meeting of the year',
    volume: '5000',
    liquidity: '800',
    endDate: '2026-12-18T00:00:00.000Z',
  }),
  fakeMarket('btc', {
    question: 'Will Bitcoin reach $150k by year end?',
    volume: '9000',
    liquidity: '100',
    endDate: '2026-12-31T00:00:00.000Z',
  }),
  fakeMarket('lakers', {
    question: 'Will the Lakers win the NBA Finals?',
    volume: '3000',
    liquidity: '300',
    endDate: '2027-06-30T00:00:00.000Z',
  }),
  fakeMarket('dune', {
    question: 'Will the new Dune film open above $100M?',
    volume: '100',
    liquidity: '50',
    endDate: '2026-10-12T00:00:00.000Z',
  }),
  fakeMarket('old-fed', {
    question: 'Will the Fed cut rates in September?',
    volume: '50000',
    status: 'resolved',
  }),
  fakeMarket('shut', { question: 'Will the Fed cut rates in July?', status: 'closed' }),
];

/** Quotes: [yes price at T0, yes price now]. */
const prices: Record<string, [number, number]> = {
  fomc: [0.5, 0.52],
  btc: [0.3, 0.5],
  lakers: [0.2, 0.2],
  dune: [0.85, 0.85],
};

async function seed(t: TestApp, venue: FakeAdapter, withEmbeddings = true) {
  const { items } = await venue.listMarkets({ status: 'all' });
  await upsertVenue(t.db, venue);
  await upsertMarkets(t.db, items);
  if (withEmbeddings) await enrichEvents(t.db, embedder, await buildTaxonomyIndex(embedder));
}

async function quote(t: TestApp, venue: FakeAdapter, at: 0 | 1, clock: Date) {
  for (const [id, p] of Object.entries(prices)) {
    const yes = p[at];
    venue.setBook(`${id}-yes`, {
      bids: [{ price: String(yes - 0.01), size: '100' }],
      asks: [{ price: String(yes + 0.01), size: '100' }],
      lastTradePrice: String(yes),
    });
    venue.setBook(`${id}-no`, {
      bids: [{ price: String(1 - yes - 0.01), size: '100' }],
      asks: [{ price: String(1 - yes + 0.01), size: '100' }],
      lastTradePrice: String(1 - yes),
    });
  }
  const ids = Object.keys(prices).flatMap((id) => [`${id}-yes`, `${id}-no`]);
  await recordQuotes(t.db, venue.id, await venue.fetchQuotes(ids), { now: clock });
}

let t: TestApp;
let ftsOnly: TestApp;
let venue: FakeAdapter;
let clock = T0;
const titles = (r: { items: { title: string }[] }) => r.items.map((e) => e.title);
const ask = (query: Record<string, string | number> = {}) => t.client.listEvents({ query });

beforeAll(async () => {
  venue = createFakeAdapter({ id: 'fake-venue', markets: markets(), now: () => clock });
  const other = createFakeAdapter({
    id: 'other-venue',
    markets: [
      fakeMarket('other', {
        venueId: 'other-venue',
        question: 'Will Ethereum flip Bitcoin?',
        volume: '10',
        liquidity: '10',
      }),
    ],
  });
  t = await createTestApp({ adapters: [venue, other], embedder, now: () => NOW });
  await seed(t, venue);
  await seed(t, other);
  clock = T0;
  await quote(t, venue, 0, clock);
  clock = NOW;
  await quote(t, venue, 1, clock);
  await refreshEventSignals(t.db, NOW);
  // Deterministic "newest": the Lakers Event was created last.
  await t.db
    .update(schema.events)
    .set({ createdAt: new Date('2026-10-09T11:00:00Z') })
    .where(eq(schema.events.title, 'Will the Lakers win the NBA Finals?'));

  // Same data, no embedder: full-text only.
  ftsOnly = await createTestApp({ adapters: [venue], now: () => NOW });
  await seed(ftsOnly, venue);
});
afterAll(async () => {
  await t.close();
  await ftsOnly.close();
});

describe('search', () => {
  it('finds Events by meaning when the wording differs (semantic)', async () => {
    const r = await ask({ q: 'will the Fed cut in December' });
    expect(titles(r)[0]).toBe('FOMC to lower borrowing costs at its final meeting of the year');
  });

  it('full-text alone misses that Event, proving the semantic half', async () => {
    const r = await ftsOnly.client.listEvents({ query: { q: 'will the Fed cut in December' } });
    expect(titles(r)).not.toContain(
      'FOMC to lower borrowing costs at its final meeting of the year',
    );
  });

  it('finds Events by exact words (full-text)', async () => {
    expect(titles(await ask({ q: 'Dune film' }))).toEqual([
      'Will the new Dune film open above $100M?',
    ]);
  });

  it('combines search with filters and re-sorts by the chosen sort', async () => {
    const r = await ask({ q: 'bitcoin price', category: 'crypto', sort: 'newest' });
    expect(titles(r)).toEqual(
      ['Will Bitcoin reach $150k by year end?', 'Will Ethereum flip Bitcoin?'].sort(
        (a, b) => titles(r).indexOf(a) - titles(r).indexOf(b),
      ),
    );
    expect(titles(r)).toContain('Will Bitcoin reach $150k by year end?');
  });
});

describe('browse: defaults, filters, sorts', () => {
  it('hides resolved and closed Events by default', async () => {
    const r = await ask();
    expect(titles(r)).not.toContain('Will the Fed cut rates in September?');
    expect(titles(r)).not.toContain('Will the Fed cut rates in July?');
    expect(titles(r)).toHaveLength(5);
    expect(titles(await ask({ q: 'Fed cut rates' }))).not.toContain(
      'Will the Fed cut rates in September?',
    );
  });

  it('shows them when asked', async () => {
    expect(titles(await ask({ status: 'resolved' }))).toEqual([
      'Will the Fed cut rates in September?',
    ]);
    expect(titles(await ask({ status: 'all' }))).toHaveLength(7);
  });

  it('filters by Venue', async () => {
    expect(titles(await ask({ venue: 'other-venue' }))).toEqual(['Will Ethereum flip Bitcoin?']);
  });

  it('filters by category, topic and entity', async () => {
    expect(titles(await ask({ category: 'sports' }))).toEqual([
      'Will the Lakers win the NBA Finals?',
    ]);
    expect(titles(await ask({ topic: 'fed-rates' }))).toEqual([
      'FOMC to lower borrowing costs at its final meeting of the year',
    ]);
    expect(titles(await ask({ entity: 'lakers' }))).toHaveLength(1);
    expect(titles(await ask({ category: 'crypto', sort: 'volume' }))).toEqual([
      'Will Bitcoin reach $150k by year end?',
      'Will Ethereum flip Bitcoin?',
    ]);
  });

  it('filters by resolution date', async () => {
    const r = await ask({
      closesBefore: '2026-12-20T00:00:00Z',
      closesAfter: '2026-10-10T00:00:00Z',
    });
    expect(titles(r)).toEqual([
      'FOMC to lower borrowing costs at its final meeting of the year',
      'Will the new Dune film open above $100M?',
    ]);
    expect(titles(r)).toHaveLength(2);
  });

  it('filters by liquidity and price range', async () => {
    expect(titles(await ask({ minLiquidity: 300 }))).toEqual([
      'FOMC to lower borrowing costs at its final meeting of the year',
      'Will the Lakers win the NBA Finals?',
    ]);
    expect(titles(await ask({ minPrice: 0.84, maxPrice: 0.9 }))).toEqual([
      'Will the new Dune film open above $100M?',
    ]);
  });

  it('sorts', async () => {
    const order = async (sort: string) => titles(await ask({ sort }));
    expect((await order('volume'))[0]).toBe('Will Bitcoin reach $150k by year end?');
    expect((await order('trending'))[0]).toBe('Will Bitcoin reach $150k by year end?');
    expect((await order('biggest_move')).slice(0, 2)).toEqual([
      'Will Bitcoin reach $150k by year end?',
      'FOMC to lower borrowing costs at its final meeting of the year',
    ]);
    expect((await order('closing_soon'))[0]).toBe('Will the new Dune film open above $100M?');
    expect((await order('newest'))[0]).toBe('Will the Lakers win the NBA Finals?');
  });

  it('rejects an invalid sort', async () => {
    await expect(ask({ sort: 'nonsense' })).rejects.toBeInstanceOf(ApiError);
  });

  it('exposes tags and move on each Event', async () => {
    const btc = (await ask({ q: 'Bitcoin reach' })).items[0]!;
    expect(btc.category).toBe('crypto');
    expect(btc.tags).toEqual(
      expect.arrayContaining([
        { id: 'bitcoin', label: 'Bitcoin', kind: 'topic' },
        { id: 'crypto', label: 'Crypto', kind: 'category' },
      ]),
    );
    expect(Number(btc.move24h)).toBeCloseTo(0.2);
  });
});

describe('taxonomy browse', () => {
  it('lists categories with topics, entities and open Event counts', async () => {
    const { items } = await t.client.listCategories({});
    expect(items.map((c) => c.id)).toContain('politics');
    const sports = items.find((c) => c.id === 'sports')!;
    expect(sports.eventCount).toBe(1);
    expect(sports.topics.find((x) => x.id === 'nba')).toMatchObject({
      eventCount: 1,
      entities: expect.arrayContaining([
        { id: 'lakers', label: 'Los Angeles Lakers', eventCount: 1 },
      ]),
    });
  });

  it('gets one category, 404 for unknown', async () => {
    expect((await t.client.getCategory({ params: { id: 'crypto' } })).eventCount).toBe(2);
    await expect(t.client.getCategory({ params: { id: 'nope' } })).rejects.toMatchObject({
      status: 404,
    });
  });
});
