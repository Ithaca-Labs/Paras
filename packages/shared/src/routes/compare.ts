import { defineRoute } from '../route.js';
import { DecimalString, PriceString, VenueId } from '../venue.js';
import { z } from '../zod.js';

/** What `stake` USD buys on one Venue by walking its order book, fees included. */
export const FillView = z.object({
  shares: DecimalString,
  /** Average price before fees. */
  avgPrice: DecimalString,
  fees: DecimalString,
  spent: DecimalString,
  /** spent / shares: the real cost of one share. */
  effectivePrice: DecimalString,
  /** Stake the book could not absorb (non-zero = partial fill). */
  unspent: DecimalString,
});
export type FillView = z.infer<typeof FillView>;

/** One Venue's price for one Outcome of the Event. */
export const VenueComparison = z.object({
  venue: z.object({ id: VenueId, name: z.string() }),
  routable: z.boolean(),
  marketId: z.string().uuid(),
  outcomeId: z.string().uuid(),
  /** Where "Bet on <Venue>" goes. */
  redirectUrl: z.string().url(),
  matchConfidence: DecimalString,
  bid: PriceString.nullable(),
  ask: PriceString.nullable(),
  /** USD resting on the ask side of the book. */
  askDepth: DecimalString,
  /** Taker fee per share at the best ask. */
  feePerShare: DecimalString.nullable(),
  /** Best ask plus fee: top-of-book cost of one share. */
  effectiveAsk: DecimalString.nullable(),
  /** Set when `stake` is given and the Venue's book could be read. */
  fill: FillView.nullable(),
  /** No fresh Quote, or Market not open. Stale entries are shown but never best. */
  stale: z.boolean(),
  observedAt: z.iso.datetime().nullable(),
});
export type VenueComparison = z.infer<typeof VenueComparison>;

export const OutcomeComparison = z.object({
  /** Outcome label, direction-normalized across Venues (or the candidate name). */
  label: z.string(),
  venues: z.array(VenueComparison),
  /** Best Venue: lowest effective ask, or the most shares for `stake`. Null if none is eligible. */
  best: z.object({ marketId: z.string().uuid(), outcomeId: z.string().uuid() }).nullable(),
  /** max - min mid price across fresh Venues; null with fewer than two. */
  spread: DecimalString.nullable(),
  /** Spread reached the divergence threshold. */
  divergent: z.boolean(),
});
export type OutcomeComparison = z.infer<typeof OutcomeComparison>;

export const EventComparison = z.object({
  eventId: z.string().uuid(),
  stake: DecimalString.nullable(),
  divergenceThreshold: DecimalString,
  asOf: z.iso.datetime(),
  outcomes: z.array(OutcomeComparison),
});
export type EventComparison = z.infer<typeof EventComparison>;

export const compareEvent = defineRoute({
  method: 'get',
  path: '/v1/events/{id}/compare',
  operationId: 'compareEvent',
  summary: 'Fee-adjusted cross-Venue comparison per Outcome, optionally size-aware via `stake`',
  tags: ['events'],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      /** USD to spend. Reads each Venue's live order book and returns an estimated fill. */
      stake: DecimalString.optional(),
      divergenceThreshold: DecimalString.default('0.05'),
    }),
  },
  response: EventComparison,
});

export const HISTORY_INTERVALS = ['1h', '6h', '1d', '1w', '1m'] as const;

export const EventHistory = z.object({
  eventId: z.string().uuid(),
  /** Outcome label the series are for. */
  outcome: z.string(),
  /** Every label available on this Event. */
  outcomes: z.array(z.string()),
  interval: z.enum(HISTORY_INTERVALS),
  bucketMinutes: z.number().int(),
  /** Shared time grid (ISO, ascending). Every series has one entry per timestamp. */
  timestamps: z.array(z.iso.datetime()),
  series: z.array(
    z.object({
      venueId: VenueId,
      marketId: z.string().uuid(),
      /** Last known price at each timestamp; null before the Venue's first point or if unavailable. */
      prices: z.array(PriceString.nullable()),
    }),
  ),
});
export type EventHistory = z.infer<typeof EventHistory>;

export const getEventHistory = defineRoute({
  method: 'get',
  path: '/v1/events/{id}/history',
  operationId: 'getEventHistory',
  summary: 'Chart-ready price history for one Outcome, aligned across Venues',
  tags: ['events'],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      interval: z.enum(HISTORY_INTERVALS).default('1d'),
      /** Outcome label (see `outcomes`); defaults to the first. */
      outcome: z.string().optional(),
    }),
  },
  response: EventHistory,
});
