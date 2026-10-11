import type { SmartMoneySignal } from '@paras/domain';
import { eq, inArray } from 'drizzle-orm';
import type { Database } from './client.js';
import { eventMarkets, smartMoneySignals } from './schema/index.js';

export type EventSmartMoney = SmartMoneySignal & { updatedAt: Date };

/** Strongest smart-money signal among each Event's Markets, oriented to the Event's YES. */
export async function eventSmartMoney(
  db: Database,
  eventIds: readonly string[],
): Promise<Map<string, EventSmartMoney>> {
  const out = new Map<string, EventSmartMoney>();
  if (!eventIds.length) return out;
  const rows = await db
    .select({
      eventId: eventMarkets.eventId,
      direction: eventMarkets.direction,
      signal: smartMoneySignals.signal,
      updatedAt: smartMoneySignals.updatedAt,
    })
    .from(eventMarkets)
    .innerJoin(smartMoneySignals, eq(smartMoneySignals.marketId, eventMarkets.marketId))
    .where(inArray(eventMarkets.eventId, [...eventIds]));
  for (const r of rows) {
    const flip = r.direction === 'inverse' ? -1 : 1;
    const cur = out.get(r.eventId);
    if (!cur || r.signal.strength > cur.strength) {
      out.set(r.eventId, { ...r.signal, lean: r.signal.lean * flip, updatedAt: r.updatedAt });
    }
  }
  return out;
}
