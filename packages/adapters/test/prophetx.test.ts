import { NormalizedMarket, Quote } from '@paras/shared';
import { describe, expect, it } from 'vitest';
import { createProphetXAdapter, longTailAdaptersFromEnv } from '../src/index.js';
import { americanToPrice } from '../src/prophetx/index.js';
import { checkVenue, NOW, stubFetch } from './helpers.js';

// No key was available, so these responses are hand-written from the Market Data API docs
// (docs.prophetx.co/docs/market-data-integration).
const market = {
  id: 555,
  name: 'Moneyline',
  display_name: 'Moneyline',
  type: 'moneyline',
  selections: [
    [
      {
        outcome_id: 1,
        name: 'Patriots',
        price: -110,
        strike: null,
        strike_id: 'line_1',
        quantity: 2100,
      },
    ],
    [
      {
        outcome_id: 2,
        name: 'Jets',
        price: 105,
        strike: null,
        strike_id: 'line_2',
        quantity: 2150,
      },
    ],
  ],
};
const routes = {
  '/affiliate/get_sport_events': {
    data: {
      sport_events: [
        {
          event_id: 101,
          name: 'Patriots vs. Jets',
          sport_name: 'Football',
          scheduled: '2026-10-11T17:00:00Z',
          status: 'scheduled',
          tournament_name: 'NFL',
        },
        {
          event_id: 102,
          name: 'Old game',
          sport_name: 'Football',
          scheduled: '2026-10-01T17:00:00Z',
          status: 'finished',
        },
      ],
    },
  },
  '/v4/affiliate/get_multiple_markets': {
    data: { '101': [market], '102': [{ ...market, id: 556 }] },
  },
};
const adapter = createProphetXAdapter({ apiKey: 'k', fetch: stubFetch(routes), now: NOW });

describe('prophetx adapter (hand-written fixtures)', () => {
  it('meets the Venue adapter contract (buy-only, no book, no history)', async () => {
    const { page, quotes } = await checkVenue(adapter, {
      venueId: 'prophetx',
      url: /^https:\/\/prophetx\.co$/,
    });
    // Finished events are not listed.
    expect(page.items.map((m) => m.externalId)).toEqual(['101:555']);
    expect(page.items[0]!.question).toBe('Patriots vs. Jets: Moneyline');
    expect(adapter.capabilities.orderBook).toBe(false);
    // Only an ask: the implied probability of the American price.
    expect(quotes.map((q) => Quote.parse(q))).toMatchObject([
      { bid: null, ask: '0.52381' },
      { bid: null, ask: '0.487805' },
    ]);
  });

  it('converts American odds to a price', () => {
    expect(americanToPrice(-110)).toBeCloseTo(0.5238, 4);
    expect(americanToPrice(105)).toBeCloseTo(0.4878, 4);
    expect(americanToPrice(100)).toBe(0.5);
    expect(americanToPrice(0)).toBeNull();
    expect(americanToPrice(null)).toBeNull();
  });

  it('accepts the flat-list response variant', async () => {
    const flat = createProphetXAdapter({
      apiKey: 'k',
      fetch: stubFetch({
        ...routes,
        '/v4/affiliate/get_multiple_markets': { data: [{ ...market, event_id: 101 }] },
      }),
    });
    const { items } = await flat.listMarkets();
    expect(items.map((m) => NormalizedMarket.parse(m).externalId)).toEqual(['101:555']);
  });

  it('is only registered when PROPHETX_API_KEY is set', () => {
    const ids = (env: Record<string, string>) => longTailAdaptersFromEnv(env).map((a) => a.id);
    expect(ids({})).not.toContain('prophetx');
    expect(ids({ PROPHETX_API_KEY: 'k' })).toContain('prophetx');
  });
});
