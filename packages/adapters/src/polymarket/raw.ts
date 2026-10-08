/** Shapes of the Polymarket public API responses we read. Lenient on purpose: Gamma is undocumented-ish. */
import { z } from '@paras/shared';

const numOrStr = z.union([z.string(), z.number()]);

export const GammaMarket = z.object({
  id: z.string().optional(),
  question: z.string().optional(),
  conditionId: z.string().optional(),
  slug: z.string().nullish(),
  resolutionSource: z.string().nullish(),
  endDate: z.string().nullish(),
  description: z.string().nullish(),
  image: z.string().nullish(),
  /** JSON-encoded string array, e.g. '["Yes", "No"]'. */
  outcomes: z.string().nullish(),
  /** JSON-encoded string array of CLOB token ids, aligned with `outcomes`. */
  clobTokenIds: z.string().nullish(),
  volume: numOrStr.nullish(),
  volumeNum: z.number().nullish(),
  liquidity: numOrStr.nullish(),
  liquidityNum: z.number().nullish(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  enableOrderBook: z.boolean().nullish(),
  umaResolutionStatus: z.string().nullish(),
  negRisk: z.boolean().nullish(),
  orderPriceMinTickSize: z.number().nullish(),
  orderMinSize: z.number().nullish(),
  feesEnabled: z.boolean().nullish(),
  feeSchedule: z
    .object({
      rate: z.number(),
      exponent: z.number(),
      takerOnly: z.boolean().optional(),
    })
    .nullish(),
  events: z.array(z.object({ slug: z.string().nullish() })).nullish(),
});
export type GammaMarket = z.infer<typeof GammaMarket>;

export const GammaMarkets = z.array(z.unknown());

export const ClobBook = z.object({
  asset_id: z.string(),
  /** Epoch milliseconds, as a string. */
  timestamp: z.string().nullish(),
  bids: z.array(z.object({ price: z.string(), size: z.string() })),
  asks: z.array(z.object({ price: z.string(), size: z.string() })),
  last_trade_price: z.string().nullish(),
});
export type ClobBook = z.infer<typeof ClobBook>;

export const ClobBooks = z.array(z.unknown());

export const ClobHistory = z.object({
  history: z.array(z.object({ t: z.number(), p: z.number() })),
});
