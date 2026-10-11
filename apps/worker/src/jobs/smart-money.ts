import { NansenError, type NansenClient } from '@paras/adapters';
import { schema, type Database } from '@paras/db';
import { computeSmartMoney, cryptoSymbol, priceDirection } from '@paras/domain';
import { z } from '@paras/shared';
import { and, asc, desc, eq, lt, or, isNull, sql } from 'drizzle-orm';
import { defineJob } from './define.js';

export interface SmartMoneyContext {
  db: Database;
  nansen: NansenClient;
  /** Max credits per UTC day. */
  nansenDailyCap?: number;
  /** Hours a Market's signal stays fresh before refetch. */
  nansenTtlHours?: number;
  now?: () => Date;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const { markets, smartMoneySignals, nansenUsage } = schema;
const HOUR = 3_600_000;

export const SmartMoneyPayload = z.object({
  /** Markets refreshed per run, most-traded first. Each costs ~2 credits (+1 per crypto symbol). */
  maxMarkets: z.number().int().positive().default(3),
});

/**
 * Refreshes Nansen smart-money signals for the most-traded open Polymarket Markets whose cached
 * signal is older than the TTL. Stops when the daily credit cap is spent (free tier ~10/day).
 */
export function createSmartMoneyJob({
  db,
  nansen,
  nansenDailyCap = 8,
  nansenTtlHours = 24,
  now = () => new Date(),
  log,
}: SmartMoneyContext) {
  return defineJob({
    name: 'nansen.refresh-signals',
    payload: SmartMoneyPayload,
    handler: async ({ maxMarkets }) => {
      const at = now();
      const day = at.toISOString().slice(0, 10);
      const [usage] = await db.select().from(nansenUsage).where(eq(nansenUsage.day, day));
      let spent = usage?.credits ?? 0;
      const charge = async (credits: number) => {
        spent += credits;
        await db
          .insert(nansenUsage)
          .values({ day, credits })
          .onConflictDoUpdate({
            target: nansenUsage.day,
            set: { credits: sql`${nansenUsage.credits} + ${credits}` },
          });
      };

      const stale = new Date(at.getTime() - nansenTtlHours * HOUR);
      const targets = await db
        .select({ id: markets.id, externalId: markets.externalId, question: markets.question })
        .from(markets)
        .leftJoin(smartMoneySignals, eq(smartMoneySignals.marketId, markets.id))
        .where(
          and(
            eq(markets.venueId, 'polymarket'),
            eq(markets.status, 'open'),
            or(isNull(smartMoneySignals.marketId), lt(smartMoneySignals.updatedAt, stale)),
          ),
        )
        .orderBy(desc(sql`${markets.volume}::numeric`), asc(markets.id))
        .limit(maxMarkets);

      const netflows = new Map<string, number | null>();
      const since = new Date(at.getTime() - 24 * HOUR).toISOString();
      let refreshed = 0;
      try {
        for (const m of targets) {
          if (spent + 2 > nansenDailyCap) break;
          const holders = await nansen.topHolders(m.externalId);
          await charge(holders.credits);
          const trades = await nansen.tradesByMarket(m.externalId, since);
          await charge(trades.credits);

          const sym = cryptoSymbol(m.question);
          if (sym && !netflows.has(sym) && spent + 1 <= nansenDailyCap) {
            const nf = await nansen.netflow(sym, sym === 'MON' ? 'monad' : 'all');
            await charge(nf.credits);
            netflows.set(
              sym,
              nf.data
                .filter((r) => r.token_symbol === sym)
                .reduce((a, r) => a + r.net_flow_24h_usd, 0),
            );
          }
          const signal = computeSmartMoney({
            holders: holders.data,
            trades: trades.data,
            netflow24hUsd: sym ? (netflows.get(sym) ?? null) : null,
            netflowYesSign: priceDirection(m.question),
          });
          await db
            .insert(smartMoneySignals)
            .values({ marketId: m.id, signal, updatedAt: at })
            .onConflictDoUpdate({
              target: smartMoneySignals.marketId,
              set: { signal, updatedAt: at },
            });
          refreshed++;
        }
      } catch (err) {
        // Out of credits / rate limited: stop quietly, retry next run. Anything else is a real failure.
        if (!(err instanceof NansenError && [402, 429].includes(err.status))) throw err;
        log?.('nansen limit hit', { status: err.status });
      }
      log?.('smart money refreshed', { refreshed, creditsToday: spent, cap: nansenDailyCap });
    },
  });
}
