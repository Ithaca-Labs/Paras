import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import {
  normalizeSxBook,
  normalizeSxMarket,
  orderBookToQuote,
  parseOutcomeId,
  SXBET_ID,
  sxbetDeepLink,
} from './normalize.js';
import { SxMarketsPage, SxSnapshot } from './raw.js';

export interface SxBetOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  apiUrl?: string;
  now?: () => Date;
}

/** `pageSize` is capped at 100 by the API. */
const MAX_PAGE = 100;
const CONCURRENCY = 5;

/**
 * SX Bet (sports, SX Network) via its free public REST API (V3 order book, no API key).
 * Read-only: Paras shows Markets and quotes and redirects to sx.bet to trade.
 * Each Market is binary (outcome one / two); a Market's book comes from one snapshot call.
 * V1 polls; the Centrifuge WebSocket can later replace `fetchQuotes` without interface changes.
 */
export function createSxBetAdapter(options: SxBetOptions = {}): VenueAdapter {
  const doFetch = options.fetch ?? fetch;
  const api = (options.apiUrl ?? 'https://api.sx.bet').replace(/\/$/, '');
  const now = options.now ?? (() => new Date());

  async function getJson(path: string): Promise<unknown> {
    const res = await doFetch(`${api}${path}`);
    if (!res.ok) throw new Error(`sxbet ${res.status} GET ${path}`);
    return res.json();
  }

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const wanted = outcomeExternalIds.flatMap((id) => {
      const p = parseOutcomeId(id);
      return p ? [p] : [];
    });
    const hashes = [...new Set(wanted.map((w) => w.hash))];
    const snaps = new Map<string, SxSnapshot['data']>();
    for (let i = 0; i < hashes.length; i += CONCURRENCY) {
      await Promise.all(
        hashes.slice(i, i + CONCURRENCY).map(async (hash) => {
          const q = new URLSearchParams({ marketHash: hash });
          const parsed = SxSnapshot.safeParse(await getJson(`/orderbook-v3/snapshot?${q}`));
          if (parsed.success) snaps.set(hash, parsed.data.data);
        }),
      );
    }
    return wanted.flatMap(({ hash, no }) => {
      const snap = snaps.get(hash);
      return snap ? [normalizeSxBook(hash, no, snap, now())] : [];
    });
  }

  return {
    id: SXBET_ID,
    name: 'SX Bet',
    capabilities: {
      routable: false,
      realMoney: true,
      regulation: 'offshore',
      // Full eligibility matrix lives with jurisdiction gating (#16).
      restrictedJurisdictions: ['US'],
      orderBook: true,
      // SX publishes no price series; only a public trade tape.
      priceHistory: false,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      // /markets/active lists only open Markets, so `status: 'all'` returns the same set.
      const q = new URLSearchParams({
        pageSize: String(Math.min(params.limit ?? MAX_PAGE, MAX_PAGE)),
      });
      if (params.cursor) q.set('paginationKey', params.cursor);
      const { data } = SxMarketsPage.parse(await getJson(`/markets/active?${q}`));
      return {
        items: data.markets.flatMap((row) => {
          const m = normalizeSxMarket(row);
          return m ? [m] : [];
        }),
        nextCursor: data.nextKey || null,
      };
    },

    fetchOrderBooks,

    async fetchQuotes(outcomeExternalIds: readonly string[]): Promise<Quote[]> {
      return (await fetchOrderBooks(outcomeExternalIds)).map(orderBookToQuote);
    },

    async fetchPriceHistory(_id: string, _params: PriceHistoryParams): Promise<PricePoint[]> {
      return [];
    },

    deepLink: sxbetDeepLink,
  };
}
