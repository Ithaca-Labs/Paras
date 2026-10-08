import { isStale } from '@paras/domain';
import { schema, type Database } from '@paras/db';
import type { EventView, MarketStatus, MarketView, QuoteStreamMessage } from '@paras/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

const { events, eventMarkets, markets, outcomes, latestQuotes, venues } = schema;

export interface ListFilter {
  status: MarketStatus | 'all';
  venue?: string | undefined;
  limit: number;
  offset: number;
}

/** Event ids by volume, highest first. Fetches one extra row so callers know if more exist. */
export async function listEventIds(db: Database, f: ListFilter): Promise<string[]> {
  const where = and(
    f.status === 'all' ? undefined : eq(events.status, f.status),
    f.venue
      ? sql`exists (
          select 1 from ${eventMarkets} em join ${markets} m on m.id = em.market_id
          where em.event_id = ${events.id} and m.venue_id = ${f.venue}
        )`
      : undefined,
  );
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(where)
    .orderBy(desc(events.volume), events.id)
    .limit(f.limit + 1)
    .offset(f.offset);
  return rows.map((r) => r.id);
}

/** Full EventViews (Markets, Outcomes, latest Quotes) for the ids, in the order given. */
export async function loadEventViews(
  db: Database,
  ids: readonly string[],
  now: Date,
  staleAfterMs: number,
): Promise<EventView[]> {
  if (!ids.length) return [];
  const eventRows = await db
    .select()
    .from(events)
    .where(inArray(events.id, [...ids]));
  const links = await db
    .select({ link: eventMarkets, market: markets, venue: venues })
    .from(eventMarkets)
    .innerJoin(markets, eq(markets.id, eventMarkets.marketId))
    .innerJoin(venues, eq(venues.id, markets.venueId))
    .where(inArray(eventMarkets.eventId, [...ids]))
    .orderBy(desc(markets.volume), markets.id);
  const marketIds = links.map((l) => l.market.id);
  const outcomeRows = marketIds.length
    ? await db
        .select({ outcome: outcomes, quote: latestQuotes })
        .from(outcomes)
        .leftJoin(latestQuotes, eq(latestQuotes.outcomeId, outcomes.id))
        .where(inArray(outcomes.marketId, marketIds))
        .orderBy(outcomes.index)
    : [];

  const outcomesByMarket = new Map<string, typeof outcomeRows>();
  for (const row of outcomeRows) {
    const list = outcomesByMarket.get(row.outcome.marketId) ?? [];
    list.push(row);
    outcomesByMarket.set(row.outcome.marketId, list);
  }

  const marketViews = new Map<string, MarketView[]>();
  for (const { link, market, venue } of links) {
    const rows = outcomesByMarket.get(market.id) ?? [];
    const times = rows.flatMap((r) => (r.quote ? [r.quote.observedAt] : []));
    const newest = times.length ? new Date(Math.max(...times.map((t) => t.getTime()))) : null;
    const view: MarketView = {
      id: market.id,
      venue: { id: venue.id, name: venue.name, capabilities: venue.capabilities },
      externalId: market.externalId,
      question: market.question,
      rules: market.description,
      resolutionSource: market.resolutionSource,
      status: market.status,
      volume: market.volume,
      liquidity: market.liquidity,
      fee: market.fee,
      url: market.url,
      redirectUrl: market.url,
      matchConfidence: link.confidence,
      outcomes: rows.map(({ outcome, quote }) => ({
        id: outcome.id,
        label: outcome.label,
        index: outcome.index,
        quote: quote && {
          bid: quote.bid,
          ask: quote.ask,
          last: quote.last,
          bidDepth: quote.bidDepth,
          askDepth: quote.askDepth,
          observedAt: quote.observedAt.toISOString(),
        },
      })),
      quotesUpdatedAt: newest?.toISOString() ?? null,
      stale: !newest || isStale(newest, now, staleAfterMs),
    };
    const list = marketViews.get(link.eventId) ?? [];
    list.push(view);
    marketViews.set(link.eventId, list);
  }

  const byId = new Map(eventRows.map((e) => [e.id, e]));
  return ids.flatMap((id) => {
    const e = byId.get(id);
    if (!e) return [];
    const ms = marketViews.get(id) ?? [];
    const times = ms.flatMap((m) => (m.quotesUpdatedAt ? [m.quotesUpdatedAt] : []));
    return [
      {
        id: e.id,
        title: e.title,
        description: e.description,
        category: e.category,
        status: e.status,
        endDate: e.endDate?.toISOString() ?? null,
        imageUrl: e.imageUrl,
        volume: e.volume,
        quotesUpdatedAt: times.length ? times.reduce((a, b) => (a > b ? a : b)) : null,
        markets: ms,
      },
    ];
  });
}

export async function eventExists(db: Database, id: string): Promise<boolean> {
  const rows = await db.select({ id: events.id }).from(events).where(eq(events.id, id)).limit(1);
  return rows.length > 0;
}

/** Current latest Quote for every Outcome of an Event, as stream messages. */
export async function loadEventQuotes(
  db: Database,
  eventId: string,
): Promise<QuoteStreamMessage[]> {
  const rows = await db
    .select({ market: markets, outcomeId: outcomes.id, quote: latestQuotes })
    .from(eventMarkets)
    .innerJoin(markets, eq(markets.id, eventMarkets.marketId))
    .innerJoin(outcomes, eq(outcomes.marketId, markets.id))
    .innerJoin(latestQuotes, eq(latestQuotes.outcomeId, outcomes.id))
    .where(eq(eventMarkets.eventId, eventId))
    .orderBy(markets.id, outcomes.index);
  return rows.map(({ market, outcomeId, quote }) => ({
    eventId,
    marketId: market.id,
    venueId: market.venueId,
    outcomeId,
    quote: {
      bid: quote.bid,
      ask: quote.ask,
      last: quote.last,
      bidDepth: quote.bidDepth,
      askDepth: quote.askDepth,
      observedAt: quote.observedAt.toISOString(),
    },
  }));
}
