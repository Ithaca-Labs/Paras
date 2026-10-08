import type { NormalizedMarket, PricePoint, Quote } from '@paras/shared';
import { toDecimalString } from '../decimal.js';
import { createHttp, strToIso } from '../http.js';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import { PxEvent, PxEvents, PxMarket, PxMultiMarkets, type PxSelection } from './raw.js';

export interface ProphetXOptions {
  /** Market Data API key (request from ProphetX; sent raw in `Authorization`). */
  apiKey: string;
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  apiUrl?: string;
  now?: () => Date;
}

export const PROPHETX_ID = 'prophetx';
const SITE = 'https://prophetx.co';
/** Events per `listMarkets` page (one batched markets call each). */
const EVENTS_PER_PAGE = 25;

const outcomeId = (event: number, market: number, strikeId: string) =>
  `${event}:${market}:${strikeId}`;
function parseOutcomeId(id: string): { event: number; market: number; strikeId: string } | null {
  const [event, market, ...rest] = id.split(':');
  const strikeId = rest.join(':');
  return Number.isInteger(Number(event)) && Number.isInteger(Number(market)) && strikeId
    ? { event: Number(event), market: Number(market), strikeId }
    : null;
}

/** American odds -> implied probability (the price to buy that outcome); null when invalid. */
export function americanToPrice(odds: number | null | undefined): number | null {
  if (odds == null || !Number.isFinite(odds) || Math.abs(odds) < 100) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export const prophetXDeepLink = (): string => SITE;

export function normalizeProphetXMarket(event: PxEvent, raw: PxMarket): NormalizedMarket | null {
  const selections = raw.selections.flat().filter((s) => s.strike_id);
  if (selections.length < 2) return null;
  const finished = event.status != null && !['scheduled', 'live'].includes(event.status);
  return {
    venueId: PROPHETX_ID,
    externalId: `${event.event_id}:${raw.id}`,
    slug: null,
    question: `${event.name ?? `Event ${event.event_id}`}: ${raw.display_name || raw.name}`,
    description: '',
    resolutionSource: null,
    category: event.sport_name ?? null,
    tags: [event.tournament_name, raw.type].filter((t): t is string => !!t),
    status: finished ? 'closed' : 'open',
    endDate: strToIso(event.scheduled),
    // The Market Data API carries no volume or total liquidity.
    volume: '0',
    liquidity: '0',
    imageUrl: null,
    url: prophetXDeepLink(),
    fee: { kind: 'none' },
    outcomes: selections.map((s, index) => ({
      externalId: outcomeId(event.event_id, raw.id, s.strike_id!),
      label: s.name ?? s.strike_id!,
      index,
    })),
    meta: { eventId: event.event_id, marketId: raw.id, type: raw.type ?? null },
  };
}

/**
 * ProphetX (CFTC-regulated sports exchange) via its Market Data API. Needs a partner API key
 * (`PROPHETX_API_KEY`). Every outcome is its own buy-only instrument with American-odds pricing
 * and no shared book, so a Quote has only an ask (the implied probability) and no bid. There is
 * no price history. Read-only.
 */
export function createProphetXAdapter(options: ProphetXOptions): VenueAdapter {
  const api = (options.apiUrl ?? 'https://cash.api.prophetx.co/partner').replace(/\/$/, '');
  const now = options.now ?? (() => new Date());
  const http = createHttp({
    name: 'prophetx',
    fetch: options.fetch,
    minIntervalMs: 200,
    headers: { Authorization: options.apiKey },
  });

  /** Markets for events, grouped by event id. */
  async function marketsFor(eventIds: readonly number[]): Promise<Map<number, PxMarket[]>> {
    const out = new Map<number, PxMarket[]>();
    if (!eventIds.length) return out;
    const q = eventIds.map((id) => `event_ids=${id}`).join('&');
    const json = await http.getJson(`${api}/v4/affiliate/get_multiple_markets?${q}`);
    if (json == null) return out;
    const { data } = PxMultiMarkets.parse(json);
    const add = (event: number, rows: unknown[]) =>
      out.set(event, [
        ...(out.get(event) ?? []),
        ...rows.flatMap((r) => {
          const m = PxMarket.safeParse(r);
          return m.success ? [m.data] : [];
        }),
      ]);
    if (Array.isArray(data)) {
      for (const row of data) {
        const event = (row as { event_id?: unknown }).event_id;
        if (typeof event === 'number') add(event, [row]);
      }
    } else {
      for (const [event, rows] of Object.entries(data)) add(Number(event), rows);
    }
    return out;
  }

  return {
    id: PROPHETX_ID,
    name: 'ProphetX',
    capabilities: {
      routable: false,
      realMoney: true,
      // Registered as a CFTC DCM, but Paras has not verified the label; tighten after legal review.
      regulation: 'unknown',
      restrictedJurisdictions: [],
      orderBook: false,
      priceHistory: false,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      const offset = Number(params.cursor ?? 0);
      const json = await http.getJson(`${api}/affiliate/get_sport_events`);
      if (json == null) return { items: [], nextCursor: null };
      const events = PxEvents.parse(json).data.sport_events.flatMap((e) => {
        const p = PxEvent.safeParse(e);
        return p.success ? [p.data] : [];
      });
      const size = Math.min(params.limit ?? EVENTS_PER_PAGE, EVENTS_PER_PAGE);
      const page = events.slice(offset, offset + size);
      const markets = await marketsFor(page.map((e) => e.event_id));
      const items = page.flatMap((event) =>
        (markets.get(event.event_id) ?? []).flatMap((m) => {
          const n = normalizeProphetXMarket(event, m);
          return n && (params.status === 'all' || n.status === 'open') ? [n] : [];
        }),
      );
      return { items, nextCursor: offset + size < events.length ? String(offset + size) : null };
    },

    async fetchQuotes(outcomeExternalIds: readonly string[]): Promise<Quote[]> {
      const wanted = outcomeExternalIds.flatMap((id) => {
        const p = parseOutcomeId(id);
        return p ? [{ id, ...p }] : [];
      });
      const markets = await marketsFor([...new Set(wanted.map((w) => w.event))]);
      const sel = new Map<string, PxSelection>();
      for (const [event, rows] of markets) {
        for (const m of rows) {
          for (const s of m.selections.flat()) {
            if (s.strike_id) sel.set(outcomeId(event, m.id, s.strike_id), s);
          }
        }
      }
      return wanted.flatMap(({ id }) => {
        const s = sel.get(id);
        const ask = americanToPrice(s?.price);
        if (!s || ask === null || ask >= 1) return [];
        return [
          {
            outcomeExternalId: id,
            bid: null,
            ask: toDecimalString(Math.round(ask * 1e6) / 1e6),
            last: null,
            bidDepth: '0',
            // shortcut: `quantity` is treated as contracts paying $1; confirm units against a live key.
            askDepth: toDecimalString(Math.round((s.quantity ?? 0) * ask * 1e6) / 1e6),
            observedAt: now().toISOString(),
          },
        ];
      });
    },

    async fetchPriceHistory(_id: string, _params: PriceHistoryParams): Promise<PricePoint[]> {
      return [];
    },

    deepLink: prophetXDeepLink,
  };
}
