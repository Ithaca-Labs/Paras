import { OrderBook } from '@paras/shared';
import { describe, expect, it } from 'vitest';
import { createMyriadAdapter } from '../src/index.js';
import { checkVenue, fixtures, NOW, stubFetch } from './helpers.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createMyriadAdapter({ fetch: fixtures('myriad'), now: NOW });

describe('myriad adapter (fixture replay)', () => {
  it('meets the Venue adapter contract (AMM Markets: listed price, depth 0)', async () => {
    const { quotes } = await checkVenue(adapter, {
      venueId: 'myriad',
      // Points Markets crowd the top of the volume sort, so read the whole open set (72).
      limit: 100,
      url: /^https:\/\/myriad\.markets\/markets\//,
      history: true,
    });
    expect(quotes.every((q) => q.bidDepth === '0' && q.askDepth === '0')).toBe(true);
  });

  it('skips points (PTS) Markets: they are play money', async () => {
    const row = (id: number, symbol: string) => ({
      id,
      networkId: 56,
      slug: `m${id}`,
      title: `M${id}`,
      state: 'open',
      token: { symbol },
      outcomes: [
        { id: 0, title: 'Yes', price: 0.4 },
        { id: 1, title: 'No', price: 0.6 },
      ],
    });
    const mixed = createMyriadAdapter({
      fetch: stubFetch({
        '/markets?': { data: [row(1, 'PTS'), row(2, 'USDT')], pagination: { hasNext: false } },
      }),
    });
    const { items } = await mixed.listMarkets();
    expect(items.map((m) => m.externalId)).toEqual(['56:2']);
  });
});

// No order-book Market is live on Myriad today: shapes below are from the docs
// (docs.myriad.markets, GET /markets/:id/orderbook; prices and amounts are 1e18-scaled).
describe('myriad order-book Markets (hand-written from docs)', () => {
  const market = {
    id: 7,
    networkId: 56,
    slug: 'ob-market',
    title: 'Will it?',
    state: 'open',
    tradingModel: 'ob',
    token: { symbol: 'USDT' },
    outcomes: [
      { id: 0, title: 'Yes', price: 0.5 },
      { id: 1, title: 'No', price: 0.5 },
    ],
  };
  const ob = createMyriadAdapter({
    now: NOW,
    fetch: stubFetch({
      '/markets/7/orderbook?network_id=56&outcome=0': {
        bids: [
          ['500000000000000000', '3000000000000000000'],
          ['490000000000000000', '1500000000000000000'],
        ],
        asks: [['510000000000000000', '2000000000000000000']],
      },
      '/markets/7?network_id=56': market,
    }),
  });

  it('reads depth from the book', async () => {
    const [book] = await ob.fetchOrderBooks!(['56:7:0']);
    expect(OrderBook.parse(book)).toMatchObject({
      bids: [
        { price: '0.5', size: '3' },
        { price: '0.49', size: '1.5' },
      ],
      asks: [{ price: '0.51', size: '2' }],
    });
    const [q] = await ob.fetchQuotes(['56:7:0']);
    expect(q).toMatchObject({ bid: '0.5', ask: '0.51', bidDepth: '2.235', askDepth: '1.02' });
  });
});
