/** Shapes of the PolyRouter v2 responses we read (docs.polyrouter.io OpenAPI). Lenient on purpose. */
import { z } from '@paras/shared';

const price = z.object({
  price: z.number(),
  bid: z.number().nullish(),
  ask: z.number().nullish(),
});

export const PrMarket = z.object({
  id: z.string().min(1),
  platform: z.string(),
  title: z.string().optional(),
  slug: z.string().nullish(),
  market_slug: z.string().nullish(),
  event_id: z.string().nullish(),
  description: z.string().nullish(),
  category: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  status: z.string(),
  outcomes: z.array(z.object({ id: z.string().min(1), name: z.string() })),
  current_prices: z.record(z.string(), price),
  volume_total: z.number().nullish(),
  liquidity: z.number().nullish(),
  source_url: z.string().nullish(),
  image_url: z.string().nullish(),
  trading_end_at: z.string().nullish(),
  resolution_source: z.string().nullish(),
  resolution_criteria: z.string().nullish(),
});
export type PrMarket = z.infer<typeof PrMarket>;

export const PrMarketsResponse = z.object({
  markets: z.array(z.unknown()),
  pagination: z.object({
    has_more: z.boolean(),
    next_cursor: z.string().nullish(),
  }),
});

export const PrHistoryResponse = z.object({
  data: z.array(
    z.object({
      timestamp: z.number(),
      price: z.object({ close: z.number() }),
      outcomeId: z.string().nullish(),
    }),
  ),
});
