import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { makeBook, orderBookToQuote } from '../book.js';
import { toDecimalString } from '../decimal.js';
import { createHttp, strToIso } from '../http.js';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import { ProbableBook, ProbableHistory, ProbableList, ProbableMarket } from './raw.js';

export interface ProbableOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Market metadata host. */
  marketUrl?: string;
  /** Order book and price history host (the metadata host serves neither). */
  bookUrl?: string;
  now?: () => Date;
}

export const PROBABLE_ID = 'probable';
const SITE = 'https://probable.markets';
const MAX_PAGE = 100;
const FIDELITY: Record<PriceHistoryParams['interval'], number> = {
  '1h': 1,
  '6h': 5,
  '1d': 60,
  '1w': 360,
  '1m': 1440,
  max: 1440,
};

const parseJsonArray = (raw: string): string[] | null => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
};

export const probableDeepLink = (m: { slug: string | null; externalId: string }): string =>
  `${SITE}/market/${m.slug ?? m.externalId}`;

export function normalizeProbableMarket(raw: ProbableMarket): NormalizedMarket | null {
  const labels = parseJsonArray(raw.outcomes);
  const tokens = parseJsonArray(raw.clobTokenIds);
  if (!labels || !tokens || labels.length !== tokens.length || tokens.length < 2) return null;
  const slug = raw.market_slug ?? null;
  return {
    venueId: PROBABLE_ID,
    externalId: raw.id,
    slug,
    question: raw.question,
    description: raw.description ?? '',
    resolutionSource: null,
    category: null,
    tags: [],
    status: raw.resolved
      ? 'resolved'
      : raw.closed || raw.archived || raw.active === false
        ? 'closed'
        : 'open',
    endDate: strToIso(raw.endDate),
    // shortcut: the list carries only 24h volume (lifetime is on /events); use it as the ranking signal.
    volume: toDecimalString(raw.volume24hr),
    liquidity: toDecimalString(raw.liquidity),
    imageUrl: raw.icon || null,
    url: probableDeepLink({ slug, externalId: raw.id }),
    fee: { kind: 'none' },
    outcomes: labels.map((label, index) => ({ externalId: tokens[index]!, label, index })),
    meta: { conditionId: raw.condition_id ?? null },
  };
}

/**
 * Probable (BNB Chain CLOB, Polymarket-style API) via its free public API. Market metadata and
 * books/history are served from two hosts. One book per outcome token. Read-only.
 */
export function createProbableAdapter(options: ProbableOptions = {}): VenueAdapter {
  const markets = (
    options.marketUrl ?? 'https://market-api.probable.markets/public/api/v1'
  ).replace(/\/$/, '');
  const books = (options.bookUrl ?? 'https://api.probable.markets/public/api/v1').replace(
    /\/$/,
    '',
  );
  const now = options.now ?? (() => new Date());
  const http = createHttp({ name: 'probable', fetch: options.fetch, minIntervalMs: 100 });

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const out = await http.mapBatched(outcomeExternalIds, async (token) => {
      const json = await http.getJson(`${books}/book?token_id=${encodeURIComponent(token)}`);
      const parsed = json == null ? null : ProbableBook.safeParse(json);
      if (!parsed?.success) return [];
      const b = parsed.data;
      const lv = (ls: typeof b.bids) =>
        ls.map((l) => ({ price: Number(l.price), size: Number(l.size) }));
      const ts = b.timestamp ? new Date(b.timestamp) : now();
      return [
        makeBook(
          token,
          lv(b.bids),
          lv(b.asks),
          b.last_trade_price != null ? Number(b.last_trade_price) : null,
          Number.isNaN(ts.getTime()) ? now() : ts,
        ),
      ];
    });
    return out.flat();
  }

  return {
    id: PROBABLE_ID,
    name: 'Probable',
    capabilities: {
      routable: false,
      realMoney: true,
      regulation: 'offshore',
      restrictedJurisdictions: ['US'],
      orderBook: true,
      priceHistory: true,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      const limit = Math.min(params.limit ?? MAX_PAGE, MAX_PAGE);
      const page = Number(params.cursor ?? 1);
      const q = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (params.status !== 'all') {
        q.set('active', 'true');
        q.set('closed', 'false');
      }
      const json = ProbableList.parse(await http.getJson(`${markets}/markets?${q}`));
      const items = json.markets.flatMap((row) => {
        const raw = ProbableMarket.safeParse(row);
        const m = raw.success ? normalizeProbableMarket(raw.data) : null;
        return m ? [m] : [];
      });
      return { items, nextCursor: json.pagination.hasMore ? String(page + 1) : null };
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
      const json = await http.getJson(`${books}/prices-history?${q}`);
      if (json == null) return [];
      return ProbableHistory.parse(json)
        .history.filter((h) => h.p >= 0 && h.p <= 1)
        .map((h) => ({ ts: new Date(h.t * 1000).toISOString(), price: toDecimalString(h.p) }))
        .sort((a, b) => a.ts.localeCompare(b.ts));
    },

    deepLink: probableDeepLink,
  };
}
