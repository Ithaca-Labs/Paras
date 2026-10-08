import { schema } from '@paras/db';
import { OAUTH_SCOPES, type OAuthScope } from '@paras/domain';
import { apiRoutes } from '@paras/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { HttpError, notFound } from '../errors.js';
import { implement } from '../implement.js';
import {
  ACCESS_PREFIX,
  OAuthError,
  decide,
  exchangeToken,
  findAccessToken,
  getClient,
  registerClient,
  validateAuthorize,
  type AuthorizeParams,
} from '../oauth/service.js';
import type { RoutePlugin } from './index.js';

type Form = Record<string, string | undefined>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title>` +
  `<body style="font:16px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem"><h1>${esc(title)}</h1>${body}</body>`;

const SCOPE_TEXT: Record<OAuthScope, string> = {
  'markets:read': 'Search and compare prediction markets',
  'feed:read': 'Read your personalized Feed',
  'portfolio:read': 'Read your Vault balances',
};

const AUTH_KEYS = [
  'client_id',
  'redirect_uri',
  'response_type',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
] as const;

const SIGN_IN_SCRIPT = `
const $=id=>document.getElementById(id),post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
$('go').onclick=async()=>{const email=$('email').value;const r=await post('/v1/auth/email/request',{email});
 $('msg').textContent=r.ok?'Code sent. Enter it below.':'Could not send code.';$('step2').hidden=!r.ok};
$('verify').onclick=async()=>{const r=await post('/v1/auth/email/verify',{email:$('email').value,code:$('code').value,session:'cookie'});
 if(r.ok)location.reload();else $('msg').textContent='Invalid code.'};`;

export const oauthRoutes: RoutePlugin = (app, { db, auth: authDeps, oauth }) => {
  const issuer = (oauth?.issuer ?? 'http://localhost:3000').replace(/\/$/, '');
  const now = () => authDeps.now();

  // Token and consent-form posts are application/x-www-form-urlencoded.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  const fail = (reply: FastifyReply, e: OAuthError, status = 400) =>
    reply
      .status(status)
      .header('cache-control', 'no-store')
      .send({ error: e.error, error_description: e.message });

  /** Errors with a trusted redirect_uri go back to the client; the rest are shown to the User. */
  const authorizeFailure = (reply: FastifyReply, e: unknown, p: AuthorizeParams) => {
    if (!(e instanceof OAuthError)) throw e;
    if (e.redirect && p.redirect_uri) {
      const to = new URL(p.redirect_uri);
      to.searchParams.set('error', e.error);
      to.searchParams.set('error_description', e.message);
      if (p.state) to.searchParams.set('state', p.state);
      return reply.redirect(to.toString());
    }
    return reply
      .status(400)
      .type('text/html')
      .send(page('Authorization error', `<p>${esc(e.message)}</p>`));
  };

  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [...OAUTH_SCOPES],
  }));

  app.post('/oauth/register', async (req, reply) => {
    try {
      const c = await registerClient(db, (req.body ?? {}) as { client_name?: string });
      return reply
        .status(201)
        .header('cache-control', 'no-store')
        .send({
          client_id: c.id,
          client_name: c.name,
          redirect_uris: c.redirectUris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          client_id_issued_at: Math.floor(c.createdAt.getTime() / 1000),
        });
    } catch (e) {
      if (e instanceof OAuthError) return fail(reply, e);
      throw e;
    }
  });

  app.post('/oauth/token', async (req, reply) => {
    try {
      const tokens = await exchangeToken(db, (req.body ?? {}) as Form, now());
      return reply.header('cache-control', 'no-store').send(tokens);
    } catch (e) {
      if (e instanceof OAuthError) return fail(reply, e);
      throw e;
    }
  });

  app.get('/oauth/authorize', async (req, reply) => {
    const q = req.query as Form;
    const p: AuthorizeParams = Object.fromEntries(AUTH_KEYS.map((k) => [k, q[k]]));
    let v;
    try {
      v = await validateAuthorize(db, p);
    } catch (e) {
      return authorizeFailure(reply, e, p);
    }
    if (oauth?.consentUrl) {
      const to = new URL(oauth.consentUrl);
      for (const k of AUTH_KEYS) if (p[k] !== undefined) to.searchParams.set(k, p[k]);
      return reply.redirect(to.toString());
    }
    // Plain fallback until the web consent screen (frontend) exists.
    const me = await app.authenticate(req);
    if (!me) {
      return reply.type('text/html').send(
        page(
          'Sign in to Paras',
          `<p>Sign in to connect <b>${esc(v.client.name)}</b> to your Paras account.</p>
<p><input id="email" type="email" placeholder="you@example.com"> <button id="go">Email me a code</button></p>
<p id="step2" hidden><input id="code" inputmode="numeric" placeholder="123456"> <button id="verify">Sign in</button></p>
<p id="msg"></p><script>${SIGN_IN_SCRIPT}</script>`,
        ),
      );
    }
    const hidden = AUTH_KEYS.filter((k) => p[k] !== undefined)
      .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k]!)}">`)
      .join('');
    const items = v.scopes.map((s) => `<li>${esc(SCOPE_TEXT[s])}</li>`).join('');
    return reply.type('text/html').send(
      page(
        `Connect ${v.client.name}`,
        `<p><b>${esc(v.client.name)}</b> wants to:</p><ul>${items}</ul>
<p>It cannot trade or move money. You can revoke access any time.</p>
<form method="post" action="/oauth/authorize">${hidden}
<button name="decision" value="approve">Allow</button> <button name="decision" value="deny">Deny</button></form>`,
      ),
    );
  });

  app.post('/oauth/authorize', async (req, reply) => {
    const body = (req.body ?? {}) as Form;
    const p: AuthorizeParams = Object.fromEntries(AUTH_KEYS.map((k) => [k, body[k]]));
    const me = await app.authenticate(req);
    if (!me) {
      return reply
        .status(401)
        .type('text/html')
        .send(page('Sign in required', '<p>Sign in, then retry.</p>'));
    }
    try {
      return reply.redirect(await decide(db, me.userId, p, body.decision === 'approve', now()));
    } catch (e) {
      return authorizeFailure(reply, e, p);
    }
  });

  // JSON API for the web consent screen and connected-apps management.
  implement(app, apiRoutes.getOAuthClient, async ({ params }) => {
    const c = await getClient(db, params.id);
    if (!c) throw notFound('Client');
    return { id: c.id, name: c.name };
  });

  implement(
    app,
    apiRoutes.authorizeOAuth,
    async ({ body }, { auth }) => {
      const { approve, ...p } = body;
      try {
        return { redirectUrl: await decide(db, auth.userId, p, approve, now()) };
      } catch (e) {
        if (e instanceof OAuthError) throw new HttpError(400, e.error, e.message);
        throw e;
      }
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.getTokenInfo,
    async (_req, { auth }) => {
      const token = auth.token.startsWith(ACCESS_PREFIX) ? auth.token : null;
      const p = token ? await findAccessToken(db, token, now()) : null;
      return {
        userId: auth.userId,
        // A web session is not scope-limited.
        scopes: p?.scopes ?? [...OAUTH_SCOPES],
        expiresAt: (p?.expiresAt ?? auth.sessionExpiresAt).toISOString(),
      };
    },
    { auth: 'required', scope: 'markets:read' },
  );

  implement(
    app,
    apiRoutes.listConnectedApps,
    async (_req, { auth }) => {
      const rows = await db
        .select({
          id: schema.oauthGrants.id,
          scopes: schema.oauthGrants.scopes,
          connectedAt: schema.oauthGrants.createdAt,
          clientId: schema.oauthClients.id,
          clientName: schema.oauthClients.name,
        })
        .from(schema.oauthGrants)
        .innerJoin(schema.oauthClients, eq(schema.oauthClients.id, schema.oauthGrants.clientId))
        .where(eq(schema.oauthGrants.userId, auth.userId));
      return {
        items: rows.map((r) => ({
          id: r.id,
          client: { id: r.clientId, name: r.clientName },
          scopes: r.scopes as OAuthScope[],
          connectedAt: r.connectedAt.toISOString(),
        })),
      };
    },
    { auth: 'required' },
  );

  implement(
    app,
    apiRoutes.revokeConnectedApp,
    async ({ params }, { auth }) => {
      // Tokens cascade with the grant.
      const gone = await db
        .delete(schema.oauthGrants)
        .where(
          and(eq(schema.oauthGrants.id, params.id), eq(schema.oauthGrants.userId, auth.userId)),
        )
        .returning({ id: schema.oauthGrants.id });
      if (!gone.length) throw notFound('Connected app');
      return { ok: true as const };
    },
    { auth: 'required' },
  );
};
