import type {
  NormalizedMarket,
  OrderBook,
  PricePoint,
  Quote,
  VenueCapabilities,
  VenueId,
} from '@paras/shared';

export interface ListMarketsParams {
  /** Opaque cursor from a previous page's `nextCursor`. Omit for the first page. */
  cursor?: string;
  /** Page size; adapters clamp to the Venue's maximum. */
  limit?: number;
  /** `open` (default) = tradeable Markets only; `all` includes closed and resolved. */
  status?: 'open' | 'all';
}

export interface Page<T> {
  items: T[];
  /** Null on the last page. */
  nextCursor: string | null;
}

export interface PriceHistoryParams {
  /** Window ending now. */
  interval: '1h' | '6h' | '1d' | '1w' | '1m' | 'max';
  /** Bucket size in minutes (Venues round to what they support). */
  fidelityMinutes?: number;
}

/**
 * The contract every Venue adapter implements (Polymarket, Kalshi, Limitless, SX Bet, PolyRouter).
 *
 * Adapters are pure translators: HTTP in, normalized schema out. No ranking, matching, caching or
 * persistence. They take an injectable `fetch` (see @paras/testkit) so tests replay fixtures, and
 * they never throw on a single bad Market in a list (skip it) but do throw on transport errors.
 * Prices and amounts are decimal strings (see `DecimalString`); orders are keyed by the
 * Venue-native Outcome id (`NormalizedOutcome.externalId`).
 */
export interface VenueAdapter {
  /** Stable lowercase slug; primary key of the Venue everywhere in Paras. */
  readonly id: VenueId;
  /** Display name. */
  readonly name: string;
  /** Static facts: routable vs read-only, regulation, restricted jurisdictions, features. */
  readonly capabilities: VenueCapabilities;

  /** Page through Markets, highest volume first. Metadata only; no live prices. */
  listMarkets(params?: ListMarketsParams): Promise<Page<NormalizedMarket>>;

  /**
   * Order books for Outcomes, batched. Venues without order books (`capabilities.orderBook`
   * false) may omit this and implement only `fetchQuotes`. Outcomes the Venue does not know are
   * omitted from the result.
   */
  fetchOrderBooks?(outcomeExternalIds: readonly string[]): Promise<OrderBook[]>;

  /** Quotes (best bid/ask, last, depth) for Outcomes, batched. Same omission rule as books. */
  fetchQuotes(outcomeExternalIds: readonly string[]): Promise<Quote[]>;

  /** Historical prices for one Outcome, oldest first. */
  fetchPriceHistory(outcomeExternalId: string, params: PriceHistoryParams): Promise<PricePoint[]>;

  /** URL of this Market on the Venue's own site. `listMarkets` already fills `NormalizedMarket.url` with it. */
  deepLink(market: Pick<NormalizedMarket, 'externalId' | 'slug' | 'meta'>): string;
}
