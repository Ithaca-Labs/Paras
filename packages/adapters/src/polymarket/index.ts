import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import {
  normalizeClobBook,
  normalizeGammaMarket,
  normalizeHistory,
  orderBookToQuote,
  polymarketDeepLink,
  POLYMARKET_ID,
} from './normalize.js';
import { ClobBook, ClobBooks, ClobHistory, GammaMarket, GammaMarkets } from './raw.js';

export interface PolymarketOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  gammaUrl?: string;
  clobUrl?: string;
  now?: () => Date;
}

/** Gamma silently caps `limit` at 100. */
const GAMMA_MAX_PAGE = 100;
const BOOKS_BATCH = 100;
/** Default bucket size (minutes) per window, matching what the CLOB accepts. */
const FIDELITY: Record<PriceHistoryParams['interval'], number> = {
  '1h': 1,
  '6h': 5,
  '1d': 60,
  '1w': 360,
  '1m': 1440,
  max: 1440,
};

/**
 * Polymarket via the free public Gamma (metadata) and CLOB (books, history) REST APIs.
 * V1 uses polling; the CLOB WebSocket can slot in behind `fetchQuotes` later.
 */
export function createPolymarketAdapter(options: PolymarketOptions = {}): VenueAdapter {
  const doFetch = options.fetch ?? fetch;
  const gamma = (options.gammaUrl ?? 'https://gamma-api.polymarket.com').replace(/\/$/, '');
  const clob = (options.clobUrl ?? 'https://clob.polymarket.com').replace(/\/$/, '');
  const now = options.now ?? (() => new Date());

  async function getJson(url: string, init?: RequestInit): Promise<unknown> {
    const res = await doFetch(url, init);
    if (!res.ok) throw new Error(`polymarket ${res.status} ${init?.method ?? 'GET'} ${url}`);
    return res.json();
  }

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const out: OrderBook[] = [];
    for (let i = 0; i < outcomeExternalIds.length; i += BOOKS_BATCH) {
      const chunk = outcomeExternalIds.slice(i, i + BOOKS_BATCH);
      const json = ClobBooks.parse(
        await getJson(`${clob}/books`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(chunk.map((token_id) => ({ token_id }))),
        }),
      );
      for (const item of json) {
        const book = ClobBook.safeParse(item);
        if (book.success) out.push(normalizeClobBook(book.data, now()));
      }
    }
    return out;
  }

  return {
    id: POLYMARKET_ID,
    name: 'Polymarket',
    capabilities: {
      routable: true,
      realMoney: true,
      regulation: 'offshore',
      // Full eligibility matrix lives with jurisdiction gating (#16).
      restrictedJurisdictions: ['US'],
      orderBook: true,
      priceHistory: true,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      const limit = Math.min(params.limit ?? 100, GAMMA_MAX_PAGE);
      const offset = Number(params.cursor ?? 0);
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (params.status !== 'all') {
        q.set('active', 'true');
        q.set('closed', 'false');
      }
      q.set('order', 'volumeNum');
      q.set('ascending', 'false');
      const rows = GammaMarkets.parse(await getJson(`${gamma}/markets?${q}`));
      const items = rows.flatMap((row) => {
        const raw = GammaMarket.safeParse(row);
        const market = raw.success ? normalizeGammaMarket(raw.data) : null;
        return market ? [market] : [];
      });
      return { items, nextCursor: rows.length >= limit ? String(offset + limit) : null };
    },

    fetchOrderBooks,

    async fetchQuotes(outcomeExternalIds: readonly string[]): Promise<Quote[]> {
      return (await fetchOrderBooks(outcomeExternalIds)).map(orderBookToQuote);
    },

    async fetchPriceHistory(
      outcomeExternalId: string,
      params: PriceHistoryParams,
    ): Promise<PricePoint[]> {
      const q = new URLSearchParams({
        market: outcomeExternalId,
        interval: params.interval,
        fidelity: String(params.fidelityMinutes ?? FIDELITY[params.interval]),
      });
      const json = ClobHistory.parse(await getJson(`${clob}/prices-history?${q}`));
      return normalizeHistory(json.history);
    },

    deepLink: polymarketDeepLink,
  };
}
