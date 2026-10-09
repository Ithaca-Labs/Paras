import type { NormalizedMarket, Quote, VenueCapabilities } from '@paras/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  eventMarkets,
  events,
  follows,
  latestQuotes,
  markets,
  outcomes,
  positions,
  quoteSnapshots,
  venues,
} from './schema/index.js';

const CHUNK = 200;
const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export async function upsertVenue(
  db: Database,
  venue: { id: string; name: string; capabilities: VenueCapabilities },
): Promise<void> {
  await db
    .insert(venues)
    .values(venue)
    .onConflictDoUpdate({
      target: venues.id,
      set: { name: venue.name, capabilities: venue.capabilities, updatedAt: sql`now()` },
    });
}

/**
 * Upsert Markets and their Outcomes. A Market seen for the first time becomes its own
 * single-Venue Event; later syncs refresh that Event while it still holds only that Market.
 * Idempotent. Returns the number of Markets written.
 */
export async function upsertMarkets(
  db: Database,
  batch: readonly NormalizedMarket[],
): Promise<number> {
  for (const part of chunks(batch, CHUNK)) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .insert(markets)
        .values(
          part.map((m) => ({
            venueId: m.venueId,
            externalId: m.externalId,
            slug: m.slug,
            question: m.question,
            description: m.description,
            resolutionSource: m.resolutionSource,
            category: m.category,
            tags: m.tags,
            status: m.status,
            endDate: m.endDate ? new Date(m.endDate) : null,
            volume: m.volume,
            liquidity: m.liquidity,
            imageUrl: m.imageUrl,
            url: m.url,
            fee: m.fee,
            meta: m.meta,
          })),
        )
        .onConflictDoUpdate({
          target: [markets.venueId, markets.externalId],
          set: {
            slug: sql`excluded.slug`,
            question: sql`excluded.question`,
            description: sql`excluded.description`,
            resolutionSource: sql`excluded.resolution_source`,
            category: sql`excluded.category`,
            tags: sql`excluded.tags`,
            status: sql`excluded.status`,
            endDate: sql`excluded.end_date`,
            volume: sql`excluded.volume`,
            liquidity: sql`excluded.liquidity`,
            imageUrl: sql`excluded.image_url`,
            url: sql`excluded.url`,
            fee: sql`excluded.fee`,
            meta: sql`excluded.meta`,
            syncedAt: sql`now()`,
          },
        })
        .returning({ id: markets.id, venueId: markets.venueId, externalId: markets.externalId });
      const idOf = new Map(rows.map((r) => [`${r.venueId}\u0000${r.externalId}`, r.id]));

      await tx
        .insert(outcomes)
        .values(
          part.flatMap((m) =>
            m.outcomes.map((o) => ({
              marketId: idOf.get(`${m.venueId}\u0000${m.externalId}`)!,
              externalId: o.externalId,
              label: o.label,
              index: o.index,
            })),
          ),
        )
        .onConflictDoUpdate({
          target: [outcomes.marketId, outcomes.externalId],
          set: { label: sql`excluded.label`, index: sql`excluded.index` },
        });

      const marketIds = rows.map((r) => r.id);
      // New Markets: seed a single-Venue Event each.
      const unlinked = await tx
        .select({ id: markets.id })
        .from(markets)
        .leftJoin(eventMarkets, eq(eventMarkets.marketId, markets.id))
        .where(and(inArray(markets.id, marketIds), sql`${eventMarkets.marketId} is null`));
      if (unlinked.length) {
        const eventIdOf = new Map(unlinked.map((u) => [u.id, crypto.randomUUID()]));
        await tx.insert(events).values(
          [...eventIdOf.keys()].map((marketId) => ({
            id: eventIdOf.get(marketId)!,
            title: '',
            status: 'open' as const,
          })),
        );
        await tx
          .insert(eventMarkets)
          .values([...eventIdOf].map(([marketId, eventId]) => ({ eventId, marketId })));
      }
      // Single-Market Events mirror their Market (matching merges later; merged Events are left alone).
      await tx.execute(sql`
        update ${events} e set
          title = case when e.label_locked then e.title else m.question end,
          description = m.description,
          liquidity = m.liquidity,
          status = m.status,
          end_date = m.end_date,
          image_url = m.image_url,
          volume = m.volume
        from ${eventMarkets} em
        join ${markets} m on m.id = em.market_id
        where em.event_id = e.id
          and m.id in (${sql.join(
            marketIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
          and (select count(*) from ${eventMarkets} x where x.event_id = e.id) = 1
      `);
    });
  }
  return batch.length;
}

export interface RecordQuotesOptions {
  /** Observation time used for snapshot decisions; default now. */
  now?: Date;
  /** Write a snapshot at least this often even if the Quote is unchanged. Default 5 min. */
  snapshotEveryMs?: number;
}

/**
 * Persist Quotes for one Venue: always refresh `latest_quotes`; append a `quote_snapshots` row
 * when the Quote changed or the previous snapshot is older than `snapshotEveryMs`.
 * Quotes for unknown Outcomes are ignored. Returns counts.
 */
export async function recordQuotes(
  db: Database,
  venueId: string,
  quotes: readonly Quote[],
  { now = new Date(), snapshotEveryMs = 5 * 60_000 }: RecordQuotesOptions = {},
): Promise<{ updated: number; snapshots: number }> {
  let updated = 0;
  let snapshots = 0;
  for (const part of chunks(quotes, CHUNK)) {
    await db.transaction(async (tx) => {
      const known = await tx
        .select({ id: outcomes.id, externalId: outcomes.externalId })
        .from(outcomes)
        .innerJoin(markets, eq(markets.id, outcomes.marketId))
        .where(
          and(
            eq(markets.venueId, venueId),
            inArray(
              outcomes.externalId,
              part.map((q) => q.outcomeExternalId),
            ),
          ),
        );
      const idOf = new Map(known.map((k) => [k.externalId, k.id]));
      const rows = part.flatMap((q) => {
        const outcomeId = idOf.get(q.outcomeExternalId);
        return outcomeId
          ? [
              {
                outcomeId,
                bid: q.bid,
                ask: q.ask,
                last: q.last,
                bidDepth: q.bidDepth,
                askDepth: q.askDepth,
                observedAt: new Date(q.observedAt),
              },
            ]
          : [];
      });
      if (!rows.length) return;

      const prev = await tx
        .select()
        .from(latestQuotes)
        .where(
          inArray(
            latestQuotes.outcomeId,
            rows.map((r) => r.outcomeId),
          ),
        );
      const prevOf = new Map(prev.map((p) => [p.outcomeId, p]));
      const lastSnapshot = await tx
        .select({
          outcomeId: quoteSnapshots.outcomeId,
          at: sql<Date>`max(${quoteSnapshots.observedAt})`.mapWith((v) => new Date(v as string)),
        })
        .from(quoteSnapshots)
        .where(
          inArray(
            quoteSnapshots.outcomeId,
            rows.map((r) => r.outcomeId),
          ),
        )
        .groupBy(quoteSnapshots.outcomeId);
      const snapAt = new Map(lastSnapshot.map((s) => [s.outcomeId, s.at]));

      const same = (a: string | null, b: string | null) =>
        a === b || (a !== null && b !== null && Number(a) === Number(b));
      const toSnapshot = rows.filter((r) => {
        const p = prevOf.get(r.outcomeId);
        const at = snapAt.get(r.outcomeId);
        const changed =
          !p ||
          !same(p.bid, r.bid) ||
          !same(p.ask, r.ask) ||
          !same(p.last, r.last) ||
          !same(p.bidDepth, r.bidDepth) ||
          !same(p.askDepth, r.askDepth);
        return changed || !at || now.getTime() - at.getTime() >= snapshotEveryMs;
      });

      await tx
        .insert(latestQuotes)
        .values(rows)
        .onConflictDoUpdate({
          target: latestQuotes.outcomeId,
          set: {
            bid: sql`excluded.bid`,
            ask: sql`excluded.ask`,
            last: sql`excluded.last`,
            bidDepth: sql`excluded.bid_depth`,
            askDepth: sql`excluded.ask_depth`,
            observedAt: sql`excluded.observed_at`,
          },
        });
      if (toSnapshot.length) await tx.insert(quoteSnapshots).values(toSnapshot);
      updated += rows.length;
      snapshots += toSnapshot.length;
    });
  }
  return { updated, snapshots };
}

/**
 * Outcome ids (Venue-native) of open Markets of a Venue, for Quote polling. Markets of followed Events
 * and open Vault positions come first, then the rest by volume, all within `limit` Markets.
 */
export async function listPollTargets(
  db: Database,
  venueId: string,
  limit: number,
): Promise<string[]> {
  const top = await db
    .select({ id: markets.id })
    .from(markets)
    .where(and(eq(markets.venueId, venueId), eq(markets.status, 'open')))
    .orderBy(
      sql`(exists (select 1 from ${eventMarkets} em join ${follows} f
            on f.kind = 'event' and f.target_id = em.event_id::text
            where em.market_id = ${markets.id})
          or exists (select 1 from ${positions} p
            where p.market_id = ${markets.id} and p.status = 'open')) desc`,
      sql`${markets.volume} desc`,
      markets.id,
    )
    .limit(limit);
  if (!top.length) return [];
  const rows = await db
    .select({ marketId: outcomes.marketId, externalId: outcomes.externalId })
    .from(outcomes)
    .where(
      inArray(
        outcomes.marketId,
        top.map((t) => t.id),
      ),
    )
    .orderBy(outcomes.index);
  const rank = new Map(top.map((t, i) => [t.id, i]));
  return rows
    .sort((a, b) => rank.get(a.marketId)! - rank.get(b.marketId)!)
    .map((r) => r.externalId);
}
