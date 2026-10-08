import { signMagicLink, verifyMagicLink, type MagicLinkClaims } from '@paras/domain';
import { schema } from '@paras/db';
import { apiRoutes, type EventView } from '@paras/shared';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { QUOTE_STALE_AFTER_MS } from '../deps.js';
import { HttpError, notFound } from '../errors.js';
import { loadEventViews } from '../events/queries.js';
import { implement } from '../implement.js';
import { headerGeo, viewerCountries } from '../jurisdiction.js';
import type { RoutePlugin } from './index.js';

const { magicLinks } = schema;

/** Relative path a Magic Link lives at on the web app (also the auth `returnTo`). */
export const magicLinkPath = (token: string) => `/magic/${token}`;

export const magicLinkRoutes: RoutePlugin = (
  app,
  { db, now: viewNow = () => new Date(), magicLinks: ml, geo = headerGeo },
) => {
  const clock = () => ml.now();

  implement(
    app,
    apiRoutes.createMagicLink,
    async ({ body }, ctx) => {
      if (body.bindToUser && !ctx.auth) {
        throw new HttpError(401, 'unauthorized', 'Sign in to create a user-bound Magic Link');
      }
      const [event] = await loadEventViews(db, [body.eventId], viewNow(), QUOTE_STALE_AFTER_MS, []);
      if (!event) throw notFound('Event');

      let outcome: string | undefined;
      if (body.outcome !== undefined) {
        outcome = canonicalOutcome(event, body.outcome);
        if (!outcome) throw new HttpError(400, 'validation_error', 'Event has no such outcome');
      }

      const ttlMs = Math.min((body.ttlSeconds ?? 0) * 1000 || ml.defaultTtlMs, ml.maxTtlMs);
      const issuedAt = clock();
      const expiresAt = new Date(issuedAt.getTime() + ttlMs);
      const userId = body.bindToUser ? ctx.auth?.userId : undefined;
      const claims: MagicLinkClaims = {
        jti: randomUUID(),
        eventId: event.id,
        ...(outcome !== undefined && { outcome }),
        ...(body.amount !== undefined && { amount: body.amount }),
        ...(body.maxPrice !== undefined && { maxPrice: body.maxPrice }),
        source: body.source,
        ...(userId && { userId }),
        iat: Math.floor(issuedAt.getTime() / 1000),
        exp: Math.floor(expiresAt.getTime() / 1000),
      };
      const token = signMagicLink(claims, ml.keys);
      await db.insert(magicLinks).values({
        id: claims.jti,
        eventId: event.id,
        outcome: outcome ?? null,
        amount: body.amount ?? null,
        maxPrice: body.maxPrice ?? null,
        source: body.source,
        userId: userId ?? null,
        kid: ml.keys.activeKid,
        createdAt: issuedAt,
        expiresAt: new Date(claims.exp * 1000),
      });
      const returnTo = magicLinkPath(token);
      return {
        id: claims.jti,
        token,
        url: new URL(returnTo, ml.webBaseUrl).toString(),
        returnTo,
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      };
    },
    { auth: 'optional' },
  );

  implement(
    app,
    apiRoutes.resolveMagicLink,
    async ({ params }, ctx) => {
      const verdict = verifyMagicLink(params.token, ml.keys, Math.floor(clock().getTime() / 1000));
      if (!verdict.ok) {
        if (verdict.reason === 'expired') {
          throw new HttpError(410, 'magic_link_expired', 'This Magic Link has expired');
        }
        throw new HttpError(400, 'invalid_magic_link', 'Invalid Magic Link');
      }
      const c = verdict.claims;
      if (c.userId) {
        if (!ctx.auth) throw new HttpError(401, 'unauthorized', 'Sign in to open this Magic Link');
        if (ctx.auth.userId !== c.userId) {
          throw new HttpError(403, 'magic_link_wrong_user', 'This Magic Link is for another user');
        }
      }
      const { countries } = await viewerCountries(db, geo, ctx.request, ctx.auth);
      const [event] = await loadEventViews(
        db,
        [c.eventId],
        viewNow(),
        QUOTE_STALE_AFTER_MS,
        countries,
      );
      if (!event) throw notFound('Event');

      await db
        .update(magicLinks)
        .set({ resolveCount: sql`${magicLinks.resolveCount} + 1`, lastResolvedAt: clock() })
        .where(eq(magicLinks.id, c.jti));

      return {
        id: c.jti,
        event,
        outcome: c.outcome ?? null,
        amount: c.amount ?? null,
        maxPrice: c.maxPrice ?? null,
        source: c.source,
        bound: Boolean(c.userId),
        expiresAt: new Date(c.exp * 1000).toISOString(),
      };
    },
    { auth: 'optional' },
  );
};

/** The Event's own spelling of an Outcome label, matched case-insensitively. */
function canonicalOutcome(event: EventView, label: string): string | undefined {
  const want = label.trim().toLowerCase();
  for (const m of event.markets) {
    for (const o of m.outcomes) if (o.label.toLowerCase() === want) return o.label;
  }
  return undefined;
}
