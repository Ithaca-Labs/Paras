import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { mirrorBook, orderBookToQuote } from '../book.js';
import { toDecimalString } from '../decimal.js';
import { complement, createHttp } from '../http.js';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import { PredictBook, PredictList, PredictMarket, PredictSeries } from './raw.js';

export interface PredictFunOptions {
  /** Required on mainnet (request one in their Discord); the testnet host needs none. */
  apiKey?: string;
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  apiUrl?: string;
  now?: () => Date;
}

export const PREDICTFUN_ID = 'predict-fun';
const SITE = 'https://predict.fun';
const MAX_PAGE = 150;
/** [bucket, window seconds]; the API takes 5m | 1h | 1d | 1w buckets. */
const SERIES: Record<PriceHistoryParams['interval'], [string, number]> = {
  '1h': ['5m', 3600],
  '6h': ['5m', 21_600],
  '1d': ['1h', 86_400],
  '1w': ['1h', 604_800],
  '1m': ['1d', 2_592_000],
  max: ['1d', 31_536_000],
};

type Side = 'yes' | 'no';
const outcomeId = (market: number | string, side: Side) => `${market}:${side}`;
function parseOutcomeId(id: string): { market: string; side: Side } | null {
  const i = id.lastIndexOf(':');
  const side = id.slice(i + 1);
  return i > 0 && (side === 'yes' || side === 'no') ? { market: id.slice(0, i), side } : null;
}

export const predictFunDeepLink = (m: {
  externalId: string;
  meta: Record<string, unknown>;
}): string =>
  typeof m.meta.categorySlug === 'string' ? `${SITE}/market/${m.meta.categorySlug}` : SITE;

export function normalizePredictMarket(raw: PredictMarket): NormalizedMarket | null {
  const yes = raw.outcomes.find((o) => o.indexSet === 1);
  const no = raw.outcomes.find((o) => o.indexSet === 2);
  if (!yes || !no) return null;
  const meta = {
    categorySlug: raw.categorySlug ?? null,
    conditionId: raw.conditionId ?? null,
    negRisk: raw.isNegRisk ?? false,
    decimalPrecision: raw.decimalPrecision ?? 2,
  };
  const externalId = String(raw.id);
  return {
    venueId: PREDICTFUN_ID,
    externalId,
    slug: raw.categorySlug ?? null,
    question: raw.question || raw.title,
    description: raw.description ?? '',
    resolutionSource: null,
    category: null,
    tags: [],
    status:
      raw.status === 'RESOLVED' ? 'resolved' : raw.tradingStatus === 'OPEN' ? 'open' : 'closed',
    endDate: null,
    volume: toDecimalString(raw.stats?.volumeTotalUsd),
    liquidity: toDecimalString(raw.stats?.totalLiquidityUsd),
    imageUrl: raw.imageUrl || null,
    url: predictFunDeepLink({ externalId, meta }),
    fee: { kind: 'none' },
    outcomes: [
      { externalId: outcomeId(raw.id, 'yes'), label: yes.name, index: 0 },
      { externalId: outcomeId(raw.id, 'no'), label: no.name, index: 1 },
    ],
    meta,
  };
}

/**
 * Predict.fun (Blast/BNB CLOB) via its REST API. Needs an API key on mainnet
 * (`PREDICTFUN_API_KEY`, 240 req/min); testnet is keyless. One book per Market (YES side); the NO
 * Outcome is its mirror. Read-only.
 */
export function createPredictFunAdapter(options: PredictFunOptions = {}): VenueAdapter {
  const api = (options.apiUrl ?? 'https://api.predict.fun').replace(/\/$/, '');
  const now = options.now ?? (() => new Date());
  const http = createHttp({
    name: 'predict-fun',
    fetch: options.fetch,
    minIntervalMs: 260,
    headers: options.apiKey ? { 'x-api-key': options.apiKey } : undefined,
  });

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const wanted = outcomeExternalIds.flatMap((id) => {
      const p = parseOutcomeId(id);
      return p ? [p] : [];
    });
    const markets = [...new Set(wanted.map((w) => w.market))];
    const raw = new Map<string, PredictBook['data']>();
    await http.mapBatched(markets, async (m) => {
      const json = await http.getJson(`${api}/v1/markets/${encodeURIComponent(m)}/orderbook`);
      const parsed = json == null ? null : PredictBook.safeParse(json);
      if (parsed?.success) raw.set(m, parsed.data.data);
    });
    const lv = (ls: [number, number][]) => ls.map(([price, size]) => ({ price, size }));
    return wanted.flatMap(({ market, side }) => {
      const b = raw.get(market);
      if (!b) return [];
      const settled = b.lastOrderSettled;
      const price = settled ? Number(settled.price) : null;
      // `lastOrderSettled.price` is quoted for its own outcome; restate it for YES.
      const yesLast = price === null ? null : settled?.outcome === 'No' ? complement(price) : price;
      return [mirrorBook(outcomeId(market, side), side, lv(b.bids), lv(b.asks), yesLast, now())];
    });
  }

  return {
    id: PREDICTFUN_ID,
    name: 'Predict.fun',
    capabilities: {
      routable: false,
      realMoney: true,
      regulation: 'offshore',
      restrictedJurisdictions: ['US'],
      orderBook: true,
      priceHistory: true,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      const q = new URLSearchParams({
        first: String(Math.min(params.limit ?? MAX_PAGE, MAX_PAGE)),
        sort: 'VOLUME_TOTAL_DESC',
      });
      if (params.status !== 'all') q.set('status', 'OPEN');
      if (params.cursor) q.set('after', params.cursor);
      const json = PredictList.parse(await http.getJson(`${api}/v1/markets?${q}`));
      const items = json.data.flatMap((row) => {
        const raw = PredictMarket.safeParse(row);
        const m = raw.success ? normalizePredictMarket(raw.data) : null;
        return m ? [m] : [];
      });
      return { items, nextCursor: json.data.length && json.cursor ? json.cursor : null };
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
      const [resolution, window] = SERIES[params.interval];
      const q = new URLSearchParams({
        metric: 'chance',
        resolution,
        from: String(Math.floor(now().getTime() / 1000) - window),
        limit: '1000',
      });
      const json = await http.getJson(
        `${api}/v1/markets/${encodeURIComponent(id.market)}/timeseries?${q}`,
      );
      if (json == null) return [];
      return PredictSeries.parse(json)
        .data.series.map((p) => ({
          ts: new Date(p.x * 1000).toISOString(),
          chance: Math.min(Math.max(p.y / 100, 0), 1),
        }))
        .map((p) => ({
          ts: p.ts,
          price: toDecimalString(id.side === 'yes' ? p.chance : complement(p.chance)),
        }))
        .sort((a, b) => a.ts.localeCompare(b.ts));
    },

    deepLink: predictFunDeepLink,
  };
}
