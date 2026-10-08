/** Shapes of the Novig v3 public catalog responses we read (docs.novig.com). Lenient. */
import { z } from '@paras/shared';

export const NovigMarket = z.object({
  marketId: z.string(),
  description: z.string(),
  eventId: z.string(),
  marketType: z.string().nullish(),
  strike: z.string().nullish(),
  /** `OPEN` for tradable Markets. */
  status: z.string(),
  startsTs: z.number().nullish(),
  /** Two entries; the array has no fixed order. */
  outcomes: z.array(z.object({ outcomeId: z.string(), name: z.string() })),
});
export type NovigMarket = z.infer<typeof NovigMarket>;

export const NovigMarkets = z.object({
  items: z.array(z.unknown()),
  next: z.string().nullish(),
});

export const NovigEvents = z.object({
  items: z.array(
    z.object({
      eventId: z.string(),
      description: z.string(),
      sport: z.string().nullish(),
      league: z.string().nullish(),
    }),
  ),
});

/** Resting buy orders per outcome id; `qty` counts contracts that each pay 1 cent. */
export const NovigBook = z.object({
  orders: z.record(z.string(), z.array(z.object({ price: z.string(), qty: z.number() }))),
});
export type NovigBook = z.infer<typeof NovigBook>;
