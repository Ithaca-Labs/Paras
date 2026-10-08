import { bookToQuote } from '@paras/domain';
import { NormalizedMarket, OrderBook, PricePoint, Quote, VenueCapabilities } from '@paras/shared';
import { createFixtureFetch } from '@paras/testkit';
import { describe, expect, it } from 'vitest';
import { createLimitlessAdapter } from '../src/index.js';
import { normalizeLimitlessBook, normalizeLimitlessRow } from '../src/limitless/normalize.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createLimitlessAdapter({
  fetch: createFixtureFetch({ dir: new URL('./fixtures/limitless/', import.meta.url) }),
  now: () => new Date('2026-10-09T00:00:00Z'),
});

describe('limitless adapter (fixture replay)', () => {
  it('normalizes active Markets into the shared schema, expanding groups', async () => {
    const page = await adapter.listMarkets({ limit: 25 });
    expect(page.items.length).toBeGreaterThan(5);
    expect(page.nextCursor).toBe('2');
    for (const m of page.items) {
      expect(NormalizedMarket.parse(m)).toEqual(m);
      expect(m.venueId).toBe('limitless');
      expect(m.fee.kind).toBe('tiered');
      expect(['open', 'resolved']).toContain(m.status);
      expect(m.url).toMatch(/^https:\/\/limitless\.exchange\/markets\//);
      expect(m.outcomes.map((o) => o.label)).toEqual(['Yes', 'No']);
    }
    // Resolved group children are kept with their status.
    expect(page.items.some((m) => m.status === 'resolved')).toBe(true);
    // Group children carry the parent question and link to the group page.
    const child = page.items.find((m) => m.meta.groupSlug);
    expect(child?.question).toContain(': ');
    expect(child?.url).toBe(`https://limitless.exchange/markets/${child?.meta.groupSlug}`);
  });

  it('derives complementary Quotes from the YES order book', async () => {
    const [market] = (await adapter.listMarkets({ limit: 25 })).items.filter(
      (m) => !m.meta.groupSlug,
    );
    const [yesId, noId] = market!.outcomes.map((o) => o.externalId) as [string, string];

    const books = await adapter.fetchOrderBooks!([yesId, noId]);
    expect(books.map((b) => OrderBook.parse(b).outcomeExternalId)).toEqual([yesId, noId]);

    const quotes = await adapter.fetchQuotes([yesId, noId]);
    quotes.forEach((q) => Quote.parse(q));
    const [yes, no] = quotes as [Quote, Quote];
    expect(yes).toMatchObject(bookToQuote(books[0]!));
    expect(Number(yes.bid)).toBeLessThanOrEqual(Number(yes.ask));
    // NO is the mirror of YES: NO ask = 1 - YES bid, NO bid = 1 - YES ask.
    expect(Number(no.ask)).toBeCloseTo(1 - Number(yes.bid), 6);
    expect(Number(no.bid)).toBeCloseTo(1 - Number(yes.ask), 6);
    expect(Number(yes.bidDepth)).toBeGreaterThan(0);
  });

  it('returns price history oldest first, mirrored for NO', async () => {
    const [market] = (await adapter.listMarkets({ limit: 25 })).items.filter(
      (m) => !m.meta.groupSlug,
    );
    const [yesId, noId] = market!.outcomes.map((o) => o.externalId) as [string, string];
    const yes = await adapter.fetchPriceHistory(yesId, { interval: '1d' });
    const no = await adapter.fetchPriceHistory(noId, { interval: '1d' });
    expect(yes.length).toBeGreaterThan(5);
    yes.forEach((p) => PricePoint.parse(p));
    expect(yes.map((p) => p.ts)).toEqual(yes.map((p) => p.ts).sort());
    expect(Number(no[0]!.price)).toBeCloseTo(1 - Number(yes[0]!.price), 6);
  });

  it('is read-only and labeled offshore', () => {
    expect(VenueCapabilities.parse(adapter.capabilities)).toMatchObject({
      routable: false,
      realMoney: true,
      regulation: 'offshore',
      restrictedJurisdictions: ['US'],
      orderBook: true,
    });
    expect(adapter.deepLink({ externalId: 'abc', slug: 'abc', meta: {} })).toBe(
      'https://limitless.exchange/markets/abc',
    );
  });
});

describe('limitless normalization edge cases', () => {
  const row = {
    slug: 'm',
    title: 'Q?',
    tradeType: 'clob',
    status: 'FUNDED',
    volume: '1500000',
    collateralToken: { decimals: 6 },
    tokens: { yes: '1', no: '2' },
  };

  it('skips AMM Markets, rows without tokens and malformed rows', () => {
    expect(normalizeLimitlessRow({ ...row, tradeType: 'amm' })).toEqual([]);
    expect(normalizeLimitlessRow({ ...row, tokens: null })).toEqual([]);
    expect(normalizeLimitlessRow({ nope: true })).toEqual([]);
  });

  it('scales raw volume, maps status', () => {
    expect(normalizeLimitlessRow(row)[0]?.volume).toBe('1.5');
    expect(normalizeLimitlessRow({ ...row, expired: true })[0]?.status).toBe('closed');
    expect(normalizeLimitlessRow({ ...row, winningOutcomeIndex: 0 })[0]?.status).toBe('resolved');
  });

  it('mirrors the NO book and drops degenerate levels', () => {
    const raw = {
      bids: [
        { price: 0.4, size: 2_000_000 },
        { price: 0, size: 5 },
      ],
      asks: [{ price: 0.45, size: 1_000_000 }],
      lastTradePrice: 0.42,
    };
    const no = normalizeLimitlessBook('m', 'no', raw, new Date('2026-10-09T00:00:00Z'));
    expect(no.bids).toEqual([{ price: '0.55', size: '1' }]);
    expect(no.asks).toEqual([{ price: '0.6', size: '2' }]);
    expect(no.lastTradePrice).toBe('0.58');
  });
});
