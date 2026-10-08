import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import {
  LIMITLESS_ID,
  limitlessDeepLink,
  normalizeLimitlessBook,
  normalizeLimitlessHistory,
  normalizeLimitlessRow,
  orderBookToQuote,
  parseOutcomeId,
} from './normalize.js';
import { LimitlessActive, LimitlessBook, LimitlessHistory } from './raw.js';

export interface LimitlessOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  apiUrl?: string;
  now?: () => Date;
}

/** The API rejects `limit` above 25. */
const MAX_PAGE = 25;
const CONCURRENCY = 5;
const HISTORY_INTERVAL: Record<PriceHistoryParams['interval'], string> = {
  '1h': '1h',
  '6h': '6h',
  '1d': '1d',
  '1w': '1w',
  '1m': '1m',
  max: 'all',
};

/**
 * Limitless (Base, CLOB) via its free public REST API. Read-only: Paras shows Markets and
 * quotes and redirects to limitless.exchange to trade. One book per Market (YES token); the NO
 * Outcome is derived as its mirror.
 */
export function createLimitlessAdapter(options: LimitlessOptions = {}): VenueAdapter {
  const doFetch = options.fetch ?? fetch;
  const api = (options.apiUrl ?? 'https://api.limitless.exchange').replace(/\/$/, '');
  const now = options.now ?? (() => new Date());

  /** Null on 404 (unknown Market); throws on any other transport error. */
  async function getJson(path: string): Promise<unknown> {
    const res = await doFetch(`${api}${path}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`limitless ${res.status} GET ${path}`);
    return res.json();
  }

  /** Concurrent map in small batches, preserving input order. */
  async function mapBatched<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      out.push(...(await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))));
    }
    return out;
  }

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const wanted = outcomeExternalIds.flatMap((id) => {
      const p = parseOutcomeId(id);
      return p ? [p] : [];
    });
    const slugs = [...new Set(wanted.map((w) => w.slug))];
    const books = new Map<string, ReturnType<typeof LimitlessBook.parse>>();
    await mapBatched(slugs, async (slug) => {
      const json = await getJson(`/markets/${encodeURIComponent(slug)}/orderbook`);
      const parsed = json == null ? null : LimitlessBook.safeParse(json);
      if (parsed?.success) books.set(slug, parsed.data);
    });
    return wanted.flatMap(({ slug, side }) => {
      const raw = books.get(slug);
      return raw ? [normalizeLimitlessBook(slug, side, raw, now())] : [];
    });
  }

  return {
    id: LIMITLESS_ID,
    name: 'Limitless',
    capabilities: {
      routable: false,
      realMoney: true,
      regulation: 'offshore',
      // Full eligibility matrix lives with jurisdiction gating (#16).
      restrictedJurisdictions: ['US'],
      orderBook: true,
      priceHistory: true,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      // The API only lists active Markets, so `status: 'all'` returns the same set.
      const limit = Math.min(params.limit ?? MAX_PAGE, MAX_PAGE);
      const page = Number(params.cursor ?? 1);
      const q = new URLSearchParams({
        limit: String(limit),
        page: String(page),
        sortBy: 'high_value',
      });
      const json = LimitlessActive.parse(await getJson(`/markets/active?${q}`));
      const total = json.totalMarketsCount ?? Number.POSITIVE_INFINITY;
      return {
        items: json.data.flatMap(normalizeLimitlessRow),
        nextCursor: json.data.length >= limit && page * limit < total ? String(page + 1) : null,
      };
    },

    fetchOrderBooks,

    async fetchQuotes(outcomeExternalIds: readonly string[]): Promise<Quote[]> {
      return (await fetchOrderBooks(outcomeExternalIds)).map(orderBookToQuote);
    },

    async fetchPriceHistory(
      outcomeExternalId: string,
      params: PriceHistoryParams,
    ): Promise<PricePoint[]> {
      const id = parseOutcomeId(outcomeExternalId);
      if (!id) return [];
      const q = new URLSearchParams({ interval: HISTORY_INTERVAL[params.interval] });
      const json = await getJson(`/markets/${encodeURIComponent(id.slug)}/historical-price?${q}`);
      if (json == null) return [];
      return normalizeLimitlessHistory(id.side, LimitlessHistory.parse(json).prices);
    },

    deepLink: limitlessDeepLink,
  };
}
