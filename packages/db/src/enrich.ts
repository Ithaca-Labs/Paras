import { createHash } from 'node:crypto';
import {
  EMBEDDING_DIMENSIONS,
  eventEmbeddingText,
  tagEvent,
  trendingScore,
  type Embedder,
  type TaggingOptions,
  type TaxonomyIndex,
} from '@paras/domain';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { eventMarkets, events, eventTags, markets } from './schema/index.js';

const contentHash = (e: { title: string; description: string }) =>
  createHash('md5').update(`${e.title}\n${e.description}`).digest('hex');

export interface EnrichOptions {
  /** Events embedded per model call. */
  batchSize?: number;
  /** Cap per run; the rest is picked up next run. */
  maxEvents?: number;
  tagging?: Partial<TaggingOptions>;
}

/**
 * Ingestion-time enrichment: embed every Event whose title/description is new or changed and
 * (re)write its taxonomy tags and `category`. Idempotent; returns the number of Events enriched.
 */
export async function enrichEvents(
  db: Database,
  embedder: Embedder,
  index: TaxonomyIndex,
  { batchSize = 32, maxEvents = 5000, tagging }: EnrichOptions = {},
): Promise<number> {
  let done = 0;
  while (done < maxEvents) {
    const pending = await db
      .select({ id: events.id, title: events.title, description: events.description })
      .from(events)
      .where(
        sql`${events.title} <> '' and (${events.embeddedHash} is null
          or ${events.embeddedHash} <> md5(${events.title} || E'\n' || ${events.description}))`,
      )
      .orderBy(sql`${events.volume} desc`, events.id)
      .limit(Math.min(batchSize, maxEvents - done));
    if (!pending.length) break;

    const vectors = await embedder.embed(pending.map(eventEmbeddingText));
    const labels = await db
      .select({ eventId: eventMarkets.eventId, category: markets.category, tags: markets.tags })
      .from(eventMarkets)
      .innerJoin(markets, eq(markets.id, eventMarkets.marketId))
      .where(
        inArray(
          eventMarkets.eventId,
          pending.map((p) => p.id),
        ),
      );

    await db.transaction(async (tx) => {
      for (const [i, e] of pending.entries()) {
        const vector = vectors[i]!;
        if (vector.length !== EMBEDDING_DIMENSIONS) throw new Error('embedding dimension mismatch');
        const venueLabels = labels
          .filter((l) => l.eventId === e.id)
          .flatMap((l) => [...(l.category ? [l.category] : []), ...l.tags]);
        const result = tagEvent({ ...e, venueLabels, vector }, index, tagging);
        await tx
          .update(events)
          .set({ embedding: vector, embeddedHash: contentHash(e), category: result.category })
          .where(eq(events.id, e.id));
        await tx.delete(eventTags).where(eq(eventTags.eventId, e.id));
        if (result.tags.length) {
          await tx.insert(eventTags).values(
            result.tags.map((t) => ({
              eventId: e.id,
              tagId: t.id,
              kind: t.kind,
              score: String(t.score),
              source: t.source,
            })),
          );
        }
      }
    });
    done += pending.length;
  }
  return done;
}

/**
 * Recompute `move_24h` (largest Outcome price change vs ~24h ago, from Quote snapshots) and
 * `trending_score` for open Events. Cheap; run after each Quote poll.
 */
export async function refreshEventSignals(db: Database, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const floor = new Date(now.getTime() - 36 * 3600_000).toISOString();
  await db.execute(sql`
    update ${events} e set move_24h = coalesce(m.mv, 0)
    from ${events} e2
    left join (
      select em.event_id, max(abs(cur.p - prev.p)) as mv
      from ${eventMarkets} em
      join outcomes o on o.market_id = em.market_id
      join latest_quotes lq on lq.outcome_id = o.id
      cross join lateral (select coalesce(lq.last, (lq.bid + lq.ask) / 2) as p) cur
      join lateral (
        select coalesce(qs.last, (qs.bid + qs.ask) / 2) as p
        from quote_snapshots qs
        where qs.outcome_id = o.id and qs.observed_at >= ${floor}::timestamptz
        order by (qs.observed_at > ${cutoff}::timestamptz),
                 abs(extract(epoch from (qs.observed_at - ${cutoff}::timestamptz)))
        limit 1
      ) prev on true
      group by em.event_id
    ) m on m.event_id = e2.id
    where e2.id = e.id and e.status = 'open'
  `);
  const open = await db
    .select({
      id: events.id,
      volume: events.volume,
      move24h: events.move24h,
      endDate: events.endDate,
    })
    .from(events)
    .where(eq(events.status, 'open'));
  for (let i = 0; i < open.length; i += 500) {
    const part = open.slice(i, i + 500);
    const values = sql.join(
      part.map(
        (e) =>
          sql`(${e.id}::uuid, ${trendingScore({
            volume: Number(e.volume),
            move24h: Number(e.move24h),
            endDate: e.endDate,
            now,
          })}::double precision)`,
      ),
      sql`, `,
    );
    await db.execute(
      sql`update ${events} e set trending_score = v.s from (values ${values}) as v(id, s) where e.id = v.id`,
    );
  }
}
