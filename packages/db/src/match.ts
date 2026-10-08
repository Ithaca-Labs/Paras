import {
  MATCH,
  applyVerification,
  evaluatePair,
  findCandidate,
  pairDirection,
  type MatchMarket,
  type MatchVerdict,
  type MatchVerifier,
} from '@paras/domain';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { eventMarkets, events, markets, matchReviews, outcomes } from './schema/index.js';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Operator action refused: `not_found`, or `conflict` when the state changed under the operator. */
export class MatchError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}

export interface MatchOptions {
  /** Optional second opinion on review-tier pairs. Off unless injected. */
  verifier?: MatchVerifier;
  /** Max verifier calls per run (the budget). Default 0 = never call it. */
  llmBudget?: number;
  /** Seeds scanned per run; the rest wait for the next run. */
  maxSeeds?: number;
  /** Embedding neighbours scored per seed. */
  neighbors?: number;
}

export interface MatchResult {
  scanned: number;
  linked: number;
  queued: number;
}

interface Member {
  id: string;
  venueId: string;
  question: string;
  endDate: Date | null;
  volume: string;
  outcomes: string[];
  source: 'auto' | 'operator';
  candidate: string | null;
}

/** Markets (with Outcome labels) of the given Events, grouped by Event. */
async function loadMembers(db: Database | Tx, eventIds: readonly string[]) {
  const out = new Map<string, Member[]>();
  if (!eventIds.length) return out;
  const rows = await db
    .select({
      eventId: eventMarkets.eventId,
      id: markets.id,
      venueId: markets.venueId,
      question: markets.question,
      endDate: markets.endDate,
      volume: markets.volume,
      source: eventMarkets.source,
      candidate: eventMarkets.candidate,
    })
    .from(eventMarkets)
    .innerJoin(markets, eq(markets.id, eventMarkets.marketId))
    .where(inArray(eventMarkets.eventId, [...eventIds]))
    .orderBy(desc(markets.volume), markets.id);
  const labels = await db
    .select({ marketId: outcomes.marketId, label: outcomes.label })
    .from(outcomes)
    .where(
      inArray(
        outcomes.marketId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(outcomes.index);
  const byMarket = new Map<string, string[]>();
  for (const l of labels) byMarket.set(l.marketId, [...(byMarket.get(l.marketId) ?? []), l.label]);
  for (const { eventId, ...r } of rows) {
    out.set(eventId, [...(out.get(eventId) ?? []), { ...r, outcomes: byMarket.get(r.id) ?? [] }]);
  }
  return out;
}

const asMatch = (m: Member): MatchMarket => ({
  question: m.question,
  endDate: m.endDate,
  outcomes: m.outcomes,
});

/** The Market that stands for the Event: biggest non-candidate Market (members are volume-ordered). */
const refOf = (members: Member[]) => members.find((m) => !m.candidate) ?? members[0]!;

/** Recompute an Event's display fields and totals from its linked Markets. */
async function refreshAggregate(tx: Tx | Database, eventId: string) {
  const members = (await loadMembers(tx, [eventId])).get(eventId);
  if (!members?.length) return;
  const ref = refOf(members);
  const [m] = await tx.select().from(markets).where(eq(markets.id, ref.id));
  const all = await tx
    .select({ volume: markets.volume, liquidity: markets.liquidity, status: markets.status })
    .from(eventMarkets)
    .innerJoin(markets, eq(markets.id, eventMarkets.marketId))
    .where(eq(eventMarkets.eventId, eventId));
  const sum = (k: 'volume' | 'liquidity') =>
    all.reduce((acc, r) => acc + Number(r[k]), 0).toString();
  await tx
    .update(events)
    .set({
      title: m!.question,
      description: m!.description,
      endDate: m!.endDate,
      imageUrl: m!.imageUrl,
      status: all.some((r) => r.status === 'open') ? 'open' : m!.status,
      volume: sum('volume'),
      liquidity: sum('liquidity'),
    })
    .where(eq(events.id, eventId));
}

interface LinkInput {
  hostEventId: string;
  marketId: string;
  confidence: number;
  direction: 'same' | 'inverse';
  candidate: string | null;
  source: 'auto' | 'operator';
}

/** Move a Market into an Event; drops the Event it leaves if that empties it. */
async function linkMarket(tx: Tx, l: LinkInput) {
  const [old] = await tx
    .delete(eventMarkets)
    .where(eq(eventMarkets.marketId, l.marketId))
    .returning({ eventId: eventMarkets.eventId });
  await tx.insert(eventMarkets).values({
    eventId: l.hostEventId,
    marketId: l.marketId,
    confidence: String(l.confidence),
    direction: l.direction,
    candidate: l.candidate,
    source: l.source,
  });
  await tx
    .delete(matchReviews)
    .where(and(eq(matchReviews.marketId, l.marketId), eq(matchReviews.status, 'pending')));
  if (old && old.eventId !== l.hostEventId) {
    const left = await tx
      .select({ id: eventMarkets.marketId })
      .from(eventMarkets)
      .where(eq(eventMarkets.eventId, old.eventId))
      .limit(1);
    if (left.length) await refreshAggregate(tx, old.eventId);
    else await tx.delete(events).where(eq(events.id, old.eventId));
  }
  await refreshAggregate(tx, l.hostEventId);
}

/** The same pair already waits in the queue the other way round (both Events get scanned as seeds). */
async function queuedReverse(tx: Tx, guestEventId: string, hostEventId: string) {
  const hostMarkets = await tx
    .select({ id: eventMarkets.marketId })
    .from(eventMarkets)
    .where(eq(eventMarkets.eventId, hostEventId));
  const rows = await tx
    .select({ id: matchReviews.id })
    .from(matchReviews)
    .where(
      and(
        eq(matchReviews.eventId, guestEventId),
        eq(matchReviews.status, 'pending'),
        inArray(
          matchReviews.marketId,
          hostMarkets.map((m) => m.id),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Matching run: for every Event that is a lone, automatically-seeded Market and has not been
 * scanned at its current content, take its embedding neighbours, apply the hard gates, and
 * auto-link / queue for review / leave separate by confidence. Venue-agnostic. Operator-linked
 * Markets are never moved, and rejected pairs are never proposed again.
 */
export async function runMatching(
  db: Database,
  { verifier, llmBudget = 0, maxSeeds = 2000, neighbors = 10 }: MatchOptions = {},
): Promise<MatchResult> {
  const result: MatchResult = { scanned: 0, linked: 0, queued: 0 };
  let budget = verifier ? llmBudget : 0;

  // Merged Events do not mirror their Markets on sync; keep totals fresh.
  const merged = await db
    .select({ id: eventMarkets.eventId })
    .from(eventMarkets)
    .groupBy(eventMarkets.eventId)
    .having(sql`count(*) > 1`);
  for (const { id } of merged) await refreshAggregate(db, id);

  const seeds = await db
    .select({ id: events.id })
    .from(events)
    .where(
      sql`${events.embeddedHash} is not null
        and ${events.matchedHash} is distinct from ${events.embeddedHash}
        and (select count(*) from ${eventMarkets} where event_id = ${events.id}) = 1
        and exists (select 1 from ${eventMarkets} where event_id = ${events.id} and source = 'auto')`,
    )
    .orderBy(desc(events.volume), asc(events.id))
    .limit(maxSeeds);

  for (const { id: seedId } of seeds) {
    await db.transaction(async (tx) => {
      // An earlier seed may have absorbed this one.
      const [seed] = await tx.select().from(events).where(eq(events.id, seedId));
      const seedMembers = (await loadMembers(tx, [seedId])).get(seedId);
      if (!seed || seedMembers?.length !== 1 || seedMembers[0]!.source !== 'auto') return;
      result.scanned++;
      const sm = seedMembers[0]!;
      const markScanned = () =>
        tx.update(events).set({ matchedHash: seed.embeddedHash }).where(eq(events.id, seedId));
      if (seed.status !== 'open' || !seed.embedding) return void (await markScanned());

      const vec = sql`${JSON.stringify(seed.embedding)}::vector`;
      const near = await tx
        .select({ id: events.id, sim: sql<number>`1 - (${events.embedding} <=> ${vec})` })
        .from(events)
        .where(
          and(
            sql`${events.id} <> ${seedId}`,
            eq(events.status, 'open'),
            sql`${events.embedding} is not null`,
            sql`1 - (${events.embedding} <=> ${vec}) >= ${MATCH.CANDIDATE_MIN_SIMILARITY}`,
          ),
        )
        .orderBy(sql`${events.embedding} <=> ${vec}`)
        .limit(neighbors);
      const targets = await loadMembers(
        tx,
        near.map((n) => n.id),
      );
      const rejected = new Set(
        (
          await tx
            .select({ m: matchReviews.marketId, e: matchReviews.eventId })
            .from(matchReviews)
            .where(eq(matchReviews.status, 'rejected'))
        ).map((r) => `${r.m}|${r.e}`),
      );

      interface Choice extends MatchVerdict {
        hostEventId: string;
        marketId: string;
        guestEventId: string;
      }
      let best: Choice | null = null;
      for (const { id: targetId, sim } of near) {
        const tm = targets.get(targetId);
        if (!tm?.length) continue;
        const tRef = refOf(tm);
        // A multi-outcome seed absorbs a lone binary target; otherwise the seed joins the target.
        const seedIsHost = sm.outcomes.length >= 3 && tRef.outcomes.length < 3;
        let hostId = targetId;
        let hostMembers = tm;
        let guest = sm;
        let guestEventId = seedId;
        if (seedIsHost) {
          if (tm.length !== 1 || tRef.source !== 'auto') continue;
          hostId = seedId;
          hostMembers = seedMembers;
          guest = tRef;
          guestEventId = targetId;
        }
        // A rejection holds in both directions of the pair.
        if (
          rejected.has(`${guest.id}|${hostId}`) ||
          hostMembers.some((h) => rejected.has(`${h.id}|${guestEventId}`))
        ) {
          continue;
        }
        let verdict = evaluatePair(asMatch(refOf(hostMembers)), asMatch(guest), sim);
        if (verdict.tier === 'separate') continue;
        const sameVenue = hostMembers.some(
          (h) =>
            h.venueId === guest.venueId &&
            (!verdict.candidate || h.candidate === verdict.candidate),
        );
        if (sameVenue) continue;
        if (verdict.tier === 'review' && verifier && budget > 0) {
          budget--;
          const answer = await verifier.verify(asMatch(refOf(hostMembers)), asMatch(guest));
          verdict = applyVerification(verdict, answer);
          if (verdict.tier === 'separate') continue;
        }
        if (!best || verdict.confidence > best.confidence) {
          best = { ...verdict, hostEventId: hostId, marketId: guest.id, guestEventId };
        }
      }

      if (best?.tier === 'auto') {
        await linkMarket(tx, {
          hostEventId: best.hostEventId,
          marketId: best.marketId,
          confidence: best.confidence,
          direction: best.direction,
          candidate: best.candidate,
          source: 'auto',
        });
        result.linked++;
      } else if (best && !(await queuedReverse(tx, best.guestEventId, best.hostEventId))) {
        await tx
          .insert(matchReviews)
          .values({
            marketId: best.marketId,
            eventId: best.hostEventId,
            confidence: String(best.confidence),
            direction: best.direction,
            candidate: best.candidate,
          })
          .onConflictDoNothing();
        result.queued++;
      }
      // The seed Event may be gone (absorbed); this is a no-op then.
      await markScanned();
    });
  }
  return result;
}

/** Operator approves a queued pair: the link is recorded as an operator override. */
export async function approveReview(db: Database, reviewId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .select()
      .from(matchReviews)
      .where(eq(matchReviews.id, reviewId))
      .for('update');
    if (!r) throw new MatchError('not_found', 'review not found');
    if (r.status !== 'pending') throw new MatchError('conflict', `review already ${r.status}`);
    const [link] = await tx
      .select({ eventId: eventMarkets.eventId })
      .from(eventMarkets)
      .where(eq(eventMarkets.marketId, r.marketId));
    const lone = link && (await loadMembers(tx, [link.eventId])).get(link.eventId)!.length === 1;
    if (!lone) throw new MatchError('conflict', 'Market is no longer a standalone Event');
    await tx
      .update(matchReviews)
      .set({ status: 'approved', decidedAt: new Date(), decidedBy: userId })
      .where(eq(matchReviews.id, reviewId));
    await linkMarket(tx, {
      hostEventId: r.eventId,
      marketId: r.marketId,
      confidence: Number(r.confidence),
      direction: r.direction,
      candidate: r.candidate,
      source: 'operator',
    });
    return { eventId: r.eventId };
  });
}

export async function rejectReview(db: Database, reviewId: string, userId: string) {
  const rows = await db
    .update(matchReviews)
    .set({ status: 'rejected', decidedAt: new Date(), decidedBy: userId })
    .where(and(eq(matchReviews.id, reviewId), eq(matchReviews.status, 'pending')))
    .returning({ id: matchReviews.id });
  if (!rows.length) throw new MatchError('conflict', 'review not found or already decided');
}

/** Operator merges every Market of `sourceId` into `targetId`. Persists; automatic matching never undoes it. */
export async function mergeEvents(db: Database, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new MatchError('conflict', 'cannot merge an Event into itself');
  return db.transaction(async (tx) => {
    const groups = await loadMembers(tx, [sourceId, targetId]);
    const source = groups.get(sourceId);
    const target = groups.get(targetId);
    if (!source || !target) throw new MatchError('not_found', 'Event not found');
    const ref = refOf(target);
    for (const m of source) {
      const candidate =
        ref.outcomes.length >= 3 && m.outcomes.length === 2
          ? findCandidate(ref.outcomes, m.question)
          : null;
      await linkMarket(tx, {
        hostEventId: targetId,
        marketId: m.id,
        confidence: 1,
        direction: candidate ? 'same' : pairDirection(ref.question, m.question),
        candidate,
        source: 'operator',
      });
    }
    return { eventId: targetId };
  });
}

/** Operator pulls a Market out of an Event into its own; the pair is never auto-proposed again. */
export async function splitMarket(db: Database, eventId: string, marketId: string) {
  return db.transaction(async (tx) => {
    const members = (await loadMembers(tx, [eventId])).get(eventId);
    if (!members?.some((m) => m.id === marketId))
      throw new MatchError('not_found', 'Market is not in this Event');
    if (members.length < 2) throw new MatchError('conflict', 'Event has a single Market');
    const [created] = await tx
      .insert(events)
      .values({ title: '', status: 'open' })
      .returning({ id: events.id });
    await linkMarket(tx, {
      hostEventId: created!.id,
      marketId,
      confidence: 1,
      direction: 'same',
      candidate: null,
      source: 'operator',
    });
    await tx
      .insert(matchReviews)
      .values({ marketId, eventId, confidence: '0', status: 'rejected', decidedAt: new Date() })
      .onConflictDoUpdate({
        target: [matchReviews.marketId, matchReviews.eventId],
        set: { status: 'rejected', decidedAt: new Date() },
      });
    return { eventId: created!.id };
  });
}
