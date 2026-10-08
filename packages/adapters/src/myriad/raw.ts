/** Shapes of the Myriad API v2 responses we read (api-v2.myriadprotocol.com). Lenient. */
import { z } from '@paras/shared';

const priceChart = z.object({
  timeframe: z.string(),
  prices: z.array(z.object({ value: z.number(), timestamp: z.number() })),
});

export const MyriadOutcome = z.object({
  id: z.number(),
  title: z.string(),
  price: z.number().nullish(),
  bestBid: z.object({ price: z.number() }).passthrough().nullish().or(z.number().nullish()),
  bestAsk: z.object({ price: z.number() }).passthrough().nullish().or(z.number().nullish()),
  /** Only on the detail endpoint. */
  price_charts: z.array(priceChart).nullish(),
});
export type MyriadOutcome = z.infer<typeof MyriadOutcome>;

export const MyriadMarket = z.object({
  id: z.number(),
  networkId: z.number(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  /** `open` | `closed` | `resolved`. */
  state: z.string(),
  voided: z.boolean().nullish(),
  /** `amm` | `ob`. */
  tradingModel: z.string().nullish(),
  expiresAt: z.string().nullish(),
  topics: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  resolutionSource: z.string().nullish(),
  imageUrl: z.string().nullish(),
  /** Collateral token; `PTS` is Myriad's points currency (play money). */
  token: z.object({ symbol: z.string() }),
  liquidity: z.number().nullish(),
  volume: z.number().nullish(),
  outcomes: z.array(MyriadOutcome),
});
export type MyriadMarket = z.infer<typeof MyriadMarket>;

export const MyriadList = z.object({
  data: z.array(z.unknown()),
  pagination: z.object({ hasNext: z.boolean() }),
});

/** `[price, amount]` pairs, 1e18-scaled integer strings. */
export const MyriadBook = z.object({
  bids: z.array(z.tuple([z.string(), z.string()])),
  asks: z.array(z.tuple([z.string(), z.string()])),
});
