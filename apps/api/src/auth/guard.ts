import type { Database } from '@paras/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../errors.js';
import type { OAuthScope } from '@paras/domain';
import { ACCESS_PREFIX, findAccessToken } from '../oauth/service.js';
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
    /**
     * Like `authenticate`, but also accepts an OAuth access token holding `scope` (MCP clients).
     * A bad/revoked token is 401, a token without the scope 403. Plain `authenticate` never
     * accepts OAuth tokens, so they cannot reach routes that don't opt in.
     */
    authenticateScoped(req: FastifyRequest, scope: OAuthScope): Promise<AuthContext | null>;
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

  app.decorate('authenticateScoped', async (req: FastifyRequest, scope: OAuthScope) => {
    const token = extractToken(req);
    if (!token?.startsWith(ACCESS_PREFIX)) return app.authenticate(req);
    const p = await findAccessToken(db, token, auth.now());
    if (!p)
      throw new HttpError(401, 'invalid_token', 'Access token is invalid, expired or revoked');
    if (!p.scopes.includes(scope)) {
      throw new HttpError(403, 'insufficient_scope', `Token lacks the ${scope} scope`);
    }
    return { userId: p.userId, sessionId: '', sessionExpiresAt: p.expiresAt, token };
  });

  app.decorate('requireUser', async (req: FastifyRequest) => {
    const ctx = await app.authenticate(req);
    if (!ctx) throw new HttpError(401, 'unauthorized', 'Sign in required');
    return ctx;
  });
}
