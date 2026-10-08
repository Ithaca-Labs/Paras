import { NormalizedMarket, PricePoint, Quote } from '@paras/shared';
import { createFixtureFetch } from '@paras/testkit';
import { describe, expect, it } from 'vitest';
import { createPolyRouterAdapters, polyRouterAdaptersFromEnv } from '../src/index.js';

// Fixtures are hand-written from the documented PolyRouter v2 shapes (docs.polyrouter.io), because
// recording needs a PolyRouter API key. With a key: POLYROUTER_API_KEY=... RECORD_FIXTURES=1
// pnpm --filter @paras/adapters test (see the hitl follow-up on live verification).
const fetchFixture = createFixtureFetch({
  dir: new URL('./fixtures/polyrouter/', import.meta.url),
});

const make = (opts: Partial<Parameters<typeof createPolyRouterAdapters>[0]> = {}) =>
  createPolyRouterAdapters({
    apiKey: 'test-key',
    fetch: fetchFixture,
    minIntervalMs: 0,
    now: () => new Date('2026-10-09T00:00:00Z'),
    ...opts,
  });
const venue = (id: string, opts?: Parameters<typeof make>[0]) =>
  make(opts).find((a) => a.id === id)!;

describe('polyrouter fan-out', () => {
  it('yields one Venue per long-tail platform, never the natively covered ones', () => {
    const ids = make().map((a) => a.id);
    expect(ids.sort()).toEqual(
      ['myriad', 'novig', 'opinion', 'polymarket-us', 'predict-fun', 'prophetx'].sort(),
    );
    for (const native of ['polymarket', 'kalshi', 'limitless', 'sx-bet', 'sxbet']) {
      expect(ids).not.toContain(native);
    }
  });

  it('excludes play-money Manifold by default and labels it when opted in', () => {
    expect(make().map((a) => a.id)).not.toContain('manifold');
    const manifold = venue('manifold', { includePlayMoney: true });
    expect(manifold.capabilities).toMatchObject({ realMoney: false, regulation: 'play_money' });
  });

  it('gives every Venue regulation and read-only capabilities', () => {
    for (const a of make({ includePlayMoney: true })) {
      expect(a.capabilities.routable).toBe(false);
      expect(a.capabilities.regulation).toMatch(/^(cftc_regulated|offshore|play_money|unknown)$/);
    }
    expect(venue('polymarket-us').capabilities).toMatchObject({
      regulation: 'cftc_regulated',
      restrictedJurisdictions: [],
    });
    expect(venue('myriad').capabilities).toMatchObject({
      regulation: 'offshore',
      restrictedJurisdictions: ['US'],
    });
  });

  it('restricts to named Venues', () => {
    expect(make({ venues: ['novig'] }).map((a) => a.id)).toEqual(['novig']);
  });
});

describe('polyrouter adapter (fixture replay)', () => {
  it('normalizes Markets, skips malformed and foreign-platform rows, orders by volume', async () => {
    const page = await venue('novig').listMarkets();
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((m) => m.externalId)).toEqual(['NVG-2', 'NVG-1']);
    for (const m of page.items) {
      expect(NormalizedMarket.parse(m)).toEqual(m);
      expect(m.venueId).toBe('novig');
      expect(m.status).toBe('open');
      expect(m.url).toBe(`https://novig.example/markets/${m.externalId.toLowerCase()}`);
      expect(m.outcomes.map((o) => o.label)).toEqual(['Yes', 'No']);
      expect(m.outcomes[0]!.externalId).toBe(`${m.externalId}:yes`);
    }
  });

  it('pages with PolyRouter cursors', async () => {
    const myriad = venue('myriad');
    const first = await myriad.listMarkets();
    expect(first.items.map((m) => m.externalId)).toEqual(['MYR-1']);
    expect(first.nextCursor).toBe('cur2');
    const second = await myriad.listMarkets({ cursor: first.nextCursor! });
    expect(second.items.map((m) => m.externalId)).toEqual(['MYR-2']);
    expect(second.nextCursor).toBeNull();
  });

  it('builds Quotes from current prices, omitting unknown Outcomes', async () => {
    const quotes = await venue('novig').fetchQuotes(['NVG-1:yes', 'NVG-1:no', 'NOPE:yes']);
    expect(quotes).toHaveLength(2);
    quotes.forEach((q) => Quote.parse(q));
    const yes = quotes.find((q) => q.outcomeExternalId === 'NVG-1:yes')!;
    expect(yes).toMatchObject({
      bid: '0.3',
      ask: '0.32',
      last: '0.31',
      bidDepth: '0',
      askDepth: '0',
      observedAt: '2026-10-09T00:00:00.000Z',
    });
  });

  it('returns price history for one Outcome, oldest first', async () => {
    const history = await venue('novig').fetchPriceHistory('NVG-1:yes', { interval: '1d' });
    expect(history).toHaveLength(4);
    history.forEach((p) => PricePoint.parse(p));
    expect(history.map((p) => p.ts)).toEqual([...history.map((p) => p.ts)].sort());
    expect(history.map((p) => p.price)).toEqual(['0.3', '0.31', '0.32', '0.33']);
  });

  it('deep-links to the Venue Market, falling back to the Venue site', () => {
    const novig = venue('novig');
    expect(
      novig.deepLink({ externalId: 'x', slug: null, meta: { sourceUrl: 'https://n.example/x' } }),
    ).toBe('https://n.example/x');
    expect(novig.deepLink({ externalId: 'x', slug: null, meta: {} })).toBe('https://novig.us');
  });

  it('sends the API key and throws on transport errors', async () => {
    const seen: string[] = [];
    const down = make({
      fetch: async (_url, init) => {
        seen.push(new Headers(init?.headers).get('x-api-key') ?? '');
        return new Response('upstream down', { status: 503 });
      },
    }).find((a) => a.id === 'novig')!;
    await expect(down.listMarkets()).rejects.toThrow(/polyrouter 503/);
    await expect(down.fetchQuotes(['NVG-1:yes'])).rejects.toThrow(/polyrouter 503/);
    expect(seen).toEqual(['test-key', 'test-key']);
  });
});

describe('polyRouterAdaptersFromEnv (feature flag)', () => {
  it('is off by default', () => {
    expect(polyRouterAdaptersFromEnv({})).toEqual([]);
    expect(polyRouterAdaptersFromEnv({ POLYROUTER_API_KEY: 'k' })).toEqual([]);
    expect(
      polyRouterAdaptersFromEnv({ POLYROUTER_ENABLED: 'false', POLYROUTER_API_KEY: 'k' }),
    ).toEqual([]);
  });

  it('requires an API key when enabled', () => {
    expect(() => polyRouterAdaptersFromEnv({ POLYROUTER_ENABLED: 'true' })).toThrow(
      /POLYROUTER_API_KEY/,
    );
  });

  it('builds the long-tail Venues when enabled, Manifold only on opt-in', () => {
    const on = { POLYROUTER_ENABLED: 'true', POLYROUTER_API_KEY: 'k' };
    expect(polyRouterAdaptersFromEnv(on)).toHaveLength(6);
    const withPlay = polyRouterAdaptersFromEnv({ ...on, POLYROUTER_INCLUDE_PLAY_MONEY: 'true' });
    expect(withPlay.map((a) => a.id)).toContain('manifold');
  });
});
