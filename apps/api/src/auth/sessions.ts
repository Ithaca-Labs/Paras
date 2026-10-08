import { createHash, randomBytes } from 'node:crypto';
import { schema, type Database } from '@paras/db';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, type AuthDeps } from './types.js';

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

export interface SessionInfo {
  id: string;
  userId: string;
  expiresAt: Date;
}

export async function createSession(db: Database, deps: AuthDeps, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(deps.now().getTime() + deps.config.sessionTtlMs);
  await db.insert(schema.authSessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

/** Bearer header wins over cookie. */
export function extractToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header) {
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    return m?.[1] ?? null;
  }
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function findSession(
  db: Database,
  deps: AuthDeps,
  token: string,
): Promise<SessionInfo | null> {
  const [row] = await db
    .select()
    .from(schema.authSessions)
    .where(
      and(
        eq(schema.authSessions.tokenHash, hashToken(token)),
        gt(schema.authSessions.expiresAt, deps.now()),
      ),
    );
  return row ? { id: row.id, userId: row.userId, expiresAt: row.expiresAt } : null;
}

export async function revokeSession(db: Database, id: string) {
  await db.delete(schema.authSessions).where(eq(schema.authSessions.id, id));
}

const serialize = (value: string, maxAge: number, secure: boolean) =>
  `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

export function setSessionCookie(
  reply: FastifyReply,
  deps: AuthDeps,
  token: string,
  expiresAt: Date,
) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - deps.now().getTime()) / 1000));
  void reply.header('set-cookie', serialize(token, maxAge, deps.config.secureCookie));
}

export function clearSessionCookie(reply: FastifyReply, deps: AuthDeps) {
  void reply.header('set-cookie', serialize('', 0, deps.config.secureCookie));
}
