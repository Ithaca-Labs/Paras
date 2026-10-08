import { isStale, reciprocalRankFusion, taxonomyNode } from '@paras/domain';
import { schema, type Database } from '@paras/db';
import type { EventView, MarketStatus, MarketView, QuoteStreamMessage } from '@paras/shared';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';

const { events, eventMarkets, eventTags, markets, outcomes, latestQuotes, venues } = schema;

export type EventSort =
  'relevance' | 'trending' | 'volume' | 'closing_soon' | 'newest' | 'biggest_move';

export interface ListFilter {
  status: MarketStatus | 'all';
  venue?: string | undefined;
  category?: string | undefined;
  topic?: string | undefined;
  entity?: string | undefined;
  closesAfter?: Date | undefined;
  closesBefore?: Date | undefined;
  minLiquidity?: number | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  sort: EventSort;
  /** Free-text query; with `queryVector` the search is hybrid (full-text + semantic). */
  q?: string | undefined;
  queryVector?: readonly number[] | null | undefined;
  now: Date;
  limit: number;
  offset: number;
}

/** Cosine similarity below this is not a semantic match. */
export const SEMANTIC_MIN_SIMILARITY = 0.2;
/** Candidates taken from each of full-text and semantic search before fusion (caps paging depth). */
const CANDIDATES = 200;

const hasTag = (tagId: string) => sql`exists (
  select 1 from ${eventTags} t where t.event_id = ${events.id} and t.tag_id = ${tagId}
)`;

const price = sql`coalesce(lq.last, (lq.bid + lq.ask) / 2)`;

function conditions(f: ListFilter) {
  return and(
    f.status === 'all' ? undefined : eq(events.status, f.status),
    f.venue
      ? sql`exists (
          select 1 from ${eventMarkets} em join ${markets} m on m.id = em.market_id
          where em.event_id = ${events.id} and m.venue_id = ${f.venue}
        )`
      : undefined,
    f.category ? hasTag(f.category) : undefined,
    f.topic ? hasTag(f.topic) : undefined,
    f.entity ? hasTag(f.entity) : undefined,
    f.closesAfter ? gte(events.endDate, f.closesAfter) : undefined,
    f.closesBefore ? lte(events.endDate, f.closesBefore) : undefined,
    f.minLiquidity !== undefined ? gte(events.liquidity, String(f.minLiquidity)) : undefined,
    f.minPrice !== undefined || f.maxPrice !== undefined
      ? sql`exists (
          select 1 from ${eventMarkets} em
          join ${outcomes} o on o.market_id = em.market_id
          join ${latestQuotes} lq on lq.outcome_id = o.id
          where em.event_id = ${events.id}
            ${f.minPrice !== undefined ? sql`and ${price} >= ${f.minPrice}` : sql``}
            ${f.maxPrice !== undefined ? sql`and ${price} <= ${f.maxPrice}` : sql``}
        )`
      : undefined,
    // "Closing soon" means still upcoming.
    f.sort === 'closing_soon' ? gt(events.endDate, f.now) : undefined,
  );
}

function order(sort: EventSort) {
  switch (sort) {
    case 'trending':
      return [desc(events.trendingScore), events.id];
    case 'closing_soon':
      return [asc(events.endDate), events.id];
    case 'newest':
      return [desc(events.createdAt), events.id];
    case 'biggest_move':
      return [desc(events.move24h), desc(events.volume), events.id];
    default:
      return [desc(events.volume), events.id];
  }
}

/** Event ids for the query. Fetches one extra row so callers know if more exist. */
export async function searchEventIds(db: Database, f: ListFilter): Promise<string[]> {
  const where = conditions(f);
  if (!f.q) {
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(where)
      .orderBy(...order(f.sort))
      .limit(f.limit + 1)
      .offset(f.offset);
    return rows.map((r) => r.id);
  }

  // Full-text: any query word may match (OR); semantic search supplies precision.
  const tsq = sql`replace(plainto_tsquery('english', ${f.q})::text, '&', '|')::tsquery`;
  const fts = await db
    .select({ id: events.id })
    .from(events)
    .where(and(where, sql`${events.searchTsv} @@ ${tsq}`))
    .orderBy(sql`ts_rank_cd(${events.searchTsv}, ${tsq}) desc`, events.id)
    .limit(CANDIDATES);
  const rankings = [fts.map((r) => r.id)];
  if (f.queryVector) {
    const vec = sql`${JSON.stringify(f.queryVector)}::vector`;
    const sem = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          where,
          isNotNull(events.embedding),
          sql`${events.embedding} <=> ${vec} <= ${1 - SEMANTIC_MIN_SIMILARITY}`,
        ),
      )
      .orderBy(sql`${events.embedding} <=> ${vec}`, events.id)
      .limit(CANDIDATES);
    rankings.push(sem.map((r) => r.id));
  }
  const fused = reciprocalRankFusion(rankings);
  let ids = [...fused].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  if (f.sort !== 'relevance' && ids.length) {
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(inArray(events.id, ids))
      .orderBy(...order(f.sort));
    ids = rows.map((r) => r.id);
  }
  return ids.slice(f.offset, f.offset + f.limit + 1);
}

/** Open Event counts per taxonomy tag id. */
export async function tagCounts(db: Database): Promise<Map<string, number>> {
  const rows = await db
    .select({ tagId: eventTags.tagId, n: sql<number>`count(*)::int` })
    .from(eventTags)
    .innerJoin(events, eq(events.id, eventTags.eventId))
    .where(eq(events.status, 'open'))
    .groupBy(eventTags.tagId);
  return new Map(rows.map((r) => [r.tagId, r.n]));
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
  const tagRows = await db
    .select()
    .from(eventTags)
    .where(inArray(eventTags.eventId, [...ids]))
    .orderBy(desc(eventTags.score), eventTags.tagId);
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
        liquidity: e.liquidity,
        move24h: e.move24h,
        tags: tagRows.flatMap((t) =>
          t.eventId === id
            ? [{ id: t.tagId, label: taxonomyNode(t.tagId)?.label ?? t.tagId, kind: t.kind }]
            : [],
        ),
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
