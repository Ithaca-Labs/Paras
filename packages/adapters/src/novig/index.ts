import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { makeBook, orderBookToQuote, type RawLevel } from '../book.js';
import { complement, createHttp, msToIso } from '../http.js';
import type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from '../types.js';
import { NovigBook, NovigEvents, NovigMarket, NovigMarkets } from './raw.js';

export interface NovigOptions {
  /** Injectable for fixture replay (see @paras/testkit). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Production host. Paper (`api.paper.novig.com`) is play money: never point Paras at it. */
  apiUrl?: string;
  now?: () => Date;
}

export const NOVIG_ID = 'novig';
const SITE = 'https://novig.com';
const MAX_PAGE = 500;
const EVENTS_TTL_MS = 5 * 60_000;
/** One contract pays 1 cent, so 100 contracts are one share. */
const CONTRACTS_PER_SHARE = 100;

export interface NovigEventInfo {
  description: string;
  sport: string | null;
  league: string | null;
}

const outcomeId = (market: string, outcome: string) => `${market}:${outcome}`;
function parseOutcomeId(id: string): { market: string; outcome: string } | null {
  const i = id.indexOf(':');
  return i > 0 ? { market: id.slice(0, i), outcome: id.slice(i + 1) } : null;
}

export const novigDeepLink = (): string => SITE;

export function normalizeNovigMarket(
  raw: NovigMarket,
  event?: NovigEventInfo,
): NormalizedMarket | null {
  if (raw.outcomes.length < 2) return null;
  return {
    venueId: NOVIG_ID,
    externalId: raw.marketId,
    slug: null,
    // Market descriptions are terse ("TXST", "CLE -1.5 1H"): the event says what they refer to.
    question: event ? `${event.description}: ${raw.description}` : raw.description,
    description: '',
    resolutionSource: null,
    category: event?.sport ?? null,
    tags: [event?.league, raw.marketType].filter((t): t is string => !!t),
    status: raw.status === 'OPEN' ? 'open' : 'closed',
    endDate: msToIso(raw.startsTs),
    // The catalog carries no volume or liquidity.
    volume: '0',
    liquidity: '0',
    imageUrl: null,
    url: novigDeepLink(),
    // Takers pay a fee only when live; pre-game is free, which is all Paras shows.
    fee: { kind: 'none' },
    outcomes: raw.outcomes.map((o, index) => ({
      externalId: outcomeId(raw.marketId, o.outcomeId),
      label: o.name,
      index,
    })),
    meta: { eventId: raw.eventId, marketType: raw.marketType ?? null, strike: raw.strike ?? null },
  };
}

/**
 * Novig (sports exchange) via the public, unsigned v3 catalog (`/v3/public/catalog`, throttled
 * per IP; no key). Every order is a buy, so an outcome's bids are the orders on it and its asks
 * are the other outcome's orders at 1 - p. Order and price history need a signed trading key,
 * so there is no price history. Read-only.
 */
export function createNovigAdapter(options: NovigOptions = {}): VenueAdapter {
  const api = (options.apiUrl ?? 'https://api.novig.com').replace(/\/$/, '') + '/v3/public/catalog';
  const now = options.now ?? (() => new Date());
  const http = createHttp({ name: 'novig', fetch: options.fetch, minIntervalMs: 200 });

  let events: { at: number; byId: Map<string, NovigEventInfo> } | null = null;
  async function eventInfo(): Promise<Map<string, NovigEventInfo>> {
    if (events && now().getTime() - events.at < EVENTS_TTL_MS) return events.byId;
    const json = await http.getJson(`${api}/events?limit=5000`);
    const parsed = json == null ? null : NovigEvents.safeParse(json);
    const byId = new Map(
      (parsed?.success ? parsed.data.items : []).map((e) => [
        e.eventId,
        { description: e.description, sport: e.sport ?? null, league: e.league ?? null },
      ]),
    );
    events = { at: now().getTime(), byId };
    return byId;
  }

  async function fetchOrderBooks(outcomeExternalIds: readonly string[]): Promise<OrderBook[]> {
    const wanted = outcomeExternalIds.flatMap((id) => {
      const p = parseOutcomeId(id);
      return p ? [{ id, ...p }] : [];
    });
    const markets = [...new Set(wanted.map((w) => w.market))];
    const raw = new Map<string, NovigBook['orders']>();
    await http.mapBatched(markets, async (m) => {
      const json = await http.getJson(`${api}/markets/${encodeURIComponent(m)}/book?depth=20`);
      const parsed = json == null ? null : NovigBook.safeParse(json);
      if (parsed?.success) raw.set(m, parsed.data.orders);
    });
    const lv = (ls: { price: string; qty: number }[], flip: boolean): RawLevel[] =>
      ls.map((l) => ({
        price: flip ? complement(Number(l.price)) : Number(l.price),
        size: l.qty / CONTRACTS_PER_SHARE,
      }));
    return wanted.flatMap(({ id, market, outcome }) => {
      const orders = raw.get(market);
      if (!orders) return [];
      const others = Object.entries(orders)
        .filter(([o]) => o !== outcome)
        .flatMap(([, ls]) => ls);
      return [makeBook(id, lv(orders[outcome] ?? [], false), lv(others, true), null, now())];
    });
  }

  return {
    id: NOVIG_ID,
    name: 'Novig',
    capabilities: {
      routable: false,
      realMoney: true,
      // Not verified by us; tighten once legal confirms Novig's status.
      regulation: 'unknown',
      restrictedJurisdictions: [],
      orderBook: true,
      priceHistory: false,
    },

    async listMarkets(params: ListMarketsParams = {}): Promise<Page<NormalizedMarket>> {
      // The catalog lists only tradable Markets, so `status: 'all'` returns the same set.
      const q = new URLSearchParams({
        limit: String(Math.min(params.limit ?? MAX_PAGE, MAX_PAGE)),
      });
      if (params.cursor) q.set('after', params.cursor);
      const [json, byEvent] = await Promise.all([http.getJson(`${api}/markets?${q}`), eventInfo()]);
      const page = NovigMarkets.parse(json);
      const items = page.items.flatMap((row) => {
        const raw = NovigMarket.safeParse(row);
        const m = raw.success
          ? normalizeNovigMarket(raw.data, byEvent.get(raw.data.eventId))
          : null;
        return m ? [m] : [];
      });
      return { items, nextCursor: page.items.length && page.next ? page.next : null };
    },

    fetchOrderBooks,

    async fetchQuotes(outcomeExternalIds: readonly string[]): Promise<Quote[]> {
      return (await fetchOrderBooks(outcomeExternalIds)).map(orderBookToQuote);
    },

    async fetchPriceHistory(_id: string, _params: PriceHistoryParams): Promise<PricePoint[]> {
      return [];
    },

    deepLink: novigDeepLink,
  };
}
