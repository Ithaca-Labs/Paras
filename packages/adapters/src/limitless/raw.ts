/** Shapes of the Limitless public REST responses we read. Lenient: the API is lightly documented. */
import { z } from '@paras/shared';

const numOrStr = z.union([z.string(), z.number()]);

export const LimitlessMarket = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  conditionId: z.string().nullish(),
  status: z.string().nullish(),
  expired: z.boolean().nullish(),
  tradeType: z.string().nullish(),
  marketType: z.string().nullish(),
  /** Epoch ms. */
  expirationTimestamp: z.number().nullish(),
  categories: z.array(z.string()).nullish(),
  tags: z.array(z.string()).nullish(),
  /** Raw collateral base units (USDC: 6 decimals). */
  volume: numOrStr.nullish(),
  volumeFormatted: numOrStr.nullish(),
  imageUrl: z.string().nullish(),
  logo: z.string().nullish(),
  collateralToken: z.object({ decimals: z.number().optional() }).nullish(),
  tokens: z.object({ yes: z.string(), no: z.string() }).nullish(),
  winningOutcomeIndex: z.number().nullish(),
  settings: z.object({ minSize: numOrStr.nullish() }).passthrough().nullish(),
  venue: z.object({ exchange: z.string().nullish() }).passthrough().nullish(),
  /** Present on `marketType: "group"`: the child Markets. */
  markets: z.array(z.unknown()).nullish(),
});
export type LimitlessMarket = z.infer<typeof LimitlessMarket>;

export const LimitlessActive = z.object({
  data: z.array(z.unknown()),
  totalMarketsCount: z.number().nullish(),
});

const level = z.object({ price: z.number(), size: numOrStr });

export const LimitlessBook = z.object({
  bids: z.array(level),
  asks: z.array(level),
  lastTradePrice: z.number().nullish(),
});
export type LimitlessBook = z.infer<typeof LimitlessBook>;

export const LimitlessHistory = z.object({
  prices: z.array(z.object({ timestamp: numOrStr, price: z.number() })),
});
