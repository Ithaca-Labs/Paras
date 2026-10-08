import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { mirrorBook, orderBookToQuote } from '../book.js';
import { toDecimalString } from '../decimal.js';
import { createHttp, strToIso } from '../http.js';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import { UsBook, UsHistory, UsMarket, UsMarkets } from './raw.js';

export interface PolymarketUsOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  apiUrl?: string;
  now?: () => Date;
}

export const POLYMARKET_US_ID = 'polymarket-us';
const SITE = 'https://polymarket.us';
const MAX_PAGE = 100;
/** Fixed windows and the bucket size (minutes) the API supports for each. */
const WINDOW: Record<PriceHistoryParams['interval'], [string, number]> = {
  '1h': ['INTERVAL_1H', 1],
  '6h': ['INTERVAL_6H', 1],
  '1d': ['INTERVAL_1D', 5],
  '1w': ['INTERVAL_1W', 180],
  '1m': ['INTERVAL_1M', 180],
  max: ['INTERVAL_ALL', 180],
};

type Side = 'long' | 'short';
const outcomeId = (slug: string, side: Side) => `${slug}:${side}`;
function parseOutcomeId(id: string): { slug: string; side: Side } | null {
  const i = id.lastIndexOf(':');
  const side = id.slice(i + 1);
  return i > 0 && (side === 'long' || side === 'short') ? { slug: id.slice(0, i), side } : null;
}

const deepLink = (m: { externalId: string; slug?: string | null }) =>
  `${SITE}/market/${m.slug ?? m.externalId}`;

export function normalizeUsMarket(raw: UsMarket): NormalizedMarket | null {
  const long = raw.marketSides.find((s) => s.long);
  const short = raw.marketSides.find((s) => s.long === false);
  if (!long || !short) return null;
  const resolved = raw.status === 'MARKET_STATUS_RESOLVED';
  const open = !raw.closed && !raw.archived && raw.active !== false && !resolved;
  // Futures rows share one generic question ("National League Champion"): the title says which.
  const question =
    raw.title && !raw.question.includes(raw.title) ? `${raw.question}: ${raw.title}` : raw.question;
  const coefficient = Number(raw.feeCoefficient);
  return {
    venueId: POLYMARKET_US_ID,
    externalId: raw.slug,
    slug: raw.slug,
    question,
    description: raw.description ?? '',
    resolutionSource: null,
    category: raw.category ?? null,
    tags: [],
    status: resolved ? 'resolved' : open ? 'open' : 'closed',
    endDate: strToIso(raw.endDate),
    // shortcut: lifetime volume is in shares (<= USD notional) and absent on most rows; use as-is.
    volume: toDecimalString(raw.volume),
    liquidity: '0',
    imageUrl: raw.image || null,
    url: deepLink({ externalId: raw.slug, slug: raw.slug }),
    // Fee per contract = coefficient * p * (1 - p), charged to takers.
    fee:
      coefficient > 0
        ? { kind: 'curve', rate: toDecimalString(coefficient), exponent: 1, takerOnly: true }
        : { kind: 'none' },
    outcomes: [
      { externalId: outcomeId(raw.slug, 'long'), label: long.description || 'Yes', index: 0 },
      { externalId: outcomeId(raw.slug, 'short'), label: short.description || 'No', index: 1 },
    ],
    meta: {
      tickSize: raw.orderPriceMinTickSize ?? null,
      minOrderSize: raw.minimumTradeQty ?? null,
      marketType: raw.marketType ?? null,
    },
  };
}

/**
 * Polymarket US (CFTC-regulated, gateway.polymarket.us, no key). Read-only: Paras shows Markets
 * and quotes and redirects to polymarket.us. One book per Market (the `long` instrument); the
 * `short` Outcome is its mirror.
 */
export function createPolymarketUsAdapter(options: PolymarketUsOptions = {}): VenueAdapter {
  const api = (options.apiUrl ?? 'https://gateway.polymarket.us/v1').replace(/\/$/, '');
  const now = options.now ?? (() => new Date());
  // Public limit is 25 req/s per IP.
  const http = createHttp({ name: 'polymarket-us', fetch: options.fetch, minIntervalMs: 60 });

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const wanted = outcomeExternalIds.flatMap((id) => {
      const p = parseOutcomeId(id);
      return p ? [p] : [];
    });
    const slugs = [...new Set(wanted.map((w) => w.slug))];
    const books = new Map<string, UsBook['marketData']>();
    await http.mapBatched(slugs, async (slug) => {
      const json = await http.getJson(`${api}/markets/${encodeURIComponent(slug)}/book`);
      const parsed = json == null ? null : UsBook.safeParse(json);
      if (parsed?.success) books.set(slug, parsed.data.marketData);
    });
    const lv = (ls: UsBook['marketData']['bids']) =>
      ls.map((l) => ({ price: Number(l.px.value), size: Number(l.qty) }));
    return wanted.flatMap(({ slug, side }) => {
      const b = books.get(slug);
      if (!b) return [];
      const last = b.stats?.lastTradePx ? Number(b.stats.lastTradePx.value) : null;
      return [
        mirrorBook(
          outcomeId(slug, side),
          side === 'long' ? 'yes' : 'no',
          lv(b.bids),
          lv(b.offers),
          last,
          now(),
        ),
      ];
    });
  }

  return {
    id: POLYMARKET_US_ID,
    name: 'Polymarket US',
    capabilities: {
      routable: false,
      realMoney: true,
      regulation: 'cftc_regulated',
      // US residents only on the venue itself; Paras only redirects, so nothing is blocked here.
      restrictedJurisdictions: [],
      orderBook: true,
      priceHistory: true,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      const limit = Math.min(params.limit ?? MAX_PAGE, MAX_PAGE);
      const offset = Number(params.cursor ?? 0);
      const q = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        orderBy: 'volume',
        orderDirection: 'desc',
      });
      if (params.status !== 'all') {
        q.set('active', 'true');
        q.set('closed', 'false');
      }
      const { markets } = UsMarkets.parse(await http.getJson(`${api}/markets?${q}`));
      const items = markets.flatMap((row) => {
        const raw = UsMarket.safeParse(row);
        const m = raw.success ? normalizeUsMarket(raw.data) : null;
        return m ? [m] : [];
      });
      return { items, nextCursor: markets.length >= limit ? String(offset + limit) : null };
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
      const [interval, fidelity] = WINDOW[params.interval];
      const q = new URLSearchParams({
        symbol: id.slug,
        fixedInterval: interval,
        fidelity: String(fidelity),
      });
      const json = await http.getJson(`${api}/price-history?${q}`);
      if (json == null) return [];
      return UsHistory.parse(json)
        .history.flatMap((h) => {
          const p = id.side === 'long' ? h.longPrice : h.shortPrice;
          const ms = Number(h.timestamp) * 1000;
          return p != null && p >= 0 && p <= 1 && Number.isFinite(ms)
            ? [{ ts: new Date(ms).toISOString(), price: toDecimalString(p) }]
            : [];
        })
        .sort((a, b) => a.ts.localeCompare(b.ts));
    },

    deepLink,
  };
}
