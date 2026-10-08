import { schema } from '@paras/db';
import {
  beginnerPicks,
  hiddenEventIds,
  rankFeed,
  taxonomyNode,
  type FeedCandidate,
  type FeedEntry,
  type FeedSignal,
} from '@paras/domain';
import { apiRoutes, type Feed, type FeedItem } from '@paras/shared';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import type { AuthContext } from '../auth/guard.js';
import { QUOTE_STALE_AFTER_MS } from '../deps.js';
import { HttpError, notFound } from '../errors.js';
import { eventExists, loadEventViews, searchEventIds } from '../events/queries.js';
import { anonKey, followRows, followWhere, ownerKeyOf } from '../feed/store.js';
import { implement, type HandlerCtx } from '../implement.js';
import { headerGeo, viewerCountries } from '../jurisdiction.js';
import { anonCookie, mintAnonToken } from '../profile/store.js';
import type { RoutePlugin } from './index.js';

/** Candidate pool: the most-traded open Events (plus followed ones). */
const POOL = 300;
const SIGNAL_WINDOW_MS = 90 * 24 * 3600_000;
const SIGNAL_LIMIT = 500;

const { events, eventTags, feedSignals, follows, interestProfiles } = schema;

export const feedRoutes: RoutePlugin = (
  app,
  { db, auth: authDeps, now = () => new Date(), geo = headerGeo, feedWeights },
) => {
  type Ctx = HandlerCtx<AuthContext | null>;

  /** Owner for a write: signed-out callers without a token get a fresh one (cookie set). */
  const writeOwner = ({ request, reply, auth }: Ctx) => {
    const existing = ownerKeyOf(request, auth);
    if (existing) return { key: existing, minted: null };
    const minted = mintAnonToken();
    void reply.header('set-cookie', anonCookie(minted, authDeps.config.secureCookie));
    return { key: anonKey(minted), minted };
  };

  implement(
    app,
    apiRoutes.getFeed,
    async ({ query }, ctx): Promise<Feed> => {
      const offset = Number(query.cursor ?? 0);
      if (!Number.isInteger(offset) || offset < 0) {
        throw new HttpError(400, 'validation_error', 'invalid cursor');
      }
      const at = now();
      const key = ownerKeyOf(ctx.request, ctx.auth);

      const [profile] = ctx.auth
        ? await db
            .select()
            .from(interestProfiles)
            .where(eq(interestProfiles.userId, ctx.auth.userId))
        : key
          ? await db
              .select()
              .from(interestProfiles)
              .where(eq(interestProfiles.anonTokenHash, key.slice(2)))
          : [];

      const followList = key ? await followRows(db, key) : [];
      const followedEvents = followList.filter((f) => f.kind === 'event').map((f) => f.targetId);
      const signalRows = key
        ? await db
            .select()
            .from(feedSignals)
            .where(
              and(
                eq(feedSignals.ownerKey, key),
                gt(feedSignals.createdAt, new Date(at.getTime() - SIGNAL_WINDOW_MS)),
              ),
            )
            .orderBy(desc(feedSignals.createdAt))
            .limit(SIGNAL_LIMIT)
        : [];

      const poolIds = await searchEventIds(db, {
        status: 'open',
        includePlayMoney: false,
        sort: 'volume',
        now: at,
        limit: POOL,
        offset: 0,
      });
      const ids = [...new Set([...poolIds.slice(0, POOL), ...followedEvents])];
      const rows = ids.length
        ? await db
            .select()
            .from(events)
            .where(and(inArray(events.id, ids), eq(events.status, 'open')))
        : [];
      const tagIds = [...new Set([...rows.map((r) => r.id), ...signalRows.map((s) => s.eventId)])];
      const tagRows = tagIds.length
        ? await db.select().from(eventTags).where(inArray(eventTags.eventId, tagIds))
        : [];
      const tagsOf = new Map<string, string[]>();
      for (const t of [...tagRows].sort((a, b) => Number(b.score) - Number(a.score))) {
        tagsOf.set(t.eventId, [...(tagsOf.get(t.eventId) ?? []), t.tagId]);
      }

      const candidates: FeedCandidate[] = rows.map((r) => ({
        id: r.id,
        volume: Number(r.volume),
        liquidity: Number(r.liquidity),
        move24h: Number(r.move24h),
        trendingScore: r.trendingScore,
        endDate: r.endDate,
        createdAt: r.createdAt,
        tags: tagsOf.get(r.id) ?? [],
        embedding: r.embedding,
      }));
      const signals: FeedSignal[] = signalRows.map((s) => ({
        eventId: s.eventId,
        kind: s.kind,
        at: s.createdAt,
        tags: tagsOf.get(s.eventId) ?? [],
      }));
      const feedProfile = profile
        ? {
            embedding: profile.embedding,
            picks: [...profile.categories, ...profile.topics, ...profile.entities],
            experience: profile.experience,
            riskAppetite: profile.riskAppetite,
          }
        : null;
      const ranked = rankFeed({
        candidates,
        profile: feedProfile,
        signals,
        follows: {
          events: new Set(followedEvents),
          tags: new Set(followList.filter((f) => f.kind !== 'event').map((f) => f.targetId)),
        },
        now: at,
        weights: feedWeights,
      });

      const page = ranked.slice(offset, offset + query.limit);
      const wantBeginners =
        offset === 0 && (!profile?.experience || profile.experience === 'beginner');
      const starters = wantBeginners
        ? beginnerPicks(candidates, hiddenEventIds(signals, at), feedWeights)
        : [];

      const { countries } = await viewerCountries(db, geo, ctx.request, ctx.auth);
      const views = new Map(
        (
          await loadEventViews(
            db,
            [...new Set([...page, ...starters].map((e) => e.eventId))],
            at,
            QUOTE_STALE_AFTER_MS,
            countries,
            { includePlayMoney: false },
          )
        ).map((v) => [v.id, v]),
      );
      const toItems = (entries: FeedEntry[]): FeedItem[] =>
        entries.flatMap((e) => {
          const event = views.get(e.eventId);
          return event ? [{ event, score: e.score, reason: e.reason }] : [];
        });

      return {
        items: toItems(page),
        beginners: toItems(starters),
        personalized: !!feedProfile && (!!feedProfile.embedding || feedProfile.picks.length > 0),
        nextCursor: ranked.length > offset + query.limit ? String(offset + query.limit) : null,
      };
    },
    { auth: 'optional' },
  );

  implement(
    app,
    apiRoutes.recordFeedSignal,
    async ({ body }, ctx) => {
      if (!(await eventExists(db, body.eventId))) throw notFound('Event');
      const { key, minted } = writeOwner(ctx);
      await db
        .insert(feedSignals)
        .values({ ownerKey: key, eventId: body.eventId, kind: body.kind });
      return { ok: true as const, anonToken: minted };
    },
    { auth: 'optional' },
  );

  implement(
    app,
    apiRoutes.listFollows,
    async (_req, ctx) => {
      const key = ownerKeyOf(ctx.request, ctx.auth);
      const rows = key ? await followRows(db, key) : [];
      return {
        items: rows
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((r) => ({
            kind: r.kind,
            targetId: r.targetId,
            createdAt: r.createdAt.toISOString(),
          })),
      };
    },
    { auth: 'optional' },
  );

  implement(
    app,
    apiRoutes.addFollow,
    async ({ body }, ctx) => {
      if (body.kind === 'event') {
        if (!(await eventExists(db, body.targetId).catch(() => false))) throw notFound('Event');
      } else {
        const kind = taxonomyNode(body.targetId)?.kind;
        const ok =
          body.kind === 'entity' ? kind === 'entity' : kind === 'topic' || kind === 'category';
        if (!ok)
          throw new HttpError(400, 'validation_error', `unknown ${body.kind}: ${body.targetId}`);
      }
      const { key, minted } = writeOwner(ctx);
      await db
        .insert(follows)
        .values({ ownerKey: key, kind: body.kind, targetId: body.targetId })
        .onConflictDoNothing();
      return { ok: true as const, anonToken: minted };
    },
    { auth: 'optional' },
  );

  implement(
    app,
    apiRoutes.removeFollow,
    async ({ query }, ctx) => {
      const key = ownerKeyOf(ctx.request, ctx.auth);
      if (key) await db.delete(follows).where(followWhere(key, query.kind, query.targetId));
      return { ok: true as const };
    },
    { auth: 'optional' },
  );
};
