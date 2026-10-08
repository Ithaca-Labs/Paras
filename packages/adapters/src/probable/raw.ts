/** Shapes of the Probable public API responses we read. Lenient. */
import { z } from '@paras/shared';

const numOrStr = z.union([z.string(), z.number()]);

export const ProbableMarket = z.object({
  id: z.string(),
  condition_id: z.string().nullish(),
  question: z.string(),
  market_slug: z.string().nullish(),
  description: z.string().nullish(),
  /** JSON-encoded string arrays, as on Polymarket's Gamma API. */
  outcomes: z.string(),
  clobTokenIds: z.string(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  archived: z.boolean().nullish(),
  resolved: z.boolean().nullish(),
  endDate: z.string().nullish(),
  icon: z.string().nullish(),
  tags: z.array(z.unknown()).nullish(),
  liquidity: numOrStr.nullish(),
  volume24hr: numOrStr.nullish(),
});
export type ProbableMarket = z.infer<typeof ProbableMarket>;

export const ProbableList = z.object({
  markets: z.array(z.unknown()),
  pagination: z.object({ hasMore: z.boolean() }),
});

const level = z.object({ price: numOrStr, size: numOrStr });
export const ProbableBook = z.object({
  asset_id: z.string(),
  timestamp: z.string().nullish(),
  bids: z.array(level),
  asks: z.array(level),
  last_trade_price: numOrStr.nullish(),
});

export const ProbableHistory = z.object({
  history: z.array(z.object({ t: z.number(), p: z.number() })),
});
