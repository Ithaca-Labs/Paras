/** Shapes of the Kalshi public trade API (v2) responses we read. Lenient: unknown fields are ignored. */
import { z } from '@paras/shared';

/** Kalshi sends fixed-point decimals as strings ("0.0900"). */
const fp = z.string().nullish();

export const KalshiMarket = z.object({
  ticker: z.string(),
  event_ticker: z.string(),
  market_type: z.string().nullish(),
  title: z.string().nullish(),
  yes_sub_title: z.string().nullish(),
  /** initialized | inactive | active | closed | determined | disputed | amended | finalized */
  status: z.string().nullish(),
  close_time: z.string().nullish(),
  rules_primary: z.string().nullish(),
  rules_secondary: z.string().nullish(),
  volume_fp: fp,
  yes_bid_dollars: fp,
  yes_bid_size_fp: fp,
  yes_ask_dollars: fp,
  yes_ask_size_fp: fp,
  price_level_structure: z.string().nullish(),
});
export type KalshiMarket = z.infer<typeof KalshiMarket>;

export const KalshiEvent = z.object({
  event_ticker: z.string(),
  series_ticker: z.string().nullish(),
  title: z.string().nullish(),
  category: z.string().nullish(),
  settlement_sources: z.array(z.object({ name: z.string().nullish() })).nullish(),
  markets: z.array(z.unknown()).nullish(),
});
export type KalshiEvent = z.infer<typeof KalshiEvent>;

export const KalshiEvents = z.object({
  events: z.array(z.unknown()),
  cursor: z.string().nullish(),
});

const levels = z.array(z.tuple([z.string(), z.string()]));
export const KalshiOrderBook = z.object({
  orderbook_fp: z.object({
    yes_dollars: levels.nullish(),
    no_dollars: levels.nullish(),
  }),
});

export const KalshiMarketDetail = z.object({ market: z.object({ event_ticker: z.string() }) });
export const KalshiEventDetail = z.object({
  event: z.object({ series_ticker: z.string().nullish() }),
});

export const KalshiCandle = z.object({
  end_period_ts: z.number(),
  price: z.object({ close_dollars: fp, previous_dollars: fp }).nullish(),
});
export type KalshiCandle = z.infer<typeof KalshiCandle>;

export const KalshiCandles = z.object({ candlesticks: z.array(KalshiCandle) });
