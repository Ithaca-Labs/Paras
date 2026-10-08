import { bookToQuote, type BookInput } from '@paras/domain';
import type {
  NormalizedMarket,
  OrderBook,
  PricePoint,
  Quote,
  VenueCapabilities,
} from '@paras/shared';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from './types.js';

export interface FakeAdapterOptions {
  id?: string;
  name?: string;
  capabilities?: Partial<VenueCapabilities>;
  markets?: NormalizedMarket[];
  /** Clock for `observedAt`; defaults to the real time. */
  now?: () => Date;
}

export interface FakeAdapter extends VenueAdapter {
  /** Replace the order book for an Outcome; the next `fetchQuotes` reflects it. */
  setBook(outcomeExternalId: string, book: BookInput): void;
  setMarkets(markets: NormalizedMarket[]): void;
}

/** A valid binary YES/NO Market for tests. Outcome ids are `<externalId>-yes` / `<externalId>-no`. */
export function fakeMarket(
  externalId: string,
  overrides: Partial<NormalizedMarket> = {},
): NormalizedMarket {
  return {
    venueId: 'fake-venue',
    externalId,
    slug: externalId,
    question: `Will ${externalId} happen?`,
    description: 'Resolves YES if it happens.',
    resolutionSource: null,
    category: null,
    tags: [],
    status: 'open',
    endDate: '2027-01-01T00:00:00.000Z',
    volume: '1000',
    liquidity: '500',
    imageUrl: null,
    url: `https://fake.example/${externalId}`,
    fee: { kind: 'none' },
    outcomes: [
      { externalId: `${externalId}-yes`, label: 'Yes', index: 0 },
      { externalId: `${externalId}-no`, label: 'No', index: 1 },
    ],
    meta: {},
    ...overrides,
  };
}

/** In-memory Venue for tests of the API, worker and later slices. Same contract as real adapters. */
export function createFakeAdapter(options: FakeAdapterOptions = {}): FakeAdapter {
  const id = options.id ?? 'fake-venue';
  const now = options.now ?? (() => new Date());
  let markets = options.markets ?? [];
  const books = new Map<string, BookInput>();

  const book = (outcomeExternalId: string): OrderBook | null => {
    const b = books.get(outcomeExternalId);
    if (!b) return null;
    return {
      outcomeExternalId,
      bids: [...b.bids],
      asks: [...b.asks],
      lastTradePrice: b.lastTradePrice ?? null,
      observedAt: now().toISOString(),
    };
  };

  return {
    id,
    name: options.name ?? 'Fake Venue',
    capabilities: {
      routable: false,
      realMoney: true,
      regulation: 'unknown',
      restrictedJurisdictions: [],
      orderBook: true,
      priceHistory: true,
      ...options.capabilities,
    },
    setBook: (outcomeExternalId, b) => void books.set(outcomeExternalId, b),
    setMarkets: (next) => void (markets = next),
    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      const start = Number(params.cursor ?? 0);
      const limit = params.limit ?? 100;
      const all = params.status === 'all' ? markets : markets.filter((m) => m.status === 'open');
      const items = all.slice(start, start + limit);
      return { items, nextCursor: start + limit < all.length ? String(start + limit) : null };
    },
    async fetchOrderBooks(ids): Promise<OrderBook[]> {
      return ids.flatMap((i) => book(i) ?? []);
    },
    async fetchQuotes(ids): Promise<Quote[]> {
      return ids.flatMap((i) => {
        const b = book(i);
        return b ? [{ outcomeExternalId: i, ...bookToQuote(b), observedAt: b.observedAt }] : [];
      });
    },
    async fetchPriceHistory(_id: string, _params: PriceHistoryParams): Promise<PricePoint[]> {
      return [];
    },
    deepLink: (m) => `https://fake.example/${m.externalId}`,
  };
}
