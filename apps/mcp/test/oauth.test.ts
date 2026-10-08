import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createFakeAdapter, fakeMarket } from '@paras/adapters';
import { upsertMarkets, upsertVenue } from '@paras/db';
import { createApiClient } from '@paras/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, injectFetch, type TestApp } from '../../api/test/harness.js';
import { buildApp } from '../src/app.js';

// Test-only loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const REDIRECT = 'http://127.0.0.1:8123/callback';
const ISSUER = 'http://api.test';
let t: TestApp;
let mcp: ReturnType<typeof buildApp>;
let url: string;
let n = 0;

beforeAll(async () => {
  const poly = createFakeAdapter({
    id: 'polymarket',
    name: 'Polymarket',
    capabilities: { routable: true, regulation: 'offshore', restrictedJurisdictions: [] },
    markets: [
      fakeMarket('p1', { venueId: 'polymarket' }),
      fakeMarket('p2', { venueId: 'polymarket' }),
    ],
  });
  t = await createTestApp({ adapters: [poly] });
  await upsertVenue(t.db, poly);
  await upsertMarkets(t.db, (await poly.listMarkets({ status: 'all' })).items);
  mcp = buildApp({
    apiUrl: ISSUER,
    publicUrl: 'http://mcp.test',
    issuer: ISSUER,
    fetch: injectFetch(t.app),
  });
  url = await mcp.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await mcp.close();
  await t.close();
});

/** A signed-in User: bearer session header (browsers would use the cookie). */
async function signIn() {
  const email = `oauth${++n}-${Date.now()}@example.com`;
  await t.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
  const r = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  const headers = { authorization: `Bearer ${r.json().token as string}` };
  return { headers, api: createApiClient({ baseUrl: ISSUER, fetch: injectFetch(t.app), headers }) };
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

async function register(redirect = REDIRECT) {
  const r = await t.app.inject({
    method: 'POST',
    url: '/oauth/register',
    payload: {
      client_name: 'Test Claude',
      redirect_uris: [redirect],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(r.statusCode).toBe(201);
  return r.json().client_id as string;
}

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

/** Consent as `user`, return the redirect the client would receive. */
async function consent(
  user: Awaited<ReturnType<typeof signIn>>,
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
  decision = 'approve',
) {
  const r = await t.app.inject({
    method: 'POST',
    url: '/oauth/authorize',
    headers: { ...FORM, ...user.headers },
    payload: form({
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      state: 'st8',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      decision,
      ...extra,
    }),
  });
  expect(r.statusCode).toBe(302);
  return new URL(r.headers.location as string);
}

const token = (body: Record<string, string>) =>
  t.app.inject({ method: 'POST', url: '/oauth/token', headers: FORM, payload: form(body) });

/** Whole flow: register, consent, exchange. */
async function connectApp(user: Awaited<ReturnType<typeof signIn>>, scope?: string) {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const cb = await consent(user, clientId, challenge, scope ? { scope } : {});
  expect(cb.searchParams.get('state')).toBe('st8');
  const res = await token({
    grant_type: 'authorization_code',
    code: cb.searchParams.get('code')!,
    redirect_uri: REDIRECT,
    client_id: clientId,
    code_verifier: verifier,
  });
  expect(res.statusCode).toBe(200);
  return {
    clientId,
    ...(res.json() as { access_token: string; refresh_token: string; scope: string }),
  };
}

async function mcpClient(accessToken?: string) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {} },
    }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  expect(res.isError).toBeFalsy();
  return JSON.parse((res.content as { text: string }[])[0]!.text) as Json;
}

const rawCall = (name: string, authorization?: string) =>
  fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(authorization && { authorization }),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: {} },
    }),
  });

describe('mcp oauth', () => {
  it('publishes protected-resource and authorization-server metadata', async () => {
    const prm = await (await fetch(`${url}/.well-known/oauth-protected-resource`)).json();
    expect(prm).toMatchObject({
      resource: 'http://mcp.test/mcp',
      authorization_servers: [ISSUER],
      scopes_supported: ['markets:read', 'feed:read', 'portfolio:read'],
    });
    const as = (await t.app.inject({ url: '/.well-known/oauth-authorization-server' })).json();
    expect(as).toMatchObject({
      code_challenge_methods_supported: ['S256'],
      registration_endpoint: expect.stringMatching(/\/oauth\/register$/),
    });
  });

  it('public tools work without auth; personal tools answer 401 + WWW-Authenticate', async () => {
    const anon = await mcpClient();
    expect((await call(anon, 'search_events')).items.length).toBeGreaterThan(0);
    await anon.close();
    const r = await rawCall('get_my_feed');
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain(
      'resource_metadata="http://mcp.test/.well-known/oauth-protected-resource"',
    );
  });

  it('full flow: register, consent, PKCE exchange, get_my_feed matches /v1/feed', async () => {
    const user = await signIn();
    const app = await connectApp(user);
    expect(app.scope).toBe('markets:read feed:read portfolio:read');

    const client = await mcpClient(app.access_token);
    const names = (await client.listTools()).tools.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(['get_my_feed', 'get_portfolio']));
    expect(names.join()).not.toMatch(/trade|bet|order|deposit|withdraw|execute|sign|place/);

    const mine = await call(client, 'get_my_feed', { limit: 5 });
    const web = await user.api.getFeed({ query: { limit: 5 } });
    expect(mine.items.length).toBeGreaterThan(0);
    expect(mine.items.map((i: Json) => i.id)).toEqual(web.items.map((i) => i.event.id));
    expect(mine.items.map((i: Json) => i.reason)).toEqual(web.items.map((i) => i.reason));
    expect(mine.personalized).toBe(web.personalized);

    // Vault not configured in this API: empty state, not an error.
    expect(await call(client, 'get_portfolio')).toMatchObject({
      vault: null,
      total: { idle: '0', reserved: '0', inFlight: '0' },
      accounts: [],
    });
    await client.close();
  });

  it('rejects bad PKCE, replayed code, unregistered redirect_uri and unknown scope', async () => {
    const user = await signIn();
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const code = (await consent(user, clientId, challenge)).searchParams.get('code')!;
    const exchange = (v: string) =>
      token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: v,
      });
    // A failed attempt burns the code too.
    expect((await exchange(randomBytes(32).toString('base64url'))).json().error).toBe(
      'invalid_grant',
    );
    expect((await exchange(verifier)).json().error).toBe('invalid_grant');

    const bad = await t.app.inject({
      method: 'POST',
      url: '/oauth/authorize',
      headers: { ...FORM, ...user.headers },
      payload: form({
        client_id: clientId,
        redirect_uri: 'https://evil.example/cb',
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        decision: 'approve',
      }),
    });
    expect(bad.statusCode).toBe(400); // shown, never redirected
    const noPkce = await consent(user, clientId, challenge, { code_challenge_method: 'plain' });
    expect(noPkce.searchParams.get('error')).toBe('invalid_request');
    const scope = await consent(user, clientId, challenge, { scope: 'markets:read trade:write' });
    expect(scope.searchParams.get('error')).toBe('invalid_scope');
    const denied = await consent(user, clientId, challenge, {}, 'deny');
    expect(denied.searchParams.get('error')).toBe('access_denied');
  });

  it('registration rejects unsafe redirect URIs', async () => {
    for (const uri of ['javascript:alert(1)', 'http://evil.example/cb', 'https://x.example/cb#f']) {
      const r = await t.app.inject({
        method: 'POST',
        url: '/oauth/register',
        payload: { redirect_uris: [uri] },
      });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe('invalid_redirect_uri');
    }
  });

  it('serves a sign-in or consent page at GET /oauth/authorize', async () => {
    const user = await signIn();
    const clientId = await register();
    const q = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
    });
    const signedOut = await t.app.inject({ url: `/oauth/authorize?${q}` });
    expect(signedOut.body).toContain('Email me a code');
    const signedIn = await t.app.inject({ url: `/oauth/authorize?${q}`, headers: user.headers });
    expect(signedIn.body).toContain('Test Claude');
    expect(signedIn.body).toContain('value="approve"');
  });

  it('enforces scopes at the MCP layer and the API', async () => {
    const user = await signIn();
    const app = await connectApp(user, 'markets:read');
    expect(app.scope).toBe('markets:read');
    const r = await rawCall('get_my_feed', `Bearer ${app.access_token}`);
    expect(r.status).toBe(403);
    expect(r.headers.get('www-authenticate')).toContain('error="insufficient_scope"');

    const bearer = { authorization: `Bearer ${app.access_token}` };
    const feed = await t.app.inject({ url: '/v1/feed', headers: bearer });
    expect(feed.statusCode).toBe(403);
    // OAuth tokens never reach routes that did not opt in (no session powers).
    expect((await t.app.inject({ url: '/v1/me', headers: bearer })).statusCode).toBe(401);
    expect((await t.app.inject({ url: '/v1/connected-apps', headers: bearer })).statusCode).toBe(
      401,
    );
    expect(
      (await t.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer })).statusCode,
    ).toBe(401);
    // Public tools still fine with a markets:read token.
    const client = await mcpClient(app.access_token);
    expect((await call(client, 'list_trending')).items.length).toBeGreaterThan(0);
    await client.close();
  });

  it('refresh rotates tokens', async () => {
    const user = await signIn();
    const app = await connectApp(user);
    const body = {
      grant_type: 'refresh_token',
      refresh_token: app.refresh_token,
      client_id: app.clientId,
    };
    const next = await token(body);
    expect(next.statusCode).toBe(200);
    expect(next.json().access_token).not.toBe(app.access_token);
    expect((await token(body)).json().error).toBe('invalid_grant'); // old refresh token is spent
    const client = await mcpClient(next.json().access_token);
    expect((await call(client, 'get_my_feed')).items.length).toBeGreaterThan(0);
    await client.close();
  });

  it('lists connected apps; revoking makes tokens unauthorized everywhere', async () => {
    const user = await signIn();
    const other = await signIn();
    const app = await connectApp(user);

    const { items } = await user.api.listConnectedApps();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      client: { id: app.clientId, name: 'Test Claude' },
      scopes: ['markets:read', 'feed:read', 'portfolio:read'],
    });
    expect((await other.api.listConnectedApps()).items).toHaveLength(0);
    await expect(
      other.api.revokeConnectedApp({ params: { id: items[0]!.id } }),
    ).rejects.toMatchObject({
      status: 404,
    });

    const client = await mcpClient(app.access_token);
    expect((await call(client, 'get_my_feed')).items.length).toBeGreaterThan(0);

    await user.api.revokeConnectedApp({ params: { id: items[0]!.id } });
    expect((await user.api.listConnectedApps()).items).toHaveLength(0);

    // Same transport, same token: now unauthorized (HTTP 401 surfaces as a client error).
    await expect(client.callTool({ name: 'get_my_feed', arguments: {} })).rejects.toThrow();
    const r = await rawCall('get_my_feed', `Bearer ${app.access_token}`);
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('error="invalid_token"');
    // Even public tools refuse a revoked token, and the API does too.
    expect((await rawCall('search_events', `Bearer ${app.access_token}`)).status).toBe(401);
    expect(
      (
        await t.app.inject({
          url: '/v1/feed',
          headers: { authorization: `Bearer ${app.access_token}` },
        })
      ).statusCode,
    ).toBe(401);
    // Refresh token died with the grant.
    const again = await token({
      grant_type: 'refresh_token',
      refresh_token: app.refresh_token,
      client_id: app.clientId,
    });
    expect(again.json().error).toBe('invalid_grant');
    await client.close().catch(() => {});
  });

  it('JSON consent API returns the redirect for the web consent screen', async () => {
    const user = await signIn();
    const clientId = await register();
    expect(await user.api.getOAuthClient({ params: { id: clientId } })).toEqual({
      id: clientId,
      name: 'Test Claude',
    });
    const { verifier, challenge } = pkce();
    const { redirectUrl } = await user.api.authorizeOAuth({
      body: {
        client_id: clientId,
        redirect_uri: REDIRECT,
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        approve: true,
      },
    });
    const res = await token({
      grant_type: 'authorization_code',
      code: new URL(redirectUrl).searchParams.get('code')!,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    });
    expect(res.statusCode).toBe(200);
  });
});
