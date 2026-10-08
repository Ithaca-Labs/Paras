/** Shapes of the Predict.fun REST API responses we read (dev.predict.fun). Lenient. */
import { z } from '@paras/shared';

const numOrStr = z.union([z.string(), z.number()]);

export const PredictMarket = z.object({
  id: z.number(),
  title: z.string(),
  question: z.string().nullish(),
  description: z.string().nullish(),
  imageUrl: z.string().nullish(),
  categorySlug: z.string().nullish(),
  conditionId: z.string().nullish(),
  decimalPrecision: z.number().nullish(),
  isNegRisk: z.boolean().nullish(),
  /** `REGISTERED` | `PRICE_PROPOSED` | `PRICE_DISPUTED` | `PAUSED` | `UNPAUSED` | `RESOLVED`. */
  status: z.string().nullish(),
  /** `OPEN` | `CLOSED`. */
  tradingStatus: z.string().nullish(),
  /** Two entries: indexSet 1 is the YES-side outcome, 2 the NO-side outcome. */
  outcomes: z.array(z.object({ name: z.string(), indexSet: z.number() })),
  /** Shape unverified on mainnet (null on testnet); read leniently. */
  stats: z
    .object({ totalLiquidityUsd: numOrStr.nullish(), volumeTotalUsd: numOrStr.nullish() })
    .passthrough()
    .nullish(),
});
export type PredictMarket = z.infer<typeof PredictMarket>;

export const PredictList = z.object({
  data: z.array(z.unknown()),
  cursor: z.string().nullish(),
});

/** `[price, shares]`, YES side, best first. */
const level = z.tuple([z.number(), z.number()]);
export const PredictBook = z.object({
  data: z.object({
    bids: z.array(level),
    asks: z.array(level),
    updateTimestampMs: z.number().nullish(),
    lastOrderSettled: z.object({ price: z.string(), outcome: z.string() }).nullish(),
  }),
});

export type PredictBook = z.infer<typeof PredictBook>;

/** `y` is the YES chance in percent. */
export const PredictSeries = z.object({
  data: z.object({ series: z.array(z.object({ x: z.number(), y: z.number() })) }),
});
