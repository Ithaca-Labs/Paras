import { schema, type Database } from '@paras/db';
import type { AuthContext } from '../auth/guard.js';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { anonTokenOf, hashAnon } from '../profile/store.js';

export const userKey = (userId: string) => `u:${userId}`;
export const anonKey = (token: string) => `a:${hashAnon(token)}`;

/** Feed owner key of the caller, or null for a signed-out caller with no anonymous token. */
export function ownerKeyOf(req: FastifyRequest, auth: AuthContext | null): string | null {
  if (auth) return userKey(auth.userId);
  const token = anonTokenOf(req);
  return token ? anonKey(token) : null;
}

export const followRows = (db: Database, ownerKey: string) =>
  db.select().from(schema.follows).where(eq(schema.follows.ownerKey, ownerKey));

export const followWhere = (ownerKey: string, kind: string, targetId: string) =>
  and(
    eq(schema.follows.ownerKey, ownerKey),
    eq(schema.follows.kind, kind as 'event'),
    eq(schema.follows.targetId, targetId),
  );
