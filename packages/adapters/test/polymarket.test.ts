import { bookToQuote } from '@paras/domain';
import { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { createFixtureFetch } from '@paras/testkit';
import { describe, expect, it } from 'vitest';
import { createPolymarketAdapter } from '../src/index.js';
import { normalizeGammaMarket } from '../src/polymarket/normalize.js';
import type { GammaMarket } from '../src/polymarket/raw.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createPolymarketAdapter({
  fetch: createFixtureFetch({ dir: new URL('./fixtures/polymarket/', import.meta.url) }),
  now: () => new Date('2026-10-09T00:00:00Z'),
});

describe('polymarket adapter (fixture replay)', () => {
  it('normalizes Gamma markets into the shared schema', async () => {
    const page = await adapter.listMarkets({ limit: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBe('3');
    for (const m of page.items) {
      expect(NormalizedMarket.parse(m)).toEqual(m);
      expect(m.venueId).toBe('polymarket');
      expect(m.externalId).toMatch(/^0x[0-9a-f]{64}$/);
      expect(m.status).toBe('open');
      expect(m.url).toMatch(/^https:\/\/polymarket\.com\/event\//);
      expect(m.outcomes.map((o) => o.label)).toEqual(['Yes', 'No']);
    }
    // Highest volume first.
    const vols = page.items.map((m) => Number(m.volume));
    expect(vols).toEqual([...vols].sort((a, b) => b - a));
  });

  it('derives Quotes from CLOB order books for an Outcome batch', async () => {
    const [market] = (await adapter.listMarkets({ limit: 3 })).items;
    const tokens = market!.outcomes.map((o) => o.externalId);

    const books = await adapter.fetchOrderBooks!(tokens);
    expect(books.map((b) => OrderBook.parse(b).outcomeExternalId).sort()).toEqual(
      [...tokens].sort(),
    );

    const quotes = await adapter.fetchQuotes(tokens);
    expect(quotes).toHaveLength(2);
    for (const q of quotes) {
      Quote.parse(q);
      const book = books.find((b) => b.outcomeExternalId === q.outcomeExternalId)!;
      expect(q).toMatchObject(bookToQuote(book));
      expect(q.bid).not.toBeNull();
      expect(q.ask).not.toBeNull();
      expect(Number(q.bid)).toBeLessThanOrEqual(Number(q.ask));
    }
    // YES and NO are complementary: YES bid + NO ask is about 1.
    const [yes, no] = tokens.map((t) => quotes.find((q) => q.outcomeExternalId === t)!);
    expect(Number(yes!.bid) + Number(no!.ask)).toBeCloseTo(1, 1);
  });

  it('returns price history oldest first', async () => {
    const [market] = (await adapter.listMarkets({ limit: 3 })).items;
    const history = await adapter.fetchPriceHistory(market!.outcomes[0]!.externalId, {
      interval: '1d',
    });
    expect(history.length).toBeGreaterThan(10);
    history.forEach((p) => PricePoint.parse(p));
    const ts = history.map((p) => p.ts);
    expect(ts).toEqual([...ts].sort());
  });

  it('exposes capabilities and deep links', async () => {
    expect(adapter.capabilities).toMatchObject({ routable: true, regulation: 'offshore' });
    expect(adapter.deepLink({ externalId: 'x', slug: 'm', meta: { eventSlug: 'e' } })).toBe(
      'https://polymarket.com/event/e/m',
    );
    expect(adapter.deepLink({ externalId: 'x', slug: 'e', meta: { eventSlug: 'e' } })).toBe(
      'https://polymarket.com/event/e',
    );
  });
});

describe('normalizeGammaMarket edge cases', () => {
  const base: GammaMarket = {
    question: 'Q?',
    conditionId: '0xabc',
    slug: 'q',
    outcomes: '["Yes","No"]',
    clobTokenIds: '["1","2"]',
    active: true,
    closed: false,
    volume: '12.5',
  };

  it('skips Markets without CLOB tokens or with misaligned outcomes', () => {
    expect(normalizeGammaMarket({ ...base, clobTokenIds: null })).toBeNull();
    expect(normalizeGammaMarket({ ...base, clobTokenIds: '["1"]' })).toBeNull();
    expect(normalizeGammaMarket({ ...base, enableOrderBook: false })).toBeNull();
  });

  it('maps closed and resolved status, fees and volume', () => {
    expect(normalizeGammaMarket({ ...base, closed: true })?.status).toBe('closed');
    expect(
      normalizeGammaMarket({ ...base, closed: true, umaResolutionStatus: 'resolved' })?.status,
    ).toBe('resolved');
    const m = normalizeGammaMarket({
      ...base,
      feesEnabled: true,
      feeSchedule: { rate: 0.05, exponent: 1, takerOnly: true },
    });
    expect(m?.fee).toEqual({ kind: 'curve', rate: '0.05', exponent: 1, takerOnly: true });
    expect(m?.volume).toBe('12.5');
  });
});
