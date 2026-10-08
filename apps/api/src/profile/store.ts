import { createHash, randomBytes } from 'node:crypto';
import { schema, type Database } from '@paras/db';
import type { InterestProfile } from '@paras/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type ProfileRow = typeof schema.interestProfiles.$inferSelect;

export const ANON_COOKIE = 'paras_anon';
export const ANON_HEADER = 'x-paras-anon';
const ANON_MAX_AGE_S = 365 * 24 * 3600;

export const hashAnon = (t: string) => createHash('sha256').update(t).digest('hex');
export const mintAnonToken = () => randomBytes(32).toString('base64url');

/** The anonymous profile token a signed-out caller presented (header wins over cookie). */
export function anonTokenOf(req: FastifyRequest): string | null {
  const h = req.headers[ANON_HEADER];
  if (typeof h === 'string' && h) return h;
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === ANON_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export const anonCookie = (token: string, secure: boolean, clear = false) =>
  `${ANON_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : ANON_MAX_AGE_S}${secure ? '; Secure' : ''}`;

export function toView(
  row: ProfileRow | null | undefined,
  opts: { anonymous: boolean; anonToken?: string | null },
): InterestProfile {
  return {
    status: (row?.status as 'skipped' | 'completed' | undefined) ?? 'none',
    anonymous: opts.anonymous,
    anonToken: opts.anonToken ?? null,
    categories: row?.categories ?? [],
    topics: row?.topics ?? [],
    entities: row?.entities ?? [],
    freeText: row?.freeText ?? [],
    experience: (row?.experience as InterestProfile['experience']) ?? null,
    riskAppetite: (row?.riskAppetite as InterestProfile['riskAppetite']) ?? null,
    stakeSize: (row?.stakeSize as InterestProfile['stakeSize']) ?? null,
    horizon: (row?.horizon as InterestProfile['horizon']) ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
  };
}

/**
 * Give `incoming` (an anonymous profile, or an absorbed User's) to `userId`. One profile per User:
 * the User's existing profile wins unless it only skipped onboarding and `incoming` completed it.
 */
async function adoptProfile(tx: Tx, incoming: ProfileRow, userId: string) {
  const [mine] = await tx
    .select()
    .from(schema.interestProfiles)
    .where(eq(schema.interestProfiles.userId, userId));
  if (mine && !(mine.status === 'skipped' && incoming.status === 'completed')) {
    await tx.delete(schema.interestProfiles).where(eq(schema.interestProfiles.id, incoming.id));
    return;
  }
  if (mine) await tx.delete(schema.interestProfiles).where(eq(schema.interestProfiles.id, mine.id));
  await tx
    .update(schema.interestProfiles)
    .set({ userId, anonTokenHash: null })
    .where(eq(schema.interestProfiles.id, incoming.id));
}

/** Sign-in hook: fold the visitor's anonymous profile (if any) into the User's. */
export function claimAnonProfile(db: Database, token: string, userId: string) {
  return db.transaction(async (tx) => {
    const [anon] = await tx
      .select()
      .from(schema.interestProfiles)
      .where(eq(schema.interestProfiles.anonTokenHash, hashAnon(token)));
    if (anon) await adoptProfile(tx, anon, userId);
  });
}

/** mergeUsers hook: the absorbed User's profile moves to the survivor (conflicts per adoptProfile). */
export async function mergeProfiles(tx: Tx, survivorId: string, absorbedId: string) {
  const [theirs] = await tx
    .select()
    .from(schema.interestProfiles)
    .where(eq(schema.interestProfiles.userId, absorbedId));
  if (theirs) await adoptProfile(tx, theirs, survivorId);
}
