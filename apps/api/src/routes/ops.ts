import { schema } from '@paras/db';
import { isStale } from '@paras/domain';
import { apiRoutes, type VenueHealth } from '@paras/shared';
import { asc, desc, eq, gt, max, sql } from 'drizzle-orm';
import { QUOTE_STALE_AFTER_MS } from '../deps.js';
import { assertAdmin } from '../auth/admin.js';
import { HttpError } from '../errors.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

const { executorPauses, latestQuotes, markets, outcomes, venueRuns, venues } = schema;
const DAY_MS = 24 * 3600_000;

export const opsRoutes: RoutePlugin = (app, { db, vault, now = () => new Date() }) => {
  const admin = { auth: 'required' as const };
  implement(
    app,
    apiRoutes.getVenueHealth,
    async (_req, { auth }) => {
      await assertAdmin(db, auth.userId);
      const t = now();
      const since = new Date(t.getTime() - DAY_MS);
      const [vs, quotes, runs, last] = await Promise.all([
        db.select({ id: venues.id, name: venues.name }).from(venues).orderBy(asc(venues.id)),
        db
          .select({ venueId: markets.venueId, at: max(latestQuotes.observedAt) })
          .from(latestQuotes)
          .innerJoin(outcomes, eq(outcomes.id, latestQuotes.outcomeId))
          .innerJoin(markets, eq(markets.id, outcomes.marketId))
          .where(eq(markets.status, 'open'))
          .groupBy(markets.venueId),
        db
          .select({
            venueId: venueRuns.venueId,
            n: sql<number>`count(*)::int`,
            bad: sql<number>`count(*) filter (where not ${venueRuns.ok})::int`,
          })
          .from(venueRuns)
          .where(gt(venueRuns.at, since))
          .groupBy(venueRuns.venueId),
        db
          .selectDistinctOn([venueRuns.venueId], {
            venueId: venueRuns.venueId,
            ok: venueRuns.ok,
            error: venueRuns.error,
          })
          .from(venueRuns)
          .orderBy(venueRuns.venueId, desc(venueRuns.at), desc(venueRuns.id)),
      ]);
      const okAt = await db
        .select({ venueId: venueRuns.venueId, at: max(venueRuns.at) })
        .from(venueRuns)
        .where(eq(venueRuns.ok, true))
        .groupBy(venueRuns.venueId);
      const by = <T extends { venueId: string }>(rows: T[]) =>
        new Map(rows.map((r) => [r.venueId, r]));
      const [q, r, l, s] = [by(quotes), by(runs), by(last), by(okAt)];
      const items: VenueHealth[] = vs.map((v) => {
        const quoteAt = q.get(v.id)?.at ?? null;
        const n = r.get(v.id)?.n ?? 0;
        const bad = r.get(v.id)?.bad ?? 0;
        const lastRun = l.get(v.id);
        const status =
          lastRun && !lastRun.ok
            ? 'erroring'
            : !quoteAt
              ? 'no_data'
              : isStale(quoteAt, t, QUOTE_STALE_AFTER_MS)
                ? 'stale'
                : 'ok';
        return {
          venueId: v.id,
          name: v.name,
          status,
          lastQuoteAt: quoteAt?.toISOString() ?? null,
          lastSuccessAt: s.get(v.id)?.at?.toISOString() ?? null,
          lastError: lastRun && !lastRun.ok ? lastRun.error : null,
          runs24h: n,
          errors24h: bad,
          errorRate: n ? bad / n : 0,
        };
      });
      return { staleAfterSeconds: QUOTE_STALE_AFTER_MS / 1000, items };
    },
    admin,
  );

  implement(
    app,
    apiRoutes.getPauses,
    async (_req, { auth }) => {
      await assertAdmin(db, auth.userId);
      const rows = await db.select().from(executorPauses).orderBy(asc(executorPauses.scope));
      return {
        items: rows.map((p) => ({
          scope: p.scope,
          reason: p.reason,
          pausedAt: p.pausedAt.toISOString(),
        })),
        vaultPaused: vault?.paused ? await vault.paused() : null,
      };
    },
    admin,
  );

  implement(
    app,
    apiRoutes.pauseExecutor,
    async ({ params, body }, { auth }) => {
      await assertAdmin(db, auth.userId);
      if (params.scope !== 'global') {
        const [v] = await db
          .select({ id: venues.id })
          .from(venues)
          .where(eq(venues.id, params.scope));
        if (!v) throw new HttpError(404, 'not_found', 'Unknown Venue');
      }
      const [row] = await db
        .insert(executorPauses)
        .values({
          scope: params.scope,
          reason: body.reason,
          pausedBy: auth.userId,
          pausedAt: now(),
        })
        .onConflictDoUpdate({
          target: executorPauses.scope,
          set: { reason: body.reason, pausedBy: auth.userId, pausedAt: now() },
        })
        .returning();
      return { scope: row!.scope, reason: row!.reason, pausedAt: row!.pausedAt.toISOString() };
    },
    admin,
  );

  implement(
    app,
    apiRoutes.unpauseExecutor,
    async ({ params }, { auth }) => {
      await assertAdmin(db, auth.userId);
      const gone = await db
        .delete(executorPauses)
        .where(eq(executorPauses.scope, params.scope))
        .returning({ s: executorPauses.scope });
      return { removed: gone.length > 0 };
    },
    admin,
  );
};
