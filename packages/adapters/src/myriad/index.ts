import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { makeBook, orderBookToQuote } from '../book.js';
import { toDecimalString } from '../decimal.js';
import { createHttp, strToIso, validPrice } from '../http.js';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import { MyriadBook, MyriadList, MyriadMarket } from './raw.js';

export interface MyriadOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  apiUrl?: string;
  /** Optional: raises the rate limit from 30 req/10 s to 200 req/s. */
  apiKey?: string;
  now?: () => Date;
}

export const MYRIAD_ID = 'myriad';
const SITE = 'https://myriad.markets';
const MAX_PAGE = 100;
const CHART: Record<PriceHistoryParams['interval'], [string, number]> = {
  '1h': ['24h', 3600],
  '6h': ['24h', 21_600],
  '1d': ['24h', 86_400],
  '1w': ['7d', 604_800],
  '1m': ['30d', 2_592_000],
  max: ['all', 0],
};
const STATE: Record<string, NormalizedMarket['status']> = { open: 'open', resolved: 'resolved' };
const SCALE = 1e18;

/** `<network>:<market>:<outcome>`. */
const outcomeId = (m: { networkId: number; id: number }, outcome: number) =>
  `${m.networkId}:${m.id}:${outcome}`;
function parseOutcomeId(id: string) {
  const [network, market, outcome] = id.split(':').map(Number);
  return Number.isInteger(network) && Number.isInteger(market) && Number.isInteger(outcome)
    ? { network: network!, market: market!, outcome: outcome! }
    : null;
}

export const myriadDeepLink = (m: { slug: string | null; externalId: string }): string =>
  `${SITE}/markets/${m.slug ?? m.externalId}`;

/** Null for Markets Paras cannot show as real money: points (`PTS`) collateral or voided. */
export function normalizeMyriadMarket(raw: MyriadMarket): NormalizedMarket | null {
  if (raw.token.symbol === 'PTS' || raw.voided) return null;
  const externalId = `${raw.networkId}:${raw.id}`;
  return {
    venueId: MYRIAD_ID,
    externalId,
    slug: raw.slug,
    question: raw.title,
    description: raw.description ?? '',
    resolutionSource: raw.resolutionSource || null,
    category: raw.topics?.[0] ?? null,
    tags: raw.tags ?? [],
    status: STATE[raw.state] ?? 'closed',
    endDate: strToIso(raw.expiresAt),
    volume: toDecimalString(raw.volume),
    liquidity: toDecimalString(raw.liquidity),
    imageUrl: raw.imageUrl || null,
    url: myriadDeepLink({ slug: raw.slug, externalId }),
    fee: { kind: 'none' },
    outcomes: raw.outcomes.map((o) => ({
      externalId: outcomeId(raw, o.id),
      label: o.title,
      index: o.id,
    })),
    meta: { networkId: raw.networkId, marketId: raw.id, tradingModel: raw.tradingModel ?? null },
  };
}

const num = (v: unknown): number | null => {
  const n =
    typeof v === 'object' && v !== null && 'price' in v
      ? Number((v as { price: unknown }).price)
      : Number(v);
  return v != null && validPrice(n) ? n : null;
};

/**
 * Myriad (multi-chain) via API v2, no key required. Two trading models: order-book Markets
 * (`ob`, two outcomes) have a public `/orderbook`; AMM Markets have none, so their Quote is the
 * listed price on both sides with depth 0. Points (`PTS`) Markets are play money and skipped.
 */
export function createMyriadAdapter(options: MyriadOptions = {}): VenueAdapter {
  const api = (options.apiUrl ?? 'https://api-v2.myriadprotocol.com').replace(/\/$/, '');
  const now = options.now ?? (() => new Date());
  const http = createHttp({
    name: 'myriad',
    fetch: options.fetch,
    // 30 requests / 10 s per IP without a key.
    minIntervalMs: options.apiKey ? 10 : 350,
    headers: options.apiKey ? { 'x-api-key': options.apiKey } : undefined,
  });

  const detail = async (network: number, market: number): Promise<MyriadMarket | null> => {
    const json = await http.getJson(`${api}/markets/${market}?network_id=${network}`);
    const parsed = json == null ? null : MyriadMarket.safeParse(json);
    return parsed?.success ? parsed.data : null;
  };

  async function orderbook(
    network: number,
    market: number,
    outcome: number,
  ): Promise<OrderBook | null> {
    const json = await http.getJson(
      `${api}/markets/${market}/orderbook?network_id=${network}&outcome=${outcome}`,
    );
    const parsed = json == null ? null : MyriadBook.safeParse(json);
    if (!parsed?.success) return null;
    const lv = (ls: [string, string][]) =>
      ls.map(([p, a]) => ({ price: Number(p) / SCALE, size: Number(a) / SCALE }));
    return makeBook(
      `${network}:${market}:${outcome}`,
      lv(parsed.data.bids),
      lv(parsed.data.asks),
      null,
      now(),
    );
  }

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const wanted = outcomeExternalIds.flatMap((id) => {
      const p = parseOutcomeId(id);
      return p ? [p] : [];
    });
    // AMM Markets answer 404/400 here and are simply omitted.
    const books = await http.mapBatched(wanted, (w) =>
      orderbook(w.network, w.market, w.outcome).catch(() => null),
    );
    return books.filter((b): b is OrderBook => b !== null);
  }

  return {
    id: MYRIAD_ID,
    name: 'Myriad',
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
      const q = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sort: 'volume',
        order: 'desc',
      });
      if (params.status !== 'all') q.set('state', 'open');
      const json = MyriadList.parse(await http.getJson(`${api}/markets?${q}`));
      const items = json.data.flatMap((row) => {
        const raw = MyriadMarket.safeParse(row);
        const m = raw.success ? normalizeMyriadMarket(raw.data) : null;
        return m ? [m] : [];
      });
      return { items, nextCursor: json.pagination.hasNext ? String(page + 1) : null };
    },

    fetchOrderBooks,

    async fetchQuotes(outcomeExternalIds: readonly string[]): Promise<Quote[]> {
      const wanted = outcomeExternalIds.flatMap((id) => {
        const p = parseOutcomeId(id);
        return p ? [p] : [];
      });
      const keys = [...new Set(wanted.map((w) => `${w.network}:${w.market}`))];
      const markets = new Map<string, MyriadMarket>();
      await http.mapBatched(keys, async (k) => {
        const [network, market] = k.split(':').map(Number);
        const m = await detail(network!, market!);
        if (m) markets.set(k, m);
      });
      const out = await http.mapBatched(wanted, async (w): Promise<Quote[]> => {
        const m = markets.get(`${w.network}:${w.market}`);
        const o = m?.outcomes.find((x) => x.id === w.outcome);
        if (!m || !o) return [];
        const id = outcomeId(m, o.id);
        if (m.tradingModel === 'ob') {
          const book = await orderbook(w.network, w.market, w.outcome).catch(() => null);
          if (book) return [orderBookToQuote(book)];
        }
        // AMM (or an unreadable book): the listed price is the only price; depth is unknown.
        const price = num(o.price);
        if (price === null) return [];
        const p = toDecimalString(price);
        return [
          {
            outcomeExternalId: id,
            bid: toDecimalString(num(o.bestBid) ?? price),
            ask: toDecimalString(num(o.bestAsk) ?? price),
            last: p,
            bidDepth: '0',
            askDepth: '0',
            observedAt: now().toISOString(),
          },
        ];
      });
      return out.flat();
    },

    async fetchPriceHistory(
      outcomeExternalId: string,
      params: PriceHistoryParams,
    ): Promise<PricePoint[]> {
      const id = parseOutcomeId(outcomeExternalId);
      if (!id) return [];
      const m = await detail(id.network, id.market);
      const [frame, window] = CHART[params.interval];
      const prices =
        m?.outcomes
          .find((o) => o.id === id.outcome)
          ?.price_charts?.find((c) => c.timeframe === frame)?.prices ?? [];
      const since = window ? Math.floor(now().getTime() / 1000) - window : 0;
      return prices
        .filter((p) => p.timestamp >= since && p.value >= 0 && p.value <= 1)
        .map((p) => ({
          ts: new Date(p.timestamp * 1000).toISOString(),
          price: toDecimalString(p.value),
        }))
        .sort((a, b) => a.ts.localeCompare(b.ts));
    },

    deepLink: myriadDeepLink,
  };
}
