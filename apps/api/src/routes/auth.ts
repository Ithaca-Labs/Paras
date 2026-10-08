import { schema } from '@paras/db';
import { eq } from 'drizzle-orm';
import { apiRoutes, type AuthResult } from '@paras/shared';
import { requestEmailCode, consumeEmailCode } from '../auth/email.js';
import { issueNonce, verifySiweMessage } from '../auth/siwe.js';
import {
  clearSessionCookie,
  createSession,
  revokeSession,
  setSessionCookie,
} from '../auth/sessions.js';
import { anonCookie, anonTokenOf, claimAnonProfile } from '../profile/store.js';
import { loadMe, resolveIdentity, type Identity } from '../auth/users.js';
import { implement, type HandlerCtx } from '../implement.js';
import type { RoutePlugin } from './index.js';

export const authRoutes: RoutePlugin = (app, { db, auth }) => {
  /** Shared tail of both login flows: resolve User, then reuse the live session (link) or start one. */
  async function finish(
    identity: Identity,
    mode: 'cookie' | 'bearer',
    returnTo: string | null,
    ctx: HandlerCtx<unknown>,
  ): Promise<AuthResult> {
    const current = await app.authenticate(ctx.request);
    const outcome = await resolveIdentity(db, identity, current?.userId ?? null);
    const listed =
      identity.kind === 'email'
        ? auth.config.adminEmails.includes(identity.email.toLowerCase())
        : auth.config.adminWallets.includes(identity.address.toLowerCase());
    if (listed) {
      await db
        .update(schema.users)
        .set({ role: 'admin' })
        .where(eq(schema.users.id, outcome.userId));
    }
    let token: string;
    let expiresAt: Date;
    if (current) {
      // Linking keeps the caller's session (a merge repoints it to the survivor).
      token = current.token;
      expiresAt = current.sessionExpiresAt;
    } else {
      ({ token, expiresAt } = await createSession(db, auth, outcome.userId));
      if (mode === 'cookie') setSessionCookie(ctx.reply, auth, token, expiresAt);
    }
    // Fold the visitor's anonymous Interest Profile into the User, then retire the anon cookie.
    const anon = anonTokenOf(ctx.request);
    if (anon) {
      await claimAnonProfile(db, anon, outcome.userId);
      void ctx.reply.header('set-cookie', anonCookie('', auth.config.secureCookie, true));
    }
    return {
      user: await loadMe(db, outcome.userId),
      token: mode === 'bearer' ? token : null,
      expiresAt: expiresAt.toISOString(),
      linked: outcome.linked,
      merged: outcome.merged,
      returnTo,
    };
  }

  implement(app, apiRoutes.getSiweNonce, async ({ query }) => {
    const { nonce, expiresAt } = await issueNonce(db, auth, query.returnTo);
    return { nonce, expiresAt: expiresAt.toISOString() };
  });

  implement(app, apiRoutes.verifySiwe, async ({ body }, ctx) => {
    const { address, chainId, returnTo } = await verifySiweMessage(db, auth, body);
    return finish({ kind: 'wallet', address, chainId }, body.session, returnTo, ctx);
  });

  implement(app, apiRoutes.requestEmailCode, async ({ body }, ctx) => {
    await requestEmailCode(db, auth, { ...body, ip: ctx.request.ip });
    return { ok: true as const };
  });

  implement(app, apiRoutes.verifyEmailCode, async ({ body }, ctx) => {
    const { email, returnTo } = await consumeEmailCode(db, auth, body);
    return finish({ kind: 'email', email }, body.session, returnTo, ctx);
  });

  implement(
    app,
    apiRoutes.logout,
    async (_req, ctx) => {
      await revokeSession(db, ctx.auth.sessionId);
      clearSessionCookie(ctx.reply, auth);
      return { ok: true as const };
    },
    { auth: 'required' },
  );

  implement(app, apiRoutes.getMe, (_req, ctx) => loadMe(db, ctx.auth.userId), {
    auth: 'required',
  });
};
