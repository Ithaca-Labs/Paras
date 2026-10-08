import { defineRoute, defineSseRoute } from '../route.js';
import {
  DecimalString,
  FeeSchedule,
  MarketStatus,
  PriceString,
  VenueCapabilities,
  VenueId,
  VenueLabel,
} from '../venue.js';
import { z } from '../zod.js';

/** Latest Quote for an Outcome, as stored by the worker. */
export const QuoteView = z.object({
  bid: PriceString.nullable(),
  ask: PriceString.nullable(),
  last: PriceString.nullable(),
  /** USD notional resting on each side of the book. */
  bidDepth: DecimalString,
  askDepth: DecimalString,
  /** When Paras last observed this book. */
  observedAt: z.iso.datetime(),
});
export type QuoteView = z.infer<typeof QuoteView>;

export const OutcomeView = z.object({
  id: z.string().uuid(),
  label: z.string(),
  index: z.number().int(),
  /** Null until the first Quote has been polled. */
  quote: QuoteView.nullable(),
});
export type OutcomeView = z.infer<typeof OutcomeView>;

/** One Venue's Market within an Event. */
export const MarketView = z.object({
  id: z.string().uuid(),
  venue: z.object({
    id: VenueId,
    name: z.string(),
    capabilities: VenueCapabilities,
    label: VenueLabel,
  }),
  externalId: z.string(),
  question: z.string(),
  /** Resolution rules as published by the Venue. */
  rules: z.string(),
  resolutionSource: z.string().nullable(),
  status: MarketStatus,
  volume: DecimalString,
  liquidity: DecimalString,
  fee: FeeSchedule,
  /** Deep link to the Market on the Venue. */
  url: z.string().url(),
  /**
   * Where "Bet on <Venue>" sends the user: the exact Market page on the Venue's own site.
   * Set for every Venue; for non-routable Venues (Kalshi) it is the only way to act.
   */
  redirectUrl: z.string().url(),
  /** Confidence that this Market belongs to the Event (1 for the Event's own seed Market). */
  matchConfidence: DecimalString,
  outcomes: z.array(OutcomeView),
  /** Newest Quote observation across this Market's Outcomes. */
  quotesUpdatedAt: z.iso.datetime().nullable(),
  /** True when there is no Quote or the newest one is older than the staleness window. */
  stale: z.boolean(),
});
export type MarketView = z.infer<typeof MarketView>;

export const TagView = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['category', 'topic', 'entity']),
});
export type TagView = z.infer<typeof TagView>;

export const EventView = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  status: MarketStatus,
  endDate: z.iso.datetime().nullable(),
  imageUrl: z.string().nullable(),
  volume: DecimalString,
  liquidity: DecimalString,
  /** Largest absolute price change of any Outcome over ~24h, 0..1. */
  move24h: DecimalString,
  /** Taxonomy tags (category, topics, entities), best match first. */
  tags: z.array(TagView),
  /** Newest Quote observation across all Venues. */
  quotesUpdatedAt: z.iso.datetime().nullable(),
  markets: z.array(MarketView),
});
export type EventView = z.infer<typeof EventView>;

export const EventList = z.object({
  items: z.array(EventView),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type EventList = z.infer<typeof EventList>;

export const listEvents = defineRoute({
  method: 'get',
  path: '/v1/events',
  operationId: 'listEvents',
  summary:
    'Search and browse Events: hybrid full-text + semantic search (`q`), filters and sorts. Resolved/closed Events are hidden unless `status` says otherwise.',
  tags: ['events'],
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().optional(),
      /** Free text, e.g. "will the Fed cut in December". Matches by words and by meaning. */
      q: z.string().trim().min(1).max(300).optional(),
      status: z.enum(['open', 'closed', 'resolved', 'all']).default('open'),
      venue: VenueId.optional(),
      /** Include play-money Venues (e.g. Manifold). Hidden by default so they never read as real prices. */
      includePlayMoney: z.enum(['true', 'false']).default('false'),
      /** Taxonomy ids from `GET /v1/categories`. */
      category: z.string().optional(),
      topic: z.string().optional(),
      entity: z.string().optional(),
      /** Resolution date window. */
      closesAfter: z.iso.datetime().optional(),
      closesBefore: z.iso.datetime().optional(),
      /** Minimum total liquidity across Venues, USD. */
      minLiquidity: z.coerce.number().min(0).optional(),
      /** Keep Events with at least one Outcome priced within [minPrice, maxPrice] (0..1). */
      minPrice: z.coerce.number().min(0).max(1).optional(),
      maxPrice: z.coerce.number().min(0).max(1).optional(),
      /** Default: `relevance` when `q` is given, else `volume`. */
      sort: z
        .enum(['relevance', 'trending', 'volume', 'closing_soon', 'newest', 'biggest_move'])
        .optional(),
    }),
  },
  response: EventList,
});

export const getEvent = defineRoute({
  method: 'get',
  path: '/v1/events/{id}',
  operationId: 'getEvent',
  summary: 'Get one Event: prices, depth, freshness and Venue deep links',
  tags: ['events'],
  request: { params: z.object({ id: z.string().uuid() }) },
  response: EventView,
});

/** One `quote` SSE message: a fresh Quote for one Outcome of the Event. */
export const QuoteStreamMessage = z.object({
  eventId: z.string().uuid(),
  marketId: z.string().uuid(),
  venueId: VenueId,
  outcomeId: z.string().uuid(),
  quote: QuoteView,
});
export type QuoteStreamMessage = z.infer<typeof QuoteStreamMessage>;

export const streamEventQuotes = defineSseRoute({
  path: '/v1/events/{id}/stream',
  operationId: 'streamEventQuotes',
  summary:
    'Server-Sent Events: current Quotes on connect, then each new Quote for the Event (event: quote)',
  tags: ['events'],
  request: { params: z.object({ id: z.string().uuid() }) },
  event: QuoteStreamMessage,
});
