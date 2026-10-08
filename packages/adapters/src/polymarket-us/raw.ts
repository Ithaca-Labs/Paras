/** Shapes of the Polymarket US gateway responses we read (gateway.polymarket.us/v1). Lenient. */
import { z } from '@paras/shared';

const numOrStr = z.union([z.string(), z.number()]);
const amount = z.object({ value: numOrStr });

export const UsMarket = z.object({
  id: numOrStr.optional(),
  slug: z.string(),
  question: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  endDate: z.string().nullish(),
  image: z.string().nullish(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  archived: z.boolean().nullish(),
  /** `MARKET_STATUS_OPEN` / `MARKET_STATUS_RESOLVED`. */
  status: z.string().nullish(),
  marketType: z.string().nullish(),
  orderPriceMinTickSize: z.number().nullish(),
  minimumTradeQty: z.number().nullish(),
  feeCoefficient: numOrStr.nullish(),
  /** Lifetime volume in shares; absent on most list rows. */
  volume: numOrStr.nullish(),
  /** Two sides: the `long` one is the instrument the book is quoted for. */
  marketSides: z.array(
    z.object({ description: z.string().nullish(), long: z.boolean().nullish() }),
  ),
});
export type UsMarket = z.infer<typeof UsMarket>;

export const UsMarkets = z.object({ markets: z.array(z.unknown()) });

const level = z.object({ px: amount, qty: numOrStr });
export const UsBook = z.object({
  marketData: z.object({
    bids: z.array(level),
    offers: z.array(level),
    stats: z.object({ lastTradePx: amount.nullish() }).nullish(),
  }),
});
export type UsBook = z.infer<typeof UsBook>;

export const UsHistory = z.object({
  history: z.array(
    z.object({
      timestamp: numOrStr,
      longPrice: z.number().nullish(),
      shortPrice: z.number().nullish(),
    }),
  ),
});
