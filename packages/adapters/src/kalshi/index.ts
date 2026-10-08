import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import {
  KALSHI_ID,
  kalshiDeepLink,
  normalizeCandles,
  normalizeKalshiBook,
  normalizeKalshiMarket,
  orderBookToQuote,
  parseOutcomeId,
} from './normalize.js';
import {
  KalshiCandles,
  KalshiEvent,
  KalshiEventDetail,
  KalshiEvents,
  KalshiMarket,
  KalshiMarketDetail,
  KalshiOrderBook,
} from './raw.js';

export interface KalshiOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
}

/** Kalshi caps `/events` at 200 per page. */
const MAX_PAGE = 200;
/** Public reads are rate limited (about 20/s); keep book fetches gentle. */
const BOOK_CONCURRENCY = 5;

const WINDOW_MS: Record<PriceHistoryParams['interval'], number> = {
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
  '1m': 30 * 86_400_000,
  max: 365 * 86_400_000,
};
/** Candle sizes Kalshi supports, in minutes. */
const PERIODS = [1, 60, 1440];
const DEFAULT_PERIOD: Record<PriceHistoryParams['interval'], number> = {
  '1h': 1,
  '6h': 1,
  '1d': 60,
  '1w': 60,
  '1m': 1440,
  max: 1440,
};

/**
 * Kalshi via the free, unauthenticated public market data API. Read-only: Kalshi Markets show
 * Quotes and "Bet on Kalshi" redirects to the Kalshi site. No order placement lives here.
 *
 * Kalshi has no volume ordering, so `listMarkets` sorts within each page only. Volume is
 * reported in contracts (US$1 notional each), as the Kalshi site shows it.
 */
export function createKalshiAdapter(options: KalshiOptions = {}): VenueAdapter {
  const doFetch = options.fetch ?? fetch;
  const base = (options.baseUrl ?? 'https://api.elections.kalshi.com/trade-api/v2').replace(
    /\/$/,
    '',
  );
  const now = options.now ?? (() => new Date());
  const seriesByMarket = new Map<string, string>();

  async function getJson(path: string): Promise<unknown> {
    const url = `${base}${path}`;
    const res = await doFetch(url);
    if (!res.ok) throw new Error(`kalshi ${res.status} GET ${url}`);
    return res.json();
  }

  async function booksFor(ticker: string): Promise<OrderBook[]> {
    const url = `${base}/markets/${encodeURIComponent(ticker)}/orderbook`;
    const res = await doFetch(url);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`kalshi ${res.status} GET ${url}`);
    const parsed = KalshiOrderBook.safeParse(await res.json());
    if (!parsed.success) return [];
    const { yes_dollars, no_dollars } = parsed.data.orderbook_fp;
    return normalizeKalshiBook(
      ticker,
      { yes: yes_dollars ?? [], no: no_dollars ?? [] },
      now().toISOString(),
    );
  }

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const wanted = new Set(outcomeExternalIds);
    const tickers = [
      ...new Set(outcomeExternalIds.flatMap((id) => parseOutcomeId(id)?.ticker ?? [])),
    ];
    const out: OrderBook[] = [];
    for (let i = 0; i < tickers.length; i += BOOK_CONCURRENCY) {
      const chunk = await Promise.all(tickers.slice(i, i + BOOK_CONCURRENCY).map(booksFor));
      for (const b of chunk.flat()) if (wanted.has(b.outcomeExternalId)) out.push(b);
    }
    return out;
  }

  /** Candlesticks are keyed by series, which a market only reaches through its event. */
  async function seriesTicker(ticker: string): Promise<string> {
    const cached = seriesByMarket.get(ticker);
    if (cached) return cached;
    const { market } = KalshiMarketDetail.parse(
      await getJson(`/markets/${encodeURIComponent(ticker)}`),
    );
    const { event } = KalshiEventDetail.parse(
      await getJson(`/events/${encodeURIComponent(market.event_ticker)}`),
    );
    if (!event.series_ticker) throw new Error(`kalshi: no series for ${ticker}`);
    seriesByMarket.set(ticker, event.series_ticker);
    return event.series_ticker;
  }

  return {
    id: KALSHI_ID,
    name: 'Kalshi',
    capabilities: {
      routable: false,
      realMoney: true,
      regulation: 'cftc_regulated',
      // US-regulated exchange: US users can trade there. Per-country limits live in the eligibility matrix (#16).
      restrictedJurisdictions: [],
      orderBook: true,
      priceHistory: true,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      const q = new URLSearchParams({
        limit: String(Math.min(params.limit ?? MAX_PAGE, MAX_PAGE)),
        with_nested_markets: 'true',
      });
      if (params.status !== 'all') q.set('status', 'open');
      if (params.cursor) q.set('cursor', params.cursor);
      const page = KalshiEvents.parse(await getJson(`/events?${q}`));
      const items = page.events.flatMap((e) => {
        const event = KalshiEvent.safeParse(e);
        if (!event.success) return [];
        return (event.data.markets ?? []).flatMap((m) => {
          const raw = KalshiMarket.safeParse(m);
          const market = raw.success ? normalizeKalshiMarket(event.data, raw.data) : null;
          if (!market) return [];
          return params.status === 'all' || market.status === 'open' ? [market] : [];
        });
      });
      items.sort((a, b) => Number(b.volume) - Number(a.volume));
      return { items, nextCursor: page.cursor || null };
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
      const period = params.fidelityMinutes
        ? (PERIODS.find((p) => p >= params.fidelityMinutes!) ?? 1440)
        : DEFAULT_PERIOD[params.interval];
      const end = Math.floor(now().getTime() / 1000);
      const start = end - Math.floor(WINDOW_MS[params.interval] / 1000);
      const series = await seriesTicker(id.ticker);
      const q = new URLSearchParams({
        start_ts: String(start),
        end_ts: String(end),
        period_interval: String(period),
      });
      const json = KalshiCandles.parse(
        await getJson(
          `/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(id.ticker)}/candlesticks?${q}`,
        ),
      );
      return normalizeCandles(json.candlesticks, id.side);
    },

    deepLink: kalshiDeepLink,
  };
}
