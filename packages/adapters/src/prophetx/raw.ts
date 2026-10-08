/** Shapes of the ProphetX Market Data API responses we read (docs.prophetx.co). Lenient. */
import { z } from '@paras/shared';

export const PxEvent = z.object({
  event_id: z.number(),
  tournament_name: z.string().nullish(),
  name: z.string().nullish(),
  sport_name: z.string().nullish(),
  /** ISO 8601 UTC. */
  scheduled: z.string().nullish(),
  /** `scheduled` | `live` | `finished` ... */
  status: z.string().nullish(),
});
export type PxEvent = z.infer<typeof PxEvent>;

export const PxEvents = z.object({ data: z.object({ sport_events: z.array(z.unknown()) }) });

/** v4: each entry of `selections` is itself a list (grouped by side). */
export const PxSelection = z.object({
  outcome_id: z.number().nullish(),
  name: z.string().nullish(),
  /** The tradeable instrument; unique within its Market. */
  strike_id: z.string().nullish(),
  /** American odds. */
  price: z.number().nullish(),
  quantity: z.number().nullish(),
});
export type PxSelection = z.infer<typeof PxSelection>;

export const PxMarket = z.object({
  id: z.number(),
  /** Only needed to group the flat-list response variant. */
  event_id: z.number().nullish(),
  name: z.string(),
  display_name: z.string().nullish(),
  type: z.string().nullish(),
  category_name: z.string().nullish(),
  strike: z.number().nullish(),
  selections: z.array(z.array(PxSelection)),
});
export type PxMarket = z.infer<typeof PxMarket>;

/** `{ "<event id>": [market, ...] }`; the docs warn a flat list may come back instead. */
export const PxMultiMarkets = z.object({
  data: z.union([z.record(z.string(), z.array(z.unknown())), z.array(z.unknown())]),
});
