import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { makeBook, orderBookToQuote } from '../book.js';
import { toDecimalString } from '../decimal.js';
import { createHttp, msToIso } from '../http.js';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import { OpinionBook, OpinionHistory, OpinionList, OpinionMarket } from './raw.js';

export interface OpinionOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  apiUrl?: string;
  now?: () => Date;
}

export const OPINION_ID = 'opinion';
const SITE = 'https://app.opinion.trade';
/** The API caps `limit` at 20. */
const MAX_PAGE = 20;
const WINDOW_S: Record<PriceHistoryParams['interval'], number> = {
  '1h': 3600,
  '6h': 21_600,
  '1d': 86_400,
  '1w': 604_800,
  '1m': 2_592_000,
  max: 0,
};
/** Opinion's own `interval` is the bucket size (`1m` = one minute), not the window. */
const BUCKET: Record<PriceHistoryParams['interval'], string> = {
  '1h': '1m',
  '6h': '1h',
  '1d': '1h',
  '1w': '1d',
  '1m': '1d',
  max: 'max',
};

const STATUS: Record<number, NormalizedMarket['status']> = { 2: 'open', 4: 'resolved' };

/** Binary Market (or one child of a categorical Market) -> NormalizedMarket. */
export function normalizeOpinionMarket(
  raw: OpinionMarket,
  parent?: OpinionMarket,
): NormalizedMarket | null {
  if (!raw.yesTokenId || !raw.noTokenId || raw.status === 6) return null;
  const [category, ...rest] = (parent ?? raw).labels ?? [];
  const meta = { parentId: parent?.marketId ?? null };
  return {
    venueId: OPINION_ID,
    externalId: String(raw.marketId),
    slug: null,
    question: parent ? `${parent.marketTitle}: ${raw.marketTitle}` : raw.marketTitle,
    description: raw.rules || parent?.rules || '',
    resolutionSource: null,
    category: category ?? null,
    tags: rest,
    status: STATUS[raw.status] ?? 'closed',
    endDate: msToIso((raw.cutoffAt ?? 0) * 1000),
    volume: toDecimalString(raw.volume),
    liquidity: '0',
    imageUrl: raw.thumbnailUrl || parent?.thumbnailUrl || raw.coverUrl || null,
    url: opinionDeepLink({ externalId: String(raw.marketId), meta }),
    fee: { kind: 'none' },
    outcomes: [
      { externalId: raw.yesTokenId, label: raw.yesLabel || 'Yes', index: 0 },
      { externalId: raw.noTokenId, label: raw.noLabel || 'No', index: 1 },
    ],
    meta,
  };
}

export function opinionDeepLink(m: { externalId: string; meta: Record<string, unknown> }): string {
  const id = typeof m.meta.parentId === 'number' ? m.meta.parentId : m.externalId;
  return `${SITE}/detail?topicId=${id}`;
}

/**
 * Opinion (BNB Chain CLOB) via its free OpenAPI; public data needs no key. Read-only. Each
 * Outcome is a token with its own book, so Outcome ids are the YES/NO token ids. Categorical
 * Markets are flattened into their binary children.
 */
export function createOpinionAdapter(options: OpinionOptions = {}): VenueAdapter {
  const api = (options.apiUrl ?? 'https://openapi.opinion.trade/openapi').replace(/\/$/, '');
  const now = options.now ?? (() => new Date());
  // Issue #52 budget: 5 req/s (the docs allow 15).
  const http = createHttp({ name: 'opinion', fetch: options.fetch, minIntervalMs: 200 });

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const books = await http.mapBatched(outcomeExternalIds, async (token) => {
      const json = await http.getJson(
        `${api}/token/orderbook?token_id=${encodeURIComponent(token)}`,
      );
      const parsed = json == null ? null : OpinionBook.safeParse(json);
      if (!parsed?.success) return [];
      const r = parsed.data.result;
      const lv = (ls: typeof r.bids) =>
        ls.map((l) => ({ price: Number(l.price), size: Number(l.size) }));
      return [
        makeBook(token, lv(r.bids), lv(r.asks), null, r.timestamp ? new Date(r.timestamp) : now()),
      ];
    });
    return books.flat();
  }

  return {
    id: OPINION_ID,
    name: 'Opinion',
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
      // marketType 2 = binary and categorical; sortBy 3 = volume desc.
      const q = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        marketType: '2',
        sortBy: '3',
      });
      if (params.status !== 'all') q.set('status', 'activated');
      const { result } = OpinionList.parse(await http.getJson(`${api}/market?${q}`));
      const items = result.list.flatMap((row) => {
        const raw = OpinionMarket.safeParse(row);
        if (!raw.success) return [];
        const parent = raw.data;
        if (!parent.childMarkets?.length) {
          const m = normalizeOpinionMarket(parent);
          return m ? [m] : [];
        }
        return parent.childMarkets.flatMap((c) => {
          const child = OpinionMarket.safeParse(c);
          const m = child.success ? normalizeOpinionMarket(child.data, parent) : null;
          return m ? [m] : [];
        });
      });
      const more = result.list.length >= limit && page * limit < (result.total ?? Infinity);
      return { items, nextCursor: more ? String(page + 1) : null };
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
        token_id: outcomeExternalId,
        interval: BUCKET[params.interval],
      });
      const window = WINDOW_S[params.interval];
      if (window) q.set('start_at', String(Math.floor(now().getTime() / 1000) - window));
      const json = await http.getJson(`${api}/token/price-history?${q}`);
      if (json == null) return [];
      // The API returns newest first.
      return OpinionHistory.parse(json)
        .result.history.filter((h) => Number(h.p) >= 0 && Number(h.p) <= 1)
        .map((h) => ({ ts: new Date(h.t * 1000).toISOString(), price: toDecimalString(h.p) }))
        .sort((a, b) => a.ts.localeCompare(b.ts));
    },

    deepLink: opinionDeepLink,
  };
}
