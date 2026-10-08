import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import { recordQuotes, schema, upsertMarkets, upsertVenue } from '@paras/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_WEB_BASE_URL, createTestApp, type TestApp } from './harness.js';

let t: TestApp;
let venue: FakeAdapter;
let eventId: string;
const clock = new Date('2026-10-09T12:00:00Z');

beforeAll(async () => {
  venue = createFakeAdapter({
    id: 'fake-venue',
    name: 'Fake Venue',
    capabilities: { routable: true, regulation: 'offshore', restrictedJurisdictions: [] },
    now: () => clock,
    markets: [fakeMarket('big', { volume: '9000' })],
  });
  t = await createTestApp({ adapters: [venue], now: () => clock });
  const { items } = await venue.listMarkets({ status: 'all' });
  await upsertVenue(t.db, venue);
  await upsertMarkets(t.db, items);
  const ids = items.flatMap((m) => m.outcomes.map((o) => o.externalId));
  await recordQuotes(t.db, venue.id, await venue.fetchQuotes(ids), { now: clock });
  eventId = (await t.client.listEvents({ query: {} })).items[0]!.id;
});
afterAll(() => t.close());

// Test-only loose JSON; bodies are asserted field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function call(
  method: 'GET' | 'POST',
  url: string,
  opts: { body?: unknown; bearer?: string } = {},
) {
  const res = await t.app.inject({
    method,
    url,
    headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as Json };
}

let n = 0;
async function signIn(returnTo?: string) {
  const email = `ml${++n}-${Date.now()}@example.com`;
  await call('POST', '/v1/auth/email/request', { body: { email, returnTo } });
  const r = await call('POST', '/v1/auth/email/verify', {
    body: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  expect(r.status).toBe(200);
  return {
    token: r.json.token as string,
    userId: r.json.user.id as string,
    returnTo: r.json.returnTo,
  };
}

const create = (body: Json, bearer?: string) =>
  call('POST', '/v1/magic-links', {
    body: { eventId, source: 'claude', ...body },
    ...(bearer && { bearer }),
  });

describe('create + resolve', () => {
  it('resolves a valid token to the prefill payload without executing anything', async () => {
    const made = await create({ outcome: 'yes', amount: '20', maxPrice: '0.55' });
    expect(made.status).toBe(201);
    expect(made.json.url).toBe(`${TEST_WEB_BASE_URL}${made.json.returnTo}`);
    expect(made.json.returnTo).toBe(`/magic/${made.json.token}`);

    const res = await call('GET', `/v1/magic-links/${made.json.token}`);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      outcome: 'Yes', // canonical label
      amount: '20',
      maxPrice: '0.55',
      source: 'claude',
      bound: false,
    });
    expect(res.json.event.id).toBe(eventId);
    expect(res.json.event.markets[0].outcomes).toHaveLength(2);
  });

  it('allows a bare Event link (no outcome/amount/maxPrice)', async () => {
    const made = await create({ source: 'codex' });
    const res = await call('GET', `/v1/magic-links/${made.json.token}`);
    expect(res.json).toMatchObject({
      outcome: null,
      amount: null,
      maxPrice: null,
      source: 'codex',
    });
  });

  it('records an audit row and counts resolves', async () => {
    const made = await create({ amount: '5' });
    await call('GET', `/v1/magic-links/${made.json.token}`);
    await call('GET', `/v1/magic-links/${made.json.token}`);
    const [row] = await t.db
      .select()
      .from(schema.magicLinks)
      .where(eq(schema.magicLinks.id, made.json.id));
    expect(row).toMatchObject({
      eventId,
      amount: '5',
      source: 'claude',
      kid: 'k1',
      resolveCount: 2,
    });
    expect(row!.lastResolvedAt).not.toBeNull();
  });

  it('rejects unknown Events, unknown outcomes and bad amounts at create', async () => {
    const ghost = await call('POST', '/v1/magic-links', {
      body: { eventId: '00000000-0000-4000-8000-000000000000', source: 'web' },
    });
    expect(ghost.status).toBe(404);
    expect((await create({ outcome: 'Maybe' })).status).toBe(400);
    expect((await create({ amount: '-5' })).status).toBe(400);
    expect((await create({ amount: '0' })).status).toBe(400);
    expect((await create({ maxPrice: '1.5' })).status).toBe(400);
    expect((await create({ source: 'slack' })).status).toBe(400);
  });

  it('caps the lifetime at the configured max', async () => {
    const made = await create({ ttlSeconds: 10 * 24 * 3600 });
    const left = new Date(made.json.expiresAt).getTime() - t.clock.offsetMs - Date.now();
    expect(left).toBeLessThanOrEqual(86_400_000);
  });
});

describe('rejections', () => {
  it('rejects tampered tokens', async () => {
    const { token } = (await create({ amount: '20', maxPrice: '0.55' })).json;
    const [h, b, s] = token.split('.');
    // Swap in a different payload (amount 2000) under the original signature.
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...payload, amount: '2000' })).toString(
      'base64url',
    );
    for (const bad of [
      `${h}.${forged}.${s}`,
      `${h}.${b}.${s.slice(0, -2)}AA`,
      `${h}.${b}.`,
      `${h}.${b}`,
      'garbage',
      `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url')}.${b}.${s}`,
      `${Buffer.from(JSON.stringify({ alg: 'HS256', kid: 'nope' })).toString('base64url')}.${b}.${s}`,
    ]) {
      const res = await call('GET', `/v1/magic-links/${bad}`);
      expect(res.status, bad).toBe(400);
      expect(res.json.error.code).toBe('invalid_magic_link');
    }
  });

  it('rejects expired tokens', async () => {
    const made = await create({ ttlSeconds: 60 });
    expect((await call('GET', `/v1/magic-links/${made.json.token}`)).status).toBe(200);
    t.clock.advance(61_000);
    try {
      const res = await call('GET', `/v1/magic-links/${made.json.token}`);
      expect(res.status).toBe(410);
      expect(res.json.error.code).toBe('magic_link_expired');
    } finally {
      t.clock.advance(-61_000);
    }
  });
});

describe('user binding', () => {
  it('only the bound User can resolve; signed out gets 401', async () => {
    const alice = await signIn();
    const bob = await signIn();
    expect((await create({ bindToUser: true })).status).toBe(401);

    const made = await create({ bindToUser: true, amount: '10' }, alice.token);
    expect(made.status).toBe(201);
    const url = `/v1/magic-links/${made.json.token}`;

    expect((await call('GET', url)).status).toBe(401);
    const wrong = await call('GET', url, { bearer: bob.token });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error.code).toBe('magic_link_wrong_user');
    const ok = await call('GET', url, { bearer: alice.token });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ bound: true, amount: '10' });
  });
});

describe('sign-in round trip', () => {
  it('returnTo carrying the token survives auth and resolves to the same prefill', async () => {
    const made = await create({ outcome: 'No', amount: '20', maxPrice: '0.4' });
    // Signed out: user is sent through email sign-in with returnTo = the Magic Link path.
    const session = await signIn(made.json.returnTo);
    expect(session.returnTo).toBe(made.json.returnTo);

    // The web app resolves the token it extracted from returnTo.
    const token = session.returnTo.replace('/magic/', '');
    const res = await call('GET', `/v1/magic-links/${token}`, { bearer: session.token });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ outcome: 'No', amount: '20', maxPrice: '0.4' });
  });

  it('a bound link round-trips: 401 signed out, then resolves after sign-in', async () => {
    const owner = await signIn();
    const made = await create({ bindToUser: true, amount: '7' }, owner.token);
    const url = `/v1/magic-links/${made.json.token}`;
    expect((await call('GET', url)).status).toBe(401);

    // Same User signs in again via the returnTo flow.
    const email = `ml-owner-${Date.now()}@example.com`;
    await call('POST', '/v1/auth/email/request', { body: { email } });
    const linked = await call('POST', '/v1/auth/email/verify', {
      body: { email, code: t.mailer.lastCode(email), session: 'bearer' },
      bearer: owner.token,
    });
    expect(linked.json.linked).toBe(true);
    const res = await call('GET', url, { bearer: owner.token });
    expect(res.status).toBe(200);
    expect(res.json.amount).toBe('7');
  });
});
