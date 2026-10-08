import { schema, type Database } from '@paras/db';
import { desc, eq } from 'drizzle-orm';

const { eventMarkets, markets, outcomes, latestQuotes, venues } = schema;

export type CompareRow = {
  market: typeof markets.$inferSelect;
  venue: typeof venues.$inferSelect;
  link: typeof eventMarkets.$inferSelect;
  outcome: typeof outcomes.$inferSelect;
  quote: typeof latestQuotes.$inferSelect | null;
  /** Direction-normalized label, shared by the same Outcome on every Venue. */
  label: string;
};

/**
 * Every Outcome of an Event's Markets grouped by normalized label, in first-seen order.
 * Binary Markets linked `inverse` swap their labels (Market YES is Event NO). A Market linked
 * with a `candidate` is one candidate of a multi-outcome Event: its YES is the candidate, its NO
 * is "Not <candidate>".
 */
export async function loadOutcomeGroups(
  db: Database,
  eventId: string,
): Promise<Map<string, CompareRow[]>> {
  const rows = await db
    .select({
      market: markets,
      venue: venues,
      link: eventMarkets,
      outcome: outcomes,
      quote: latestQuotes,
    })
    .from(eventMarkets)
    .innerJoin(markets, eq(markets.id, eventMarkets.marketId))
    .innerJoin(venues, eq(venues.id, markets.venueId))
    .innerJoin(outcomes, eq(outcomes.marketId, markets.id))
    .leftJoin(latestQuotes, eq(latestQuotes.outcomeId, outcomes.id))
    .where(eq(eventMarkets.eventId, eventId))
    .orderBy(desc(markets.volume), markets.id, outcomes.index);

  const perMarket = new Map<string, typeof rows>();
  for (const r of rows) perMarket.set(r.market.id, [...(perMarket.get(r.market.id) ?? []), r]);

  const groups = new Map<string, CompareRow[]>();
  for (const outs of perMarket.values()) {
    const binary = outs.length === 2;
    outs.forEach((r, pos) => {
      const { candidate, direction } = r.link;
      const pos0 = binary && direction === 'inverse' ? 1 - pos : pos;
      const label =
        candidate && binary
          ? pos0 === 0
            ? candidate
            : `Not ${candidate}`
          : binary && direction === 'inverse'
            ? outs[1 - pos]!.outcome.label
            : r.outcome.label;
      const key = label.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), { ...r, label: label.trim() }]);
    });
  }
  return groups;
}
