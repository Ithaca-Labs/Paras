/** Shapes of the SX Bet public REST responses we read (api.sx.bet, no API key needed). */
import { z } from '@paras/shared';

export const SxMarket = z.object({
  marketHash: z.string(),
  status: z.string().nullish(),
  outcomeOneName: z.string(),
  outcomeTwoName: z.string(),
  outcomeVoidName: z.string().nullish(),
  teamOneName: z.string().nullish(),
  teamTwoName: z.string().nullish(),
  type: z.number().nullish(),
  /** Epoch seconds. */
  gameTime: z.number().nullish(),
  line: z.number().nullish(),
  mainLine: z.boolean().nullish(),
  sportXeventId: z.string().nullish(),
  sportLabel: z.string().nullish(),
  leagueId: z.number().nullish(),
  leagueLabel: z.string().nullish(),
  group1: z.string().nullish(),
  tradingModes: z.array(z.string()).nullish(),
});
export type SxMarket = z.infer<typeof SxMarket>;

export const SxMarketsPage = z.object({
  status: z.string().optional(),
  data: z.object({
    markets: z.array(z.unknown()),
    nextKey: z.string().nullish(),
  }),
});

/** `percentageOdds`: implied probability x 1e20. `size`: the resting maker's stake in USDC base units. */
const level = z.object({ percentageOdds: z.string(), size: z.string() });

export const SxSnapshot = z.object({
  status: z.string().optional(),
  data: z.object({
    marketHash: z.string(),
    outcomeOne: z.array(level),
    outcomeTwo: z.array(level),
  }),
});
export type SxSnapshot = z.infer<typeof SxSnapshot>;
