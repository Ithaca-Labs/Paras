/**
 * Normalized Venue schema: what every Venue adapter produces and the rest of Paras consumes.
 * Venue-agnostic by design. Prices and amounts are decimal strings, never floats.
 */
import { z } from './zod.js';

/** Non-negative decimal string, e.g. "0.52" or "72893464.03". No exponents, no signs. */
export const DecimalString = z.string().regex(/^\d+(\.\d+)?$/, 'decimal string');
/** Share price in USD, 0..1 (equals implied probability). */
export const PriceString = DecimalString.refine((v) => Number(v) <= 1, 'price must be <= 1');

/** Stable lowercase Venue slug: `polymarket`, `kalshi`, ... */
export const VenueId = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
export type VenueId = z.infer<typeof VenueId>;

export const Regulation = z.enum(['cftc_regulated', 'offshore', 'play_money', 'unknown']);
export type Regulation = z.infer<typeof Regulation>;

export const VenueCapabilities = z.object({
  /** Vault/Executor can place orders here. False = read-only plus redirect. */
  routable: z.boolean(),
  /** False for play-money Venues (excluded or labeled in the UI). */
  realMoney: z.boolean(),
  regulation: Regulation,
  /** ISO 3166-1 alpha-2 codes where trading is restricted ("US" for Polymarket international). */
  restrictedJurisdictions: z.array(z.string().length(2)),
  /** Adapter can return order books (depth). */
  orderBook: z.boolean(),
  /** Adapter can return price history. */
  priceHistory: z.boolean(),
});
export type VenueCapabilities = z.infer<typeof VenueCapabilities>;

/** Regulation and availability label shown for every Venue (derived from capabilities). */
export const VenueLabel = z.object({
  regulation: Regulation,
  /** `routable`: Vault can route. `redirect_only`: read-only plus redirect. `play_money`: not real funds. */
  availability: z.enum(['routable', 'redirect_only', 'play_money']),
  /** Human text, e.g. "CFTC-regulated, US OK". */
  text: z.string(),
});
export type VenueLabel = z.infer<typeof VenueLabel>;
/** Per-caller Venue availability: Vault can route / use the Venue's own site / not available. */
export const Availability = z.enum(['routable', 'redirect', 'blocked']);
export type Availability = z.infer<typeof Availability>;

export const MarketStatus = z.enum(['open', 'closed', 'resolved']);
export type MarketStatus = z.infer<typeof MarketStatus>;

/**
 * Fee model. `curve`: per-share fee = rate * (p * (1 - p)) ^ exponent, charged to takers only
 * if `takerOnly`. Venues with other models add a new `kind`. Fee-adjusted effective price is
 * computed in packages/domain from this.
 */
export const FeeSchedule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('curve'),
    rate: DecimalString,
    exponent: z.number(),
    takerOnly: z.boolean(),
  }),
]);
export type FeeSchedule = z.infer<typeof FeeSchedule>;

export const NormalizedOutcome = z.object({
  /** Venue-native outcome id (Polymarket: CLOB token id). Unique within the Market. */
  externalId: z.string().min(1),
  label: z.string(),
  /** Position in the Venue's outcome list (0 = first, usually YES). */
  index: z.number().int().nonnegative(),
});
export type NormalizedOutcome = z.infer<typeof NormalizedOutcome>;

export const NormalizedMarket = z.object({
  venueId: VenueId,
  /** Venue-native market id, unique within the Venue (Polymarket: condition id). */
  externalId: z.string().min(1),
  slug: z.string().nullable(),
  question: z.string(),
  /** Resolution rules text as published by the Venue. */
  description: z.string(),
  resolutionSource: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  status: MarketStatus,
  endDate: z.iso.datetime().nullable(),
  /** Lifetime traded volume in USD. */
  volume: DecimalString,
  /** Current resting liquidity in USD. */
  liquidity: DecimalString,
  imageUrl: z.string().nullable(),
  /** Deep link to this Market on the Venue's own site. */
  url: z.string().url(),
  fee: FeeSchedule,
  outcomes: z.array(NormalizedOutcome).min(1),
  /** Venue-specific extras the Executor may need later (tick size, neg-risk flag, ...). */
  meta: z.record(z.string(), z.unknown()),
});
export type NormalizedMarket = z.infer<typeof NormalizedMarket>;

export const BookLevel = z.object({ price: PriceString, size: DecimalString });
export type BookLevel = z.infer<typeof BookLevel>;

/** Raw resting orders for one Outcome. Level order is not guaranteed; consumers sort. */
export const OrderBook = z.object({
  outcomeExternalId: z.string(),
  bids: z.array(BookLevel),
  asks: z.array(BookLevel),
  lastTradePrice: PriceString.nullable(),
  observedAt: z.iso.datetime(),
});
export type OrderBook = z.infer<typeof OrderBook>;

/** Best bid/ask and depth for one Outcome at one moment. Derived from an OrderBook. */
export const Quote = z.object({
  outcomeExternalId: z.string(),
  bid: PriceString.nullable(),
  ask: PriceString.nullable(),
  last: PriceString.nullable(),
  /** USD notional resting on each side of the fetched book. */
  bidDepth: DecimalString,
  askDepth: DecimalString,
  observedAt: z.iso.datetime(),
});
export type Quote = z.infer<typeof Quote>;

export const PricePoint = z.object({ ts: z.iso.datetime(), price: PriceString });
export type PricePoint = z.infer<typeof PricePoint>;
