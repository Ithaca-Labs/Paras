/** Shapes of the Opinion OpenAPI responses we read (openapi.opinion.trade/openapi). Lenient. */
import { z } from '@paras/shared';

const numOrStr = z.union([z.string(), z.number()]);

export const OpinionMarket = z.object({
  marketId: z.number(),
  marketTitle: z.string(),
  /** 1 Created, 2 Activated, 3 Resolving, 4 Resolved, 5 Failed, 6 Deleted. */
  status: z.number(),
  /** 0 binary, 1 categorical (children carry the tradeable binary Markets). */
  marketType: z.number().nullish(),
  rules: z.string().nullish(),
  labels: z.array(z.string()).nullish(),
  /** Epoch seconds; 0 = none. */
  cutoffAt: z.number().nullish(),
  volume: numOrStr.nullish(),
  yesLabel: z.string().nullish(),
  noLabel: z.string().nullish(),
  yesTokenId: z.string().nullish(),
  noTokenId: z.string().nullish(),
  thumbnailUrl: z.string().nullish(),
  coverUrl: z.string().nullish(),
  childMarkets: z.array(z.unknown()).nullish(),
});
export type OpinionMarket = z.infer<typeof OpinionMarket>;

export const OpinionList = z.object({
  result: z.object({ list: z.array(z.unknown()), total: z.number().nullish() }),
});

const level = z.object({ price: numOrStr, size: numOrStr });
export const OpinionBook = z.object({
  result: z.object({
    bids: z.array(level),
    asks: z.array(level),
    timestamp: z.number().nullish(),
  }),
});

export const OpinionLatest = z.object({ result: z.object({ price: numOrStr.nullish() }) });

export const OpinionHistory = z.object({
  result: z.object({ history: z.array(z.object({ p: numOrStr, t: z.number() })) }),
});
