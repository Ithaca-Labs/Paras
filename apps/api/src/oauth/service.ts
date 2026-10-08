import { createHash, randomBytes } from 'node:crypto';
import {
  parseScopes,
  pkceMatches,
  redirectUriMatches,
  validRedirectUri,
  type OAuthScope,
} from '@paras/domain';
import { schema, type Database } from '@paras/db';
import { and, count, eq, gt, lt, not, sql } from 'drizzle-orm';

export const ACCESS_TTL_MS = 3600_000;
export const REFRESH_TTL_MS = 30 * 24 * 3600_000;
const CODE_TTL_MS = 60_000;
/** Token prefix: lets the session guard skip OAuth tokens without a lookup. */
export const ACCESS_PREFIX = 'pat_';

const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const rand = (prefix = '') => prefix + randomBytes(32).toString('base64url');

/** `redirect: true` = safe to send the error back to the client's redirect_uri; else show it. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    description: string,
    readonly redirect = false,
    readonly status = 400,
  ) {
    super(description);
  }
}

export interface AuthorizeParams {
  client_id?: string | undefined;
  redirect_uri?: string | undefined;
  response_type?: string | undefined;
  scope?: string | undefined;
  state?: string | undefined;
  code_challenge?: string | undefined;
  code_challenge_method?: string | undefined;
  resource?: string | undefined;
}

/** RFC 8707: an absolute URI without fragment. */
const validResource = (r: string) => {
  try {
    const u = new URL(r);
    return !u.hash && !!u.host;
  } catch {
    return false;
  }
};

const UNUSED_CLIENT_TTL_MS = 7 * 24 * 3600_000;

export async function registerClient(
  db: Database,
  input: { client_name?: string; redirect_uris?: unknown },
  now: Date,
  maxUnused = 1000,
) {
  const uris = input.redirect_uris;
  if (
    !Array.isArray(uris) ||
    !uris.length ||
    uris.length > 10 ||
    !uris.every((u) => typeof u === 'string' && validRedirectUri(u))
  ) {
    throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be 1-10 valid redirect URIs');
  }
  // Drop stale never-authorized clients, then cap what is left.
  const used = (table: 'oauth_grants' | 'oauth_codes') =>
    sql`exists (select 1 from ${sql.raw(table)} where ${sql.raw(table)}.client_id = oauth_clients.id)`;
  await db
    .delete(schema.oauthClients)
    .where(
      and(
        lt(schema.oauthClients.createdAt, new Date(now.getTime() - UNUSED_CLIENT_TTL_MS)),
        not(used('oauth_grants')),
        not(used('oauth_codes')),
      ),
    );
  const [unused] = await db
    .select({ n: count() })
    .from(schema.oauthClients)
    .where(not(used('oauth_grants')));
  if (unused!.n >= maxUnused) {
    throw new OAuthError('temporarily_unavailable', 'Too many unused clients', false, 429);
  }
  const name = String(input.client_name ?? 'Unnamed app').slice(0, 100);
  const [row] = await db
    .insert(schema.oauthClients)
    .values({ id: rand('cl_'), name, redirectUris: uris as string[] })
    .returning();
  return row!;
}

export async function getClient(db: Database, id: string | undefined) {
  if (!id) return null;
  const [c] = await db.select().from(schema.oauthClients).where(eq(schema.oauthClients.id, id));
  return c ?? null;
}

/** Validates an authorization request. Client/redirect problems are non-redirectable. */
export async function validateAuthorize(db: Database, p: AuthorizeParams) {
  const client = await getClient(db, p.client_id);
  if (!client) throw new OAuthError('invalid_request', 'Unknown client_id');
  if (!p.redirect_uri || !redirectUriMatches(client.redirectUris, p.redirect_uri)) {
    throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client');
  }
  if (p.response_type !== 'code') {
    throw new OAuthError('unsupported_response_type', 'response_type must be code', true);
  }
  if (!p.code_challenge || p.code_challenge_method !== 'S256') {
    throw new OAuthError(
      'invalid_request',
      'PKCE with code_challenge_method=S256 is required',
      true,
    );
  }
  const scopes = parseScopes(p.scope);
  if (!scopes) throw new OAuthError('invalid_scope', 'Unknown scope', true);
  if (p.resource !== undefined && !validResource(p.resource)) {
    throw new OAuthError(
      'invalid_target',
      'resource must be an absolute URI without fragment',
      true,
    );
  }
  return {
    client,
    redirectUri: p.redirect_uri,
    scopes,
    challenge: p.code_challenge,
    resource: p.resource ?? null,
  };
}

/** Where to send the browser after the User decides (code on approve, access_denied on deny). */
export async function decide(
  db: Database,
  userId: string,
  p: AuthorizeParams,
  approve: boolean,
  now: Date,
): Promise<string> {
  const v = await validateAuthorize(db, p);
  const to = new URL(v.redirectUri);
  if (p.state) to.searchParams.set('state', p.state);
  if (!approve) {
    to.searchParams.set('error', 'access_denied');
    return to.toString();
  }
  const code = rand();
  await db.insert(schema.oauthCodes).values({
    codeHash: hash(code),
    clientId: v.client.id,
    userId,
    scopes: v.scopes,
    redirectUri: v.redirectUri,
    codeChallenge: v.challenge,
    resource: v.resource,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  to.searchParams.set('code', code);
  return to.toString();
}

async function issue(db: Pick<Database, 'insert'>, grantId: string, scopes: string[], now: Date) {
  const access = rand(ACCESS_PREFIX);
  const refresh = rand();
  await db.insert(schema.oauthTokens).values([
    {
      tokenHash: hash(access),
      kind: 'access',
      grantId,
      expiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
    },
    {
      tokenHash: hash(refresh),
      kind: 'refresh',
      grantId,
      expiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    },
  ]);
  return {
    access_token: access,
    token_type: 'Bearer' as const,
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope: scopes.join(' '),
  };
}

export async function exchangeToken(
  db: Database,
  form: Record<string, string | undefined>,
  now: Date,
) {
  const bad = (d: string, e = 'invalid_grant') => new OAuthError(e, d);
  if (form.grant_type === 'authorization_code') {
    // Delete-returning is atomic: a replayed code finds nothing.
    const [code] = await db
      .delete(schema.oauthCodes)
      .where(eq(schema.oauthCodes.codeHash, hash(form.code ?? '')))
      .returning();
    if (!code || code.expiresAt <= now) throw bad('Invalid or expired code');
    if (code.clientId !== form.client_id || code.redirectUri !== form.redirect_uri) {
      throw bad('client_id or redirect_uri mismatch');
    }
    if (!pkceMatches(form.code_verifier ?? '', code.codeChallenge)) throw bad('PKCE check failed');
    if (form.resource !== undefined && form.resource !== code.resource) {
      throw bad('resource does not match the authorization request', 'invalid_target');
    }
    return db.transaction(async (tx) => {
      // One connected app per (User, client): re-consent replaces the old grant and its tokens.
      await tx
        .delete(schema.oauthGrants)
        .where(
          and(
            eq(schema.oauthGrants.userId, code.userId),
            eq(schema.oauthGrants.clientId, code.clientId),
          ),
        );
      const [grant] = await tx
        .insert(schema.oauthGrants)
        .values({
          clientId: code.clientId,
          userId: code.userId,
          scopes: code.scopes,
          audience: code.resource,
        })
        .returning();
      return issue(tx, grant!.id, grant!.scopes, now);
    });
  }
  if (form.grant_type === 'refresh_token') {
    const [old] = await db
      .delete(schema.oauthTokens)
      .where(
        and(
          eq(schema.oauthTokens.tokenHash, hash(form.refresh_token ?? '')),
          eq(schema.oauthTokens.kind, 'refresh'),
          gt(schema.oauthTokens.expiresAt, now),
        ),
      )
      .returning();
    if (!old) throw bad('Invalid or expired refresh token');
    const [grant] = await db
      .select()
      .from(schema.oauthGrants)
      .where(eq(schema.oauthGrants.id, old.grantId));
    if (!grant || grant.clientId !== form.client_id) throw bad('client_id mismatch');
    if (form.resource !== undefined && form.resource !== grant.audience) {
      throw bad('resource does not match the grant', 'invalid_target');
    }
    return issue(db, grant.id, grant.scopes, now);
  }
  throw bad('grant_type must be authorization_code or refresh_token', 'unsupported_grant_type');
}

export interface OAuthPrincipal {
  userId: string;
  grantId: string;
  clientId: string;
  scopes: OAuthScope[];
  audience: string | null;
  expiresAt: Date;
}

/** Resolve a live access token; revoked (deleted) grants and expired tokens give null. */
export async function findAccessToken(
  db: Database,
  token: string,
  now: Date,
): Promise<OAuthPrincipal | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const [row] = await db
    .select({
      userId: schema.oauthGrants.userId,
      grantId: schema.oauthGrants.id,
      clientId: schema.oauthGrants.clientId,
      scopes: schema.oauthGrants.scopes,
      audience: schema.oauthGrants.audience,
      expiresAt: schema.oauthTokens.expiresAt,
    })
    .from(schema.oauthTokens)
    .innerJoin(schema.oauthGrants, eq(schema.oauthGrants.id, schema.oauthTokens.grantId))
    .where(
      and(
        eq(schema.oauthTokens.tokenHash, hash(token)),
        eq(schema.oauthTokens.kind, 'access'),
        gt(schema.oauthTokens.expiresAt, now),
      ),
    );
  return row ? { ...row, scopes: row.scopes as OAuthScope[] } : null;
}
