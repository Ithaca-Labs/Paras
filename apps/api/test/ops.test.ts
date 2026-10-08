import { createFakeAdapter, fakeMarket } from '@paras/adapters';
import { recordQuotes, schema, upsertMarkets, upsertVenue, withVenueRun } from '@paras/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VaultReader } from '../src/vault.js';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
let offsetMs = 0;
let vaultPaused = false;
let admin: Record<string, string>;
let user: Record<string, string>;

const signIn = async (email: string) => {
  await t.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
  const r = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  return { authorization: `Bearer ${r.json().token}` };
};
const get = (url: string, headers?: Record<string, string>) =>
  t.app.inject({ method: 'GET', url, ...(headers && { headers }) });
const health = async () =>
  Object.fromEntries(
    (await get('/v1/admin/venues/health', admin))
      .json()
      .items.map((v: { venueId: string }) => [v.venueId, v]),
  );

beforeAll(async () => {
  const fake: VaultReader = {
    vault: '0x1111111111111111111111111111111111111111',
    chainId: 143,
    accounts: async () => [],
    paused: async () => vaultPaused,
  };
  const poly = createFakeAdapter({
    id: 'polymarket',
    name: 'Polymarket',
    markets: [fakeMarket('x', { venueId: 'polymarket' })],
  });
  const kalshi = createFakeAdapter({
    id: 'kalshi',
    name: 'Kalshi',
    markets: [fakeMarket('kx', { venueId: 'kalshi' })],
  });
  const book = { bids: [{ price: '0.48', size: '500' }], asks: [{ price: '0.50', size: '500' }] };
  poly.setBook('x-yes', book);
  kalshi.setBook('kx-yes', book);
  t = await createTestApp({
    adapters: [poly, kalshi],
    vault: fake,
    now: () => new Date(Date.now() + offsetMs),
  });
  for (const v of [poly, kalshi]) {
    const { items } = await v.listMarkets({ status: 'all' });
    await upsertVenue(t.db, v);
    await upsertMarkets(t.db, items);
    await recordQuotes(
      t.db,
      v.id,
      await v.fetchQuotes(items.flatMap((m) => m.outcomes.map((o) => o.externalId))),
    );
  }
  admin = await signIn('admin@example.com');
  user = await signIn('user@example.com');
  const me = (await get('/v1/me', admin)).json();
  await t.db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, me.id));
});
afterAll(() => t.close());

describe('admin ops API', () => {
  it('is admin only', async () => {
    for (const h of [undefined, user]) {
      const s = h ? 403 : 401;
      expect((await get('/v1/admin/venues/health', h)).statusCode).toBe(s);
      expect((await get('/v1/admin/pauses', h)).statusCode).toBe(s);
    }
    const put = await t.app.inject({
      method: 'PUT',
      url: '/v1/admin/pauses/global',
      headers: user,
      payload: { reason: 'x' },
    });
    expect(put.statusCode).toBe(403);
  });

  it('surfaces a stale adapter in Venue health', async () => {
    const fresh = await health();
    expect(fresh.polymarket).toMatchObject({ status: 'ok', errorRate: 0 });
    expect(fresh.kalshi.status).toBe('ok');

    // Only Polymarket keeps getting Quotes; Kalshi goes quiet.
    offsetMs = 10 * 60_000;
    await t.db
      .update(schema.latestQuotes)
      .set({ observedAt: new Date(Date.now() + offsetMs) })
      .where(
        eq(
          schema.latestQuotes.outcomeId,
          (
            await t.db
              .select({ id: schema.outcomes.id })
              .from(schema.outcomes)
              .innerJoin(schema.markets, eq(schema.markets.id, schema.outcomes.marketId))
              .where(eq(schema.markets.venueId, 'polymarket'))
          )[0]!.id,
        ),
      );
    const h = await health();
    expect(h.kalshi.status).toBe('stale');
    expect(h.polymarket.status).toBe('ok');
    offsetMs = 0;
  });

  it('reports worker error rate, last error and last success', async () => {
    await withVenueRun(t.db, 'polymarket', 'quotes', async () => {});
    await expect(
      withVenueRun(t.db, 'polymarket', 'markets', async () => {
        throw new Error('upstream 503');
      }),
    ).rejects.toThrow('upstream 503');
    const h = (await health()).polymarket;
    expect(h).toMatchObject({
      status: 'erroring',
      runs24h: 2,
      errors24h: 1,
      errorRate: 0.5,
      lastError: 'upstream 503',
    });
    expect(h.lastSuccessAt).not.toBeNull();
    await withVenueRun(t.db, 'polymarket', 'markets', async () => {});
    expect((await health()).polymarket).toMatchObject({ status: 'ok', lastError: null });
  });

  it('pauses and unpauses globally and per Venue; exposes Vault on-chain pause', async () => {
    const put = (scope: string, reason = 'incident') =>
      t.app.inject({
        method: 'PUT',
        url: `/v1/admin/pauses/${scope}`,
        headers: admin,
        payload: { reason },
      });
    expect((await put('global')).statusCode).toBe(200);
    expect((await put('kalshi')).statusCode).toBe(200);
    expect((await put('nope')).statusCode).toBe(404);
    let p = (await get('/v1/admin/pauses', admin)).json();
    expect(p.items.map((i: { scope: string }) => i.scope)).toEqual(['global', 'kalshi']);
    expect(p.vaultPaused).toBe(false);

    vaultPaused = true;
    expect((await get('/v1/admin/pauses', admin)).json().vaultPaused).toBe(true);

    const del = (scope: string) =>
      t.app.inject({ method: 'DELETE', url: `/v1/admin/pauses/${scope}`, headers: admin });
    expect((await del('global')).json()).toEqual({ removed: true });
    expect((await del('global')).json()).toEqual({ removed: false });
    p = (await get('/v1/admin/pauses', admin)).json();
    expect(p.items.map((i: { scope: string }) => i.scope)).toEqual(['kalshi']);
  });
});
