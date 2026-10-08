import { schema } from '@paras/db';
import {
  EXPERIENCE_LEVELS,
  HORIZONS,
  RISK_APPETITES,
  STAKE_SIZES,
  buildTaxonomyIndex,
  explainerFor,
  nearestNodes,
  profileVector,
  taxonomyNode,
  type TagKind,
  type TaxonomyIndex,
} from '@paras/domain';
import { apiRoutes } from '@paras/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from '../auth/guard.js';
import { HttpError } from '../errors.js';
import { implement, type HandlerCtx } from '../implement.js';
import {
  anonCookie,
  anonTokenOf,
  hashAnon,
  mintAnonToken,
  toView,
  type ProfileRow,
} from '../profile/store.js';
import type { RoutePlugin } from './index.js';

/** Free-text suggestions below this cosine are noise. */
const MIN_SUGGESTION_SIMILARITY = 0.3;

export const profileRoutes: RoutePlugin = (app, { db, embedder, auth: authDeps }) => {
  let index: Promise<TaxonomyIndex> | undefined;
  const taxonomy = () => {
    index ??= buildTaxonomyIndex(embedder!).catch((e) => {
      index = undefined;
      throw e;
    });
    return index;
  };

  const col = schema.interestProfiles;
  type Ctx = HandlerCtx<AuthContext | null>;

  const find = async (req: FastifyRequest, auth: AuthContext | null) => {
    const token = auth ? null : anonTokenOf(req);
    const where = auth
      ? eq(col.userId, auth.userId)
      : token
        ? eq(col.anonTokenHash, hashAnon(token))
        : null;
    const [row] = where ? await db.select().from(col).where(where) : [];
    return { row: row as ProfileRow | undefined, token };
  };

  /** Insert or update the caller's row. Signed-out callers without a profile get a fresh anon token. */
  const save = async (
    { reply, auth }: Ctx,
    existing: ProfileRow | undefined,
    values: Partial<typeof col.$inferInsert>,
  ) => {
    const now = new Date();
    if (existing) {
      const [row] = await db
        .update(col)
        .set({ ...values, updatedAt: now })
        .where(eq(col.id, existing.id))
        .returning();
      return { row: row!, minted: null };
    }
    const minted = auth ? null : mintAnonToken();
    const [row] = await db
      .insert(col)
      .values({
        status: 'completed',
        ...values,
        ...(auth ? { userId: auth.userId } : { anonTokenHash: hashAnon(minted!) }),
      })
      .returning();
    if (minted) void reply.header('set-cookie', anonCookie(minted, authDeps.config.secureCookie));
    return { row: row!, minted };
  };

  implement(
    app,
    apiRoutes.getProfile,
    async (_req, ctx) => toView((await find(ctx.request, ctx.auth)).row, { anonymous: !ctx.auth }),
    { auth: 'optional' },
  );

  implement(
    app,
    apiRoutes.updateProfile,
    async ({ body }, ctx) => {
      const { row: existing } = await find(ctx.request, ctx.auth);
      const next = {
        categories: body.categories ?? existing?.categories ?? [],
        topics: body.topics ?? existing?.topics ?? [],
        entities: body.entities ?? existing?.entities ?? [],
        freeText: body.freeText ?? existing?.freeText ?? [],
      };
      for (const [kind, ids] of [
        ['category', next.categories],
        ['topic', next.topics],
        ['entity', next.entities],
      ] as const) {
        const bad = ids.find((id) => taxonomyNode(id)?.kind !== kind);
        if (bad) throw new HttpError(400, 'validation_error', `unknown ${kind} id: ${bad}`);
      }
      const embedding = await embedProfile(next);
      const pick = <K extends 'experience' | 'riskAppetite' | 'stakeSize' | 'horizon'>(k: K) =>
        body[k] === undefined ? (existing?.[k] ?? null) : body[k];
      const { row, minted } = await save(ctx, existing, {
        status: 'completed',
        ...next,
        experience: pick('experience'),
        riskAppetite: pick('riskAppetite'),
        stakeSize: pick('stakeSize'),
        horizon: pick('horizon'),
        embedding,
      });
      return toView(row, { anonymous: !ctx.auth, anonToken: minted });
    },
    { auth: 'optional' },
  );

  /** Profile vector, recomputed from the merged selection. Best-effort: null if embedding is down. */
  async function embedProfile(next: {
    categories: string[];
    topics: string[];
    entities: string[];
    freeText: string[];
  }): Promise<number[] | null> {
    if (!embedder) return null;
    try {
      const vectors = next.freeText.length ? await embedder.embed(next.freeText) : [];
      return profileVector(await taxonomy(), next, vectors);
    } catch (err) {
      app.log.warn({ err }, 'profile embedding failed; stored without vector');
      return null;
    }
  }

  implement(
    app,
    apiRoutes.skipOnboarding,
    async (_req, ctx) => {
      const { row: existing } = await find(ctx.request, ctx.auth);
      if (existing) return toView(existing, { anonymous: !ctx.auth });
      const { row, minted } = await save(ctx, undefined, { status: 'skipped' });
      return toView(row, { anonymous: !ctx.auth, anonToken: minted });
    },
    { auth: 'optional' },
  );

  implement(
    app,
    apiRoutes.resetProfile,
    async (_req, ctx) => {
      const { row } = await find(ctx.request, ctx.auth);
      if (row) await db.delete(col).where(eq(col.id, row.id));
      return { ok: true as const };
    },
    { auth: 'optional' },
  );

  implement(app, apiRoutes.getOnboardingOptions, () => ({
    experience: [...EXPERIENCE_LEVELS],
    riskAppetite: [...RISK_APPETITES],
    stakeSize: [...STAKE_SIZES],
    horizon: [...HORIZONS],
  }));

  implement(app, apiRoutes.interpretInterest, async ({ body }) => {
    if (!embedder) return { matches: [] };
    const [vector] = await embedder.embed([body.text]);
    const idx = await taxonomy();
    const matches = (['topic', 'entity'] as TagKind[])
      .flatMap((kind) => nearestNodes(idx, vector!, { kind, limit: 3 }))
      .filter((m) => m.similarity >= MIN_SUGGESTION_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .map(({ node, similarity }) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        similarity: Math.round(similarity * 1000) / 1000,
      }));
    return { matches };
  });

  implement(
    app,
    apiRoutes.getExplainer,
    async ({ query }, ctx) => {
      const experience =
        query.experience ??
        ((await find(ctx.request, ctx.auth)).row?.experience as 'beginner' | undefined) ??
        'beginner';
      return { experience, sections: explainerFor(experience) };
    },
    { auth: 'optional' },
  );
};
