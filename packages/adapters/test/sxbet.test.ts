import { bookToQuote } from '@paras/domain';
import { NormalizedMarket, OrderBook, Quote, VenueCapabilities } from '@paras/shared';
import { createFixtureFetch } from '@paras/testkit';
import { describe, expect, it } from 'vitest';
import { createSxBetAdapter } from '../src/index.js';
import { normalizeSxBook, normalizeSxMarket } from '../src/sxbet/normalize.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createSxBetAdapter({
  fetch: createFixtureFetch({ dir: new URL('./fixtures/sxbet/', import.meta.url) }),
  now: () => new Date('2026-10-09T00:00:00Z'),
});

describe('sxbet adapter (fixture replay)', () => {
  it('normalizes active Markets into the shared schema', async () => {
    const page = await adapter.listMarkets({ limit: 30 });
    expect(page.items).toHaveLength(30);
    expect(page.nextCursor).toBeTruthy();
    for (const m of page.items) {
      expect(NormalizedMarket.parse(m)).toEqual(m);
      expect(m.venueId).toBe('sxbet');
      expect(m.fee).toEqual({ kind: 'profit', rate: '0.01' });
      expect(m.externalId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(m.status).toBe('open');
      expect(m.category).toBeTruthy();
      expect(m.outcomes).toHaveLength(2);
      expect(m.outcomes[0]!.externalId).toBe(`${m.externalId}:1`);
    }
  });

  it('derives Quotes from V3 order book snapshots', async () => {
    const { items } = await adapter.listMarkets({ limit: 30 });
    const ids = items.flatMap((m) => m.outcomes.slice(0, 1).map((o) => o.externalId));

    const books = await adapter.fetchOrderBooks!(ids);
    expect(books).toHaveLength(ids.length);
    books.forEach((b) => OrderBook.parse(b));

    const quotes = await adapter.fetchQuotes(ids);
    quotes.forEach((q) => Quote.parse(q));
    const quoted = quotes.filter((q) => q.bid !== null || q.ask !== null);
    expect(quoted.length).toBeGreaterThan(0);
    for (const q of quoted) {
      expect(q).toMatchObject(
        bookToQuote(books.find((b) => b.outcomeExternalId === q.outcomeExternalId)!),
      );
      if (q.bid !== null && q.ask !== null)
        expect(Number(q.bid)).toBeLessThanOrEqual(Number(q.ask));
    }
  });

  it('omits unknown outcome ids and has no price history', async () => {
    expect(await adapter.fetchQuotes(['not-an-outcome'])).toEqual([]);
    expect(await adapter.fetchPriceHistory('x:1', { interval: '1d' })).toEqual([]);
  });

  it('is read-only and labeled offshore', () => {
    expect(VenueCapabilities.parse(adapter.capabilities)).toMatchObject({
      routable: false,
      realMoney: true,
      regulation: 'offshore',
      restrictedJurisdictions: ['US'],
      orderBook: true,
      priceHistory: false,
    });
    expect(
      adapter.deepLink({
        externalId: '0x1',
        slug: null,
        meta: { sport: 'Football', league: 'NFL' },
      }),
    ).toBe('https://sx.bet/football/nfl');
    expect(adapter.deepLink({ externalId: '0x1', slug: null, meta: {} })).toBe('https://sx.bet');
  });
});

describe('sxbet normalization', () => {
  const now = new Date('2026-10-09T00:00:00Z');
  // Worked example from the SX Bet docs: makers at 52% / 51.5% on one, 46.75% on two.
  const snap = {
    marketHash: '0xabc',
    outcomeOne: [
      { percentageOdds: '52000000000000000000', size: '2000000' },
      { percentageOdds: '50000000000000000000', size: '3000000' },
    ],
    outcomeTwo: [{ percentageOdds: '46750000000000000000', size: '1000000' }],
  };

  it('makers on an outcome bid for it; the other side offers it at 1-p', () => {
    const one = normalizeSxBook('0xabc', 1, snap, now);
    expect(one.bids).toEqual([
      { price: '0.52', size: '3.846153' },
      { price: '0.5', size: '6' },
    ]);
    // 1.00 USDC stake at 46.75%: 2.139037 shares offered at 0.5325 to a taker on outcome one.
    expect(one.asks).toEqual([{ price: '0.5325', size: '2.139037' }]);

    const two = normalizeSxBook('0xabc', 2, snap, now);
    expect(two.bids).toEqual([{ price: '0.4675', size: '2.139037' }]);
    expect(two.asks.map((l) => l.price)).toEqual(['0.48', '0.5']);
  });

  it('drops malformed and out-of-range levels', () => {
    const book = normalizeSxBook(
      '0xabc',
      1,
      {
        marketHash: '0xabc',
        outcomeOne: [
          { percentageOdds: 'x', size: '1' },
          { percentageOdds: '100000000000000000000', size: '1' },
          { percentageOdds: '0', size: '1' },
        ],
        outcomeTwo: [{ percentageOdds: '50000000000000000000', size: '0' }],
      },
      now,
    );
    expect(book.bids).toEqual([]);
    expect(book.asks).toEqual([]);
  });

  it('composes a question and skips malformed or non-CLOB rows', () => {
    const base = {
      marketHash: '0x1',
      status: 'ACTIVE',
      outcomeOneName: 'Over 49.5',
      outcomeTwoName: 'Under 49.5',
      teamOneName: 'Dallas Cowboys',
      teamTwoName: 'Philadelphia Eagles',
      gameTime: 1795728600,
    };
    expect(normalizeSxMarket(base)?.question).toBe(
      'Dallas Cowboys vs Philadelphia Eagles: Over 49.5 vs Under 49.5',
    );
    expect(
      normalizeSxMarket({
        ...base,
        outcomeOneName: 'Dallas Cowboys',
        outcomeTwoName: 'Philadelphia Eagles',
      })?.question,
    ).toBe('Dallas Cowboys vs Philadelphia Eagles');
    expect(normalizeSxMarket({ ...base, status: 'INACTIVE' })?.status).toBe('closed');
    expect(normalizeSxMarket({ ...base, tradingModes: ['RFQ'] })).toBeNull();
    expect(normalizeSxMarket({ nope: 1 })).toBeNull();
  });
});
