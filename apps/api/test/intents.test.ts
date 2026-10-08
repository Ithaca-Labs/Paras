import { createFakeAdapter, fakeMarket, type FakeAdapter } from '@paras/adapters';
import { recordQuotes, schema, upsertMarkets, upsertVenue } from '@paras/db';
import { RISK_DISCLOSURES, intentDetailsHash, registerTypedData } from '@paras/domain';
import { eq } from 'drizzle-orm';
import { getAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VaultAccount, VaultReader } from '../src/vault.js';
import { createTestApp, type TestApp } from './harness.js';

const VAULT = '0x1111111111111111111111111111111111111111' as const;
const level = (price: string, size: string) => ({ price, size });
const user = privateKeyToAccount(generatePrivateKey());
const POLY_WALLET = '0x3333333333333333333333333333333333333333';

const chain = new Map<string, VaultAccount>();
const fake: VaultReader = {
  vault: VAULT,
  chainId: 10143,
  accounts: async (us) =>
    us.map(
      (u) =>
        chain.get(u.toLowerCase()) ?? { idle: 0n, reserved: 0n, inFlight: 0n, depositWallet: null },
    ),
};

let t: TestApp;
let poly: FakeAdapter;
let kalshi: FakeAdapter;
let eventId: string;
let headers: Record<string, string>;
let userId: string;

beforeAll(async () => {
  poly = createFakeAdapter({
    id: 'polymarket',
    name: 'Polymarket',
    capabilities: { routable: true },
    markets: [fakeMarket('x', { venueId: 'polymarket', url: 'https://poly.example/x' })],
  });
  kalshi = createFakeAdapter({
    id: 'kalshi',
    name: 'Kalshi',
    capabilities: { routable: false },
    markets: [fakeMarket('kx', { venueId: 'kalshi', url: 'https://kalshi.example/kx' })],
  });
  poly.setBook('x-yes', { bids: [level('0.48', '500')], asks: [level('0.50', '1000')] });
  kalshi.setBook('kx-yes', { bids: [level('0.38', '500')], asks: [level('0.40', '1000')] });

  t = await createTestApp({ adapters: [poly, kalshi], vault: fake });
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
  // Both Markets are one Event (matching is #6).
  const rows = await t.db.select().from(schema.markets);
  const m = (ext: string) => rows.find((r) => r.externalId === ext)!;
  const [em] = await t.db
    .select()
    .from(schema.eventMarkets)
    .where(eq(schema.eventMarkets.marketId, m('x').id));
  eventId = em!.eventId;
  const [old] = await t.db
    .select()
    .from(schema.eventMarkets)
    .where(eq(schema.eventMarkets.marketId, m('kx').id));
  await t.db.delete(schema.eventMarkets).where(eq(schema.eventMarkets.marketId, m('kx').id));
  await t.db.delete(schema.events).where(eq(schema.events.id, old!.eventId));
  await t.db.insert(schema.eventMarkets).values({ eventId, marketId: m('kx').id });

  const email = `intent-${Date.now()}@example.com`;
  await t.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
  const r = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  headers = { authorization: `Bearer ${r.json().token}`, 'cf-ipcountry': 'IN' };
  userId = (await t.app.inject({ method: 'GET', url: '/v1/me', headers })).json().id;
  await t.db
    .insert(schema.walletLinks)
    .values({ userId, address: user.address.toLowerCase(), chainId: 10143 });
  await t.db.update(schema.users).set({ attestedCountry: 'IN' }).where(eq(schema.users.id, userId));
  await t.db.insert(schema.disclosureAcks).values({ userId, version: RISK_DISCLOSURES.version });
  chain.set(user.address.toLowerCase(), {
    idle: 100_000_000n,
    reserved: 0n,
    inFlight: 0n,
    depositWallet: POLY_WALLET,
  });
});
afterAll(() => t.close());

const preview = (body: object, h = headers) =>
  t.app.inject({
    method: 'POST',
    url: '/v1/vault/intents/preview',
    headers: h,
    payload: {
      eventId,
      outcome: 'Yes',
      user: user.address.toLowerCase(),
      amount: '10',
      maxPrice: '0.55',
      ...body,
    },
  });

describe('POST /v1/vault/intents/preview', () => {
  it('401 when signed out', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/vault/intents/preview',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('routes to Polymarket, hints at the cheaper Kalshi, and returns signable typed data', async () => {
    const res = await preview({});
    expect(res.statusCode).toBe(200);
    const p = res.json();
    expect(p.blockers).toEqual([]);
    expect(p.route.venueId).toBe('polymarket');
    expect(Number(p.route.expected.shares)).toBeGreaterThan(19); // ~9.999 / 0.50
    expect(p.route.expected.overhead).toBe('0.001');
    expect(p.hint).toMatchObject({ venueId: 'kalshi', redirectUrl: 'https://kalshi.example/kx' });
    expect(Number(p.hint.extraShares)).toBeGreaterThan(0);

    const td = p.intent.typedData;
    expect(td.primaryType).toBe('Intent');
    expect(td.domain).toMatchObject({
      name: 'ParasVault',
      chainId: 10143,
      verifyingContract: VAULT,
    });
    expect(td.message).toMatchObject({ user: user.address.toLowerCase(), amount: '10000000' });

    // The row the Executor will check the on-chain detailsHash against.
    const [row] = await t.db
      .select()
      .from(schema.intents)
      .where(eq(schema.intents.id, p.intent.id));
    expect(row!.status).toBe('previewed');
    expect(row!.detailsHash).toBe(intentDetailsHash(row!.details));
    expect(row!.detailsHash).toBe(td.message.detailsHash);
    expect(row!.details).toMatchObject({
      venueId: 'polymarket',
      tokenId: 'x-yes',
      maxPrice: '0.55',
    });
  });

  it('enforces max price: no route, redirect suggestions, no Intent recorded', async () => {
    const before = (await t.db.select().from(schema.intents)).length;
    const p = (await preview({ maxPrice: '0.45' })).json();
    expect(p.route).toBeNull();
    expect(p.intent).toBeNull();
    expect(p.noRoute.reason).toBe('max_price');
    expect(p.noRoute.redirects[0]).toMatchObject({ venueId: 'kalshi' });
    expect((await t.db.select().from(schema.intents)).length).toBe(before);
  });

  it('US callers get redirects only, never a Vault Intent', async () => {
    const p = (await preview({}, { ...headers, 'cf-ipcountry': 'US' })).json();
    expect(p.noRoute.reason).toBe('no_routable_venue');
    expect(p.noRoute.redirects.map((r: { venueId: string }) => r.venueId)).toEqual(['kalshi']);
    expect(p.blockers).toContain('country_mismatch');
    expect(p.intent).toBeNull();
  });

  it('blocks without a registered Deposit Wallet or enough idle balance', async () => {
    chain.set(user.address.toLowerCase(), {
      idle: 1_000_000n,
      reserved: 0n,
      inFlight: 0n,
      depositWallet: null,
    });
    const p = (await preview({})).json();
    expect(p.blockers).toEqual(
      expect.arrayContaining(['deposit_wallet_not_registered', 'insufficient_idle_balance']),
    );
    expect(p.route).not.toBeNull();
    expect(p.intent).toBeNull();
    chain.set(user.address.toLowerCase(), {
      idle: 100_000_000n,
      reserved: 0n,
      inFlight: 0n,
      depositWallet: POLY_WALLET,
    });
  });

  it('403 for an address that is not linked to the account', async () => {
    const res = await preview({ user: '0x00000000000000000000000000000000000000aa' });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /v1/vault/intents/:id', () => {
  it('returns the status timeline, only to its owner', async () => {
    const p = (await preview({})).json();
    const id = p.intent.id as string;
    await t.db.insert(schema.intentEvents).values([
      { intentRowId: id, status: 'signed' },
      { intentRowId: id, status: 'dispatched' },
    ]);
    await t.db
      .update(schema.intents)
      .set({
        status: 'partially_filled',
        ctx: { filledShares: '5', spentUsdc: '2500000', reason: 'partial fill' },
      })
      .where(eq(schema.intents.id, id));
    const res = await t.app.inject({ method: 'GET', url: `/v1/vault/intents/${id}`, headers });
    const v = res.json();
    expect(v.status).toBe('partially_filled');
    expect(v.timeline.map((e: { status: string }) => e.status)).toEqual([
      'previewed',
      'signed',
      'dispatched',
    ]);
    expect(v).toMatchObject({ filledShares: '5', spent: '2.5', amount: '10' });

    const other = await t.app.inject({ method: 'GET', url: `/v1/vault/intents/${id}` });
    expect(other.statusCode).toBe(401);
    const missing = await t.app.inject({
      method: 'GET',
      url: '/v1/vault/intents/00000000-0000-4000-8000-000000000000',
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('Deposit Wallet registration (#57)', () => {
  const put = (body: object) =>
    t.app.inject({ method: 'PUT', url: '/v1/vault/deposit-wallet', headers, payload: body });
  const get = async () =>
    (await t.app.inject({ method: 'GET', url: '/v1/vault/deposit-wallet', headers })).json();

  it('requests a wallet, then accepts only the owner signature over the wallet the Executor deployed', async () => {
    expect((await get()).status).toBe('none');
    const owner = user.address.toLowerCase();
    expect((await put({ owner })).json().status).toBe('requested');

    // A signature before the wallet exists is refused.
    expect((await put({ owner, signature: `0x${'11'.repeat(65)}` })).statusCode).toBe(409);

    // Executor deploys the wallet (simulated).
    const wallet = '0x4444444444444444444444444444444444444444';
    await t.db.insert(schema.depositWallets).values({
      userId,
      ownerAddress: owner,
      walletAddress: wallet,
      salt: `0x${'00'.repeat(32)}`,
      chainId: '137',
      status: 'deployed',
    });
    const s = await get();
    expect(s.status).toBe('deployed');
    expect(s.registerTypedData.primaryType).toBe('RegisterDepositWallet');
    expect(s.registerTypedData.message).toEqual({ user: owner, wallet });

    const wrong = await privateKeyToAccount(generatePrivateKey()).signTypedData(
      registerTypedData({
        vault: VAULT,
        chainId: 10143,
        user: getAddress(owner),
        wallet: getAddress(wallet),
      }),
    );
    expect((await put({ owner, signature: wrong })).statusCode).toBe(400);

    const good = await user.signTypedData(
      registerTypedData({
        vault: VAULT,
        chainId: 10143,
        user: getAddress(owner),
        wallet: getAddress(wallet),
      }),
    );
    const done = await put({ owner, signature: good as Hex });
    expect(done.statusCode).toBe(200);
    expect(done.json().signatureReceived).toBe(true);
    const [req] = await t.db
      .select()
      .from(schema.walletRequests)
      .where(eq(schema.walletRequests.userId, userId));
    expect(req!.signature).toBe(good);
  });

  it('owner must be a linked wallet', async () => {
    expect((await put({ owner: '0x00000000000000000000000000000000000000aa' })).statusCode).toBe(
      403,
    );
  });
});
