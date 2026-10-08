import type { Database } from '@paras/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../errors.js';
import { extractToken, findSession } from './sessions.js';
import type { AuthDeps } from './types.js';

/** The authenticated caller, resolved from a bearer token or the session cookie. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  sessionExpiresAt: Date;
  /** The raw token the caller presented (cookie or bearer). */
  token: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Resolve the caller's session, or null when signed out / token invalid or expired. */
    authenticate(req: FastifyRequest): Promise<AuthContext | null>;
    /** Like `authenticate` but throws 401 `unauthorized`. For routes not declared via `implement`. */
    requireUser(req: FastifyRequest): Promise<AuthContext>;
  }
}

/** Decorates the app with `authenticate` / `requireUser`. Called once from buildApp. */
export function registerAuthGuard(app: FastifyInstance, db: Database, auth: AuthDeps) {
  const cache = new WeakMap<FastifyRequest, AuthContext | null>();

  app.decorate('authenticate', async (req: FastifyRequest) => {
    if (cache.has(req)) return cache.get(req) ?? null;
    const token = extractToken(req);
    const session = token ? await findSession(db, auth, token) : null;
    const ctx: AuthContext | null =
      token && session
        ? {
            userId: session.userId,
            sessionId: session.id,
            sessionExpiresAt: session.expiresAt,
            token,
          }
        : null;
    cache.set(req, ctx);
    return ctx;
  });

  app.decorate('requireUser', async (req: FastifyRequest) => {
    const ctx = await app.authenticate(req);
    if (!ctx) throw new HttpError(401, 'unauthorized', 'Sign in required');
    return ctx;
  });
}
