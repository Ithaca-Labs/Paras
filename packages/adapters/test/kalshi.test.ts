import { bookToQuote } from '@paras/domain';
import { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { createFixtureFetch } from '@paras/testkit';
import { describe, expect, it } from 'vitest';
import { createKalshiAdapter } from '../src/index.js';
import { normalizeKalshiBook, normalizeKalshiMarket } from '../src/kalshi/normalize.js';
import type { KalshiEvent, KalshiMarket } from '../src/kalshi/raw.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createKalshiAdapter({
  fetch: createFixtureFetch({ dir: new URL('./fixtures/kalshi/', import.meta.url) }),
  now: () => new Date('2026-10-09T00:00:00Z'),
});

describe('kalshi adapter (fixture replay)', () => {
  it('normalizes events and nested markets into the shared schema', async () => {
    const page = await adapter.listMarkets({ limit: 5 });
    expect(page.items.length).toBeGreaterThan(0);
    for (const m of page.items) {
      expect(NormalizedMarket.parse(m)).toEqual(m);
      expect(m.venueId).toBe('kalshi');
      expect(m.status).toBe('open');
      expect(m.url).toMatch(/^https:\/\/kalshi\.com\/markets\/[a-z0-9]+\/[a-z0-9-]*\/[a-z0-9-]+$/);
      expect(m.url.endsWith(`/${String(m.meta.eventTicker).toLowerCase()}`)).toBe(true);
      expect(m.outcomes.map((o) => o.label)).toEqual(['Yes', 'No']);
      expect(m.fee).toMatchObject({ kind: 'curve', takerOnly: true });
    }
    // Sorted by volume within the page.
    const vols = page.items.map((m) => Number(m.volume));
    expect(vols).toEqual([...vols].sort((a, b) => b - a));
  });

  it('derives YES and NO Quotes from the order book', async () => {
    const { items } = await adapter.listMarkets({ limit: 5 });
    const ids = items[0]!.outcomes.map((o) => o.externalId);

    const books = await adapter.fetchOrderBooks!(ids);
    expect(books.map((b) => OrderBook.parse(b).outcomeExternalId).sort()).toEqual([...ids].sort());

    const quotes = await adapter.fetchQuotes(ids);
    expect(quotes).toHaveLength(2);
    for (const q of quotes) {
      Quote.parse(q);
      const book = books.find((b) => b.outcomeExternalId === q.outcomeExternalId)!;
      expect(q).toMatchObject(bookToQuote(book));
    }
    const [yes, no] = ids.map((i) => quotes.find((q) => q.outcomeExternalId === i)!);
    // Each side's bid mirrors the other side's ask.
    if (yes!.bid && no!.ask) expect(Number(yes!.bid) + Number(no!.ask)).toBeCloseTo(1, 6);
    if (yes!.ask && no!.bid) expect(Number(yes!.ask) + Number(no!.bid)).toBeCloseTo(1, 6);
  });

  it('returns price history oldest first', async () => {
    const { items } = await adapter.listMarkets({ limit: 5 });
    const history = await adapter.fetchPriceHistory(items[0]!.outcomes[0]!.externalId, {
      interval: '1w',
    });
    expect(history.length).toBeGreaterThan(0);
    history.forEach((p) => PricePoint.parse(p));
    const ts = history.map((p) => p.ts);
    expect(ts).toEqual([...ts].sort());
  });

  it('is read-only, CFTC-regulated and not restricted in the US', () => {
    expect(adapter.capabilities).toMatchObject({
      routable: false,
      realMoney: true,
      regulation: 'cftc_regulated',
      restrictedJurisdictions: [],
    });
    expect(
      adapter.deepLink({
        externalId: 'KXA-1-YES',
        slug: null,
        meta: { seriesTicker: 'KXA', eventTicker: 'KXA-1', urlSlug: 'will-a' },
      }),
    ).toBe('https://kalshi.com/markets/kxa/will-a/kxa-1');
  });
});

describe('normalizers', () => {
  const event: KalshiEvent = {
    event_ticker: 'KXA-1',
    series_ticker: 'KXA',
    title: 'Who wins?',
    category: 'Politics',
    markets: [{}, {}],
  };
  const base: KalshiMarket = {
    ticker: 'KXA-1-X',
    event_ticker: 'KXA-1',
    market_type: 'binary',
    title: 'Will X win?',
    yes_sub_title: 'X',
    status: 'active',
    volume_fp: '1200.50',
  };

  it('maps status, multi-market question and volume; skips scalar markets', () => {
    expect(normalizeKalshiMarket(event, base)).toMatchObject({
      question: 'Who wins?: X',
      status: 'open',
      volume: '1200.50',
      category: 'Politics',
    });
    expect(normalizeKalshiMarket(event, { ...base, status: 'finalized' })?.status).toBe('resolved');
    expect(normalizeKalshiMarket(event, { ...base, market_type: 'scalar' })).toBeNull();
    expect(normalizeKalshiMarket(event, { ...base, status: 'weird' })).toBeNull();
  });

  it('turns NO bids into YES asks and vice versa', () => {
    const [yes, no] = normalizeKalshiBook(
      'T',
      { yes: [['0.40', '10']], no: [['0.55', '20']] },
      '2026-10-09T00:00:00.000Z',
    );
    expect(bookToQuote(yes!)).toMatchObject({ bid: '0.4', ask: '0.45' });
    expect(bookToQuote(no!)).toMatchObject({ bid: '0.55', ask: '0.6' });
  });
});
