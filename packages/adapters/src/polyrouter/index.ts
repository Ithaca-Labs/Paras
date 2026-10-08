import type { NormalizedMarket, PricePoint, Quote } from '@paras/shared';
import { toDecimalString } from '../decimal.js';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import {
  normalizePrMarket,
  outcomeExternalId,
  quotesFromMarket,
  splitOutcomeId,
} from './normalize.js';
import { PrHistoryResponse, PrMarket, PrMarketsResponse } from './raw.js';
import { LONG_TAIL_VENUES, resolvePlatform, type LongTailVenue } from './venues.js';

export { LONG_TAIL_VENUES, resolvePlatform } from './venues.js';

export interface PolyRouterOptions {
  /** PolyRouter API key (free beta, sent as `X-API-Key`). */
  apiKey: string;
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  baseUrl?: string;
  /** Markets per request. The docs say 25 (pagination guide) to 100 (list-markets). Default 25. */
  pageSize?: number;
  /** Include play-money Venues (Manifold). Default false: excluded from default Feeds. */
  includePlayMoney?: boolean;
  /** Restrict to these Paras Venue ids (e.g. `['novig']`). Default: every long-tail Venue. */
  venues?: readonly string[];
  /** Pages of a Venue's listing scanned per `fetchQuotes` call. Default 4. */
  maxQuotePages?: number;
  /** Minimum gap between requests across all Venues, to stay under 100 req/min. Default 650 ms. */
  minIntervalMs?: number;
  now?: () => Date;
}

const HISTORY_WINDOW_S: Record<PriceHistoryParams['interval'], number> = {
  '1h': 3600,
  '6h': 21_600,
  '1d': 86_400,
  '1w': 604_800,
  '1m': 2_592_000,
  max: 31_536_000,
};
/** Candle size in minutes; PolyRouter supports 1, 60 and 1440. */
const HISTORY_BUCKET: Record<PriceHistoryParams['interval'], string> = {
  '1h': '1',
  '6h': '60',
  '1d': '60',
  '1w': '60',
  '1m': '1440',
  max: '1440',
};

/**
 * Long-tail Venues through PolyRouter (free beta). One shared client fans out to one
 * `VenueAdapter` per underlying Venue (Myriad, Opinion, Predict.fun, ProphetX, Novig,
 * Polymarket US, optionally Manifold), so each is its own Venue with its own labels and
 * its own sync jobs. Venues Paras covers natively are never included.
 *
 * Failure isolation: a PolyRouter error only fails that Venue's jobs. Core Venues use native
 * adapters and never touch this code.
 *
 * Limits: PolyRouter serves order books only for Polymarket, Kalshi, Limitless and Manifold, so
 * these adapters have no `fetchOrderBooks`; Quotes come from each Market's `current_prices`
 * (bid/ask/last) with unknown depth reported as 0. All Venues share one 100 req/min budget.
 */
export function createPolyRouterAdapters(options: PolyRouterOptions): VenueAdapter[] {
  const doFetch = options.fetch ?? fetch;
  const base = (options.baseUrl ?? 'https://api-v2.polyrouter.io').replace(/\/$/, '');
  const pageSize = Math.min(options.pageSize ?? 25, 100);
  const maxQuotePages = options.maxQuotePages ?? 4;
  const now = options.now ?? (() => new Date());
  const minInterval = options.minIntervalMs ?? 650;
  let nextSlot = 0;

  /** Space requests `minInterval` apart (shared by every Venue adapter from this call). */
  async function throttle() {
    const t = Date.now();
    const slot = Math.max(nextSlot, t);
    nextSlot = slot + minInterval;
    if (slot > t) await new Promise((r) => setTimeout(r, slot - t));
  }

  async function getJson(path: string, query: Record<string, string | undefined>) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, v);
    const url = `${base}${path}?${q}`;
    await throttle();
    const res = await doFetch(url, { headers: { 'X-API-Key': options.apiKey } });
    if (!res.ok) throw new Error(`polyrouter ${res.status} GET ${path}`);
    return res.json() as Promise<unknown>;
  }

  const venues = LONG_TAIL_VENUES.filter(
    (v) =>
      (options.includePlayMoney || v.capabilities.realMoney) &&
      (!options.venues || options.venues.includes(v.id)),
  );

  function createVenueAdapter(venue: LongTailVenue): VenueAdapter {
    const platform = venue.aliases[0]!;

    /** One page of raw markets; skips malformed rows and rows from another platform. */
    async function page(cursor: string | undefined, limit: number, status: string | undefined) {
      const json = PrMarketsResponse.parse(
        await getJson('/markets', {
          platform,
          limit: String(limit),
          cursor,
          status,
        }),
      );
      const markets = json.markets.flatMap((row) => {
        const m = PrMarket.safeParse(row);
        return m.success && resolvePlatform(m.data.platform) === venue ? [m.data] : [];
      });
      return {
        markets,
        nextCursor: json.pagination.has_more ? (json.pagination.next_cursor ?? null) : null,
      };
    }

    return {
      id: venue.id,
      name: venue.name,
      capabilities: venue.capabilities,

      async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
        const limit = Math.min(params.limit ?? pageSize, pageSize);
        const { markets, nextCursor } = await page(
          params.cursor,
          limit,
          params.status === 'all' ? undefined : 'open',
        );
        const items = markets
          .flatMap((m) => {
            const n = normalizePrMarket(m, venue);
            return n ? [n] : [];
          })
          // The API gives no volume ordering; sort within the page (best effort).
          .sort((a, b) => Number(b.volume) - Number(a.volume));
        return { items, nextCursor };
      },

      async fetchQuotes(outcomeExternalIds: readonly string[]): Promise<Quote[]> {
        const wanted = new Set(outcomeExternalIds);
        const marketIds = new Set(
          outcomeExternalIds.flatMap((id) => splitOutcomeId(id)?.marketId ?? []),
        );
        const out: Quote[] = [];
        let cursor: string | undefined;
        for (let i = 0; i < maxQuotePages && marketIds.size > 0; i++) {
          const res = await page(cursor, pageSize, 'open');
          for (const m of res.markets) {
            if (!marketIds.delete(m.id)) continue;
            out.push(...quotesFromMarket(m, now()).filter((q) => wanted.has(q.outcomeExternalId)));
          }
          if (!res.nextCursor) break;
          cursor = res.nextCursor;
        }
        return out;
      },

      async fetchPriceHistory(
        outcomeExternalId: string,
        params: PriceHistoryParams,
      ): Promise<PricePoint[]> {
        const ids = splitOutcomeId(outcomeExternalId);
        if (!ids) return [];
        const end = Math.floor(now().getTime() / 1000);
        const json = PrHistoryResponse.parse(
          await getJson('/price-history', {
            market_ids: ids.marketId,
            start_ts: String(end - HISTORY_WINDOW_S[params.interval]),
            end_ts: String(end),
            interval: HISTORY_BUCKET[params.interval],
          }),
        );
        return json.data
          .filter((p) => !p.outcomeId || p.outcomeId === ids.outcomeId)
          .flatMap((p) =>
            p.price.close >= 0 && p.price.close <= 1
              ? [
                  {
                    ts: new Date(p.timestamp * 1000).toISOString(),
                    price: toDecimalString(p.price.close),
                  },
                ]
              : [],
          )
          .sort((a, b) => a.ts.localeCompare(b.ts));
      },

      deepLink(market) {
        const url = market.meta.sourceUrl;
        return typeof url === 'string' ? url : venue.site;
      },
    };
  }

  return venues.map(createVenueAdapter);
}

export { outcomeExternalId };

/**
 * Feature-flagged construction from env. Off by default; `POLYROUTER_ENABLED=true` requires
 * `POLYROUTER_API_KEY`. Returns `[]` when disabled so callers can spread it into the registry.
 */
export function polyRouterAdaptersFromEnv(
  env: Record<string, string | undefined>,
  overrides: Partial<PolyRouterOptions> = {},
): VenueAdapter[] {
  if (env.POLYROUTER_ENABLED !== 'true') return [];
  const apiKey = env.POLYROUTER_API_KEY;
  if (!apiKey) throw new Error('POLYROUTER_ENABLED=true requires POLYROUTER_API_KEY');
  return createPolyRouterAdapters({
    apiKey,
    includePlayMoney: env.POLYROUTER_INCLUDE_PLAY_MONEY === 'true',
    ...overrides,
  });
}
