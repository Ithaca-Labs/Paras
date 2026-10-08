import { createFakeAdapter, fakeMarket } from '@paras/adapters';
import { upsertMarkets, upsertVenue } from '@paras/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
let n = 0;
// Test-only loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

beforeAll(async () => {
  const poly = createFakeAdapter({
    id: 'polymarket',
    name: 'Polymarket',
    capabilities: { routable: true, regulation: 'offshore', restrictedJurisdictions: ['US'] },
    markets: [fakeMarket('p1', { venueId: 'polymarket' })],
  });
  const kalshi = createFakeAdapter({
    id: 'kalshi',
    name: 'Kalshi',
    capabilities: { routable: false, regulation: 'cftc_regulated', restrictedJurisdictions: [] },
    markets: [fakeMarket('k1', { venueId: 'kalshi' })],
  });
  t = await createTestApp({ adapters: [poly, kalshi] });
  for (const a of [poly, kalshi]) {
    await upsertVenue(t.db, a);
    await upsertMarkets(t.db, (await a.listMarkets({ status: 'all' })).items);
  }
});
afterAll(() => t.close());

async function call(
  method: 'GET' | 'POST',
  url: string,
  opts: { body?: unknown; bearer?: string; country?: string } = {},
) {
  const res = await t.app.inject({
    method,
    url,
    headers: {
      ...(opts.bearer && { authorization: `Bearer ${opts.bearer}` }),
      ...(opts.country && { 'cf-ipcountry': opts.country }),
    },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as Json };
}

async function signIn() {
  const email = `geo${++n}-${Date.now()}@example.com`;
  await call('POST', '/v1/auth/email/request', { body: { email } });
  const r = await call('POST', '/v1/auth/email/verify', {
    body: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  return r.json.token as string;
}

async function availability(country?: string, bearer?: string) {
  const r = await call('GET', '/v1/events', {
    ...(country && { country }),
    ...(bearer && { bearer }),
  });
  const markets = r.json.items.flatMap((e: Json) => e.markets) as Json[];
  return Object.fromEntries(markets.map((m) => [m.venue.id, m.availability]));
}

describe('Event availability', () => {
  it('US: Polymarket blocked, Kalshi redirect', async () => {
    expect(await availability('US')).toEqual({ polymarket: 'blocked', kalshi: 'redirect' });
  });
  it('eligible country: Polymarket routable, Kalshi redirect', async () => {
    expect(await availability('IN')).toEqual({ polymarket: 'routable', kalshi: 'redirect' });
  });
  it('Polymarket geoblock-list country (DE) blocked even though adapter caps only list US', async () => {
    expect((await availability('DE')).polymarket).toBe('blocked');
  });
  it('unknown country fails closed', async () => {
    expect((await availability()).polymarket).toBe('redirect');
  });
  it('attested restricted country overrides an eligible IP', async () => {
    const token = await signIn();
    await call('POST', '/v1/me/jurisdiction', { bearer: token, body: { country: 'us' } });
    expect((await availability('IN', token)).polymarket).toBe('blocked');
  });
});

describe('Vault eligibility', () => {
  it('requires sign-in', async () => {
    expect((await call('GET', '/v1/vault/eligibility')).status).toBe(401);
  });

  it('denies until attested, acknowledged and in an eligible country', async () => {
    const token = await signIn();
    const get = (country?: string) =>
      call('GET', '/v1/vault/eligibility', { bearer: token, ...(country && { country }) });

    let r = await get('IN');
    expect(r.json.eligible).toBe(false);
    expect(r.json.reasons).toEqual(['attestation_required', 'disclosures_not_acknowledged']);

    await call('POST', '/v1/me/jurisdiction', { bearer: token, body: { country: 'IN' } });
    const d = (await call('GET', '/v1/disclosures')).json;
    expect(d.items.length).toBeGreaterThan(0);
    const stale = await call('POST', '/v1/me/disclosures', {
      bearer: token,
      body: { version: 'old' },
    });
    expect(stale.status).toBe(409);
    const ack = await call('POST', '/v1/me/disclosures', {
      bearer: token,
      body: { version: d.version },
    });
    expect(ack.status).toBe(200);

    r = await get('IN');
    expect(r.json).toMatchObject({
      eligible: true,
      reasons: [],
      ipCountry: 'IN',
      attestedCountry: 'IN',
    });

    expect((await get('US')).json.reasons).toEqual(['country_mismatch', 'no_routable_venue']);
    expect((await get()).json.reasons).toContain('country_unknown');
  });

  it('US user attesting US is ineligible with redirects only', async () => {
    const token = await signIn();
    await call('POST', '/v1/me/jurisdiction', { bearer: token, body: { country: 'US' } });
    const v = await call('POST', '/v1/me/disclosures', {
      bearer: token,
      body: { version: (await call('GET', '/v1/disclosures')).json.version },
    });
    expect(v.status).toBe(200);
    const r = await call('GET', '/v1/vault/eligibility', { bearer: token, country: 'US' });
    expect(r.json.eligible).toBe(false);
    expect(r.json.reasons).toEqual(['no_routable_venue']);
    expect(Object.fromEntries(r.json.venues.map((x: Json) => [x.venueId, x.availability]))).toEqual(
      {
        polymarket: 'blocked',
        kalshi: 'redirect',
      },
    );
  });

  it('rejects an invalid country', async () => {
    const token = await signIn();
    expect(
      (await call('POST', '/v1/me/jurisdiction', { bearer: token, body: { country: 'USA' } }))
        .status,
    ).toBe(400);
  });
});
