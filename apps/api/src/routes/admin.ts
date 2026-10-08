import {
  MatchError,
  approveReview,
  mergeEvents,
  rejectReview,
  schema,
  splitMarket,
  type Database,
} from '@paras/db';
import { apiRoutes, type AdminMarket } from '@paras/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import { assertAdmin } from '../auth/admin.js';
import { HttpError } from '../errors.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

const { eventMarkets, events, markets, matchReviews, outcomes } = schema;

const mapErr = async <T>(p: Promise<T>): Promise<T> =>
  p.catch((e: unknown) => {
    if (e instanceof MatchError) {
      throw new HttpError(e.code === 'not_found' ? 404 : 409, e.code, e.message);
    }
    throw e;
  });

async function adminMarkets(
  db: Database,
  ids: readonly string[],
): Promise<Map<string, AdminMarket>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select()
    .from(markets)
    .where(inArray(markets.id, [...ids]));
  const labels = await db
    .select({ marketId: outcomes.marketId, label: outcomes.label })
    .from(outcomes)
    .where(inArray(outcomes.marketId, [...ids]))
    .orderBy(outcomes.index);
  return new Map(
    rows.map((m) => [
      m.id,
      {
        id: m.id,
        venueId: m.venueId,
        question: m.question,
        rules: m.description,
        url: m.url,
        endDate: m.endDate?.toISOString() ?? null,
        outcomes: labels.filter((l) => l.marketId === m.id).map((l) => l.label),
      },
    ]),
  );
}

export const adminRoutes: RoutePlugin = (app, { db }) => {
  implement(
    app,
    apiRoutes.listMatchReviews,
    async ({ query }, { auth }) => {
      await assertAdmin(db, auth.userId);
      const rows = await db
        .select({ review: matchReviews, title: events.title })
        .from(matchReviews)
        .innerJoin(events, eq(events.id, matchReviews.eventId))
        .where(eq(matchReviews.status, query.status))
        .orderBy(desc(matchReviews.confidence), matchReviews.id)
        .limit(query.limit);
      const members = await db
        .select({ eventId: eventMarkets.eventId, marketId: eventMarkets.marketId })
        .from(eventMarkets)
        .where(
          inArray(
            eventMarkets.eventId,
            rows.map((r) => r.review.eventId),
          ),
        );
      const byId = await adminMarkets(db, [
        ...rows.map((r) => r.review.marketId),
        ...members.map((m) => m.marketId),
      ]);
      return {
        items: rows.map(({ review: r, title }) => ({
          id: r.id,
          status: r.status,
          confidence: r.confidence,
          direction: r.direction,
          candidate: r.candidate,
          createdAt: r.createdAt.toISOString(),
          market: byId.get(r.marketId)!,
          event: {
            id: r.eventId,
            title,
            markets: members
              .filter((m) => m.eventId === r.eventId)
              .map((m) => byId.get(m.marketId)!),
          },
        })),
      };
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.approveMatchReview,
    async ({ params }, { auth }) => {
      await assertAdmin(db, auth.userId);
      return mapErr(approveReview(db, params.id, auth.userId));
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.rejectMatchReview,
    async ({ params }, { auth }) => {
      await assertAdmin(db, auth.userId);
      await mapErr(rejectReview(db, params.id, auth.userId));
      return { id: params.id };
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.mergeEvents,
    async ({ body }, { auth }) => {
      await assertAdmin(db, auth.userId);
      return mapErr(mergeEvents(db, body.sourceEventId, body.targetEventId));
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.splitEvent,
    async ({ params, body }, { auth }) => {
      await assertAdmin(db, auth.userId);
      return mapErr(splitMarket(db, params.id, body.marketId));
    },
    { auth: 'required' },
  );
};
