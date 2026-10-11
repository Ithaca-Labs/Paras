import {
  createAdapterRegistry,
  createFakeAdapter,
  fakeMarket,
  type FakeAdapter,
} from '@paras/adapters';
import { recordQuotes, schema, upsertMarkets, upsertVenue } from '@paras/db';
import { RISK_DISCLOSURES } from '@paras/domain';
import { createDelegatedSigner, createFakePrivy } from '@paras/privy';
import { eq } from 'drizzle-orm';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runOrders, type OrderDeps } from '../src/orders/engine.js';
import type { VaultAccount, VaultReader } from '../src/vault.js';
import { createTestApp, type TestApp } from './harness.js';

const VAULT = '0x1111111111111111111111111111111111111111' as const;
const SIGNER = 'kq_paras';
const WALLET_ID = 'wallet_orders';
const key = generatePrivateKey();
const wallet = privateKeyToAccount(key).address.toLowerCase();
const level = (price: string, size: string) => ({ price, size });

const chain = new Map<string, VaultAccount>([
  [
    wallet,
    { idle: 100_000_000n, reserved: 0n, inFlight: 0n, depositWallet: `0x${'33'.repeat(20)}` },
  ],
]);
const vault: VaultReader = {
  vault: VAULT,
  chainId: 10143,
  accounts: async (us) =>
    us.map(
      (u) =>
        chain.get(u.toLowerCase()) ?? { idle: 0n, reserved: 0n, inFlight: 0n, depositWallet: null },
    ),
};
const fakePrivy = createFakePrivy({
  users: { tok: { privyUserId: 'did:privy:o', wallet: { id: WALLET_ID, address: wallet } } },
  signers: { [WALLET_ID]: [SIGNER] },
  keys: { [WALLET_ID]: key },
});

let t: TestApp;
let poly: FakeAdapter;
let d: OrderDeps;
let eventId: string;
let outcomeId: string;
let marketId: string;
let headers: Record<string, string>;
let userId: string;

const post = (url: string, payload?: object) =>
  t.app.inject({ method: 'POST', url, headers, payload });
const setQuote = (bid: string, ask: string) =>
  t.db
    .update(schema.latestQuotes)
    .set({ bid, ask, observedAt: new Date() })
    .where(eq(schema.latestQuotes.outcomeId, outcomeId));
const order = async (id: string) =>
  (await t.app.inject({ method: 'GET', url: '/v1/orders', headers }))
    .json()
    .items.find((o: { id: string }) => o.id === id);
const grant = async (maxIntent: string, cap: string) => {
  await post('/v1/delegation', { maxIntent, cap });
  await post('/v1/delegation/confirm');
};

beforeAll(async () => {
  poly = createFakeAdapter({
    id: 'polymarket',
    name: 'Polymarket',
    capabilities: { routable: true },
    markets: [fakeMarket('x', { venueId: 'polymarket', url: 'https://poly.example/x' })],
  });
  poly.setBook('x-yes', { bids: [level('0.48', '500')], asks: [level('0.50', '1000')] });
  t = await createTestApp({
    adapters: [poly],
    vault,
    privy: { port: fakePrivy.port, signerId: SIGNER },
  });
  await upsertVenue(t.db, poly);
  const { items } = await poly.listMarkets({ status: 'all' });
  await upsertMarkets(t.db, items);
  await recordQuotes(
    t.db,
    'polymarket',
    await poly.fetchQuotes(items.flatMap((m) => m.outcomes.map((o) => o.externalId))),
  );
  const [m] = await t.db.select().from(schema.markets);
  marketId = m!.id;
  const [o] = await t.db
    .select()
    .from(schema.outcomes)
    .where(eq(schema.outcomes.externalId, 'x-yes'));
  outcomeId = o!.id;
  const [em] = await t.db.select().from(schema.eventMarkets);
  eventId = em!.eventId;
  await setQuote('0.48', '0.50');

  const r = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/privy',
    headers: { 'cf-ipcountry': 'IN' },
    payload: { accessToken: 'tok', identityToken: 'x', session: 'bearer' },
  });
  headers = { authorization: `Bearer ${r.json().token}`, 'cf-ipcountry': 'IN' };
  userId = r.json().user.id;
  await t.db.update(schema.users).set({ attestedCountry: 'IN' }).where(eq(schema.users.id, userId));
  await t.db.insert(schema.disclosureAcks).values({ userId, version: RISK_DISCLOSURES.version });

  d = {
    db: t.db,
    adapters: createAdapterRegistry([poly]),
    vault,
    now: () => new Date(),
    warn: () => {},
    mailer: t.mailer,
    signer: createDelegatedSigner({
      privy: fakePrivy.port,
      db: t.db,
      vault: VAULT,
      chainId: 10143,
    }),
  };
});
afterAll(() => t.close());

const limitBuy = (over: object = {}) =>
  post('/v1/orders', {
    kind: 'limit_buy',
    eventId,
    outcome: 'Yes',
    amount: '10',
    triggerPrice: '0.40',
    ...over,
  });

describe('without a delegation', () => {
  it('orders and one-click bets answer 409 no_active_delegation', async () => {
    expect((await limitBuy()).json().error.code).toBe('no_active_delegation');
    const bet = await post('/v1/vault/bet', {
      eventId,
      outcome: 'Yes',
      amount: '5',
      maxPrice: '0.6',
    });
    expect(bet.statusCode).toBe(409);
  });
});

describe('limit buy', () => {
  it('rejects amounts over the per-bet max', async () => {
    await grant('50', '120');
    const r = await limitBuy({ amount: '60' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('over_intent_cap');
  });

  it('waits above the trigger, then submits exactly one Intent, once', async () => {
    const created = await limitBuy();
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(await runOrders(d)).toEqual({ placed: 0, failed: 0 });
    expect(fakePrivy.calls.sent).toHaveLength(0);

    await setQuote('0.36', '0.38');
    poly.setBook('x-yes', { bids: [level('0.36', '500')], asks: [level('0.38', '1000')] });
    expect(await runOrders(d)).toEqual({ placed: 1, failed: 0 });
    expect(await runOrders(d)).toEqual({ placed: 0, failed: 0 });
    expect(fakePrivy.calls.sent).toHaveLength(1);
    expect(fakePrivy.calls.sent[0]).toMatchObject({ to: VAULT, chainId: 10143 });

    const o = await order(id);
    expect(o).toMatchObject({ status: 'placed', reason: null });
    const [i] = await t.db.select().from(schema.intents).where(eq(schema.intents.id, o.intentId));
    expect(i).toMatchObject({ userId, userAddress: wallet, status: 'previewed' });
    expect(i!.details.maxPrice).toBe('0.40');
    const n = await t.app.inject({ method: 'GET', url: '/v1/notifications', headers });
    expect(JSON.stringify(n.json())).toContain('placed');
  });

  it('holds while dispatch is paused, fires after', async () => {
    const id = (await limitBuy()).json().id as string;
    await t.db.insert(schema.executorPauses).values({ scope: 'global', reason: 'test' });
    expect(await runOrders(d)).toEqual({ placed: 0, failed: 0 });
    expect((await order(id)).status).toBe('open');
    await t.db.delete(schema.executorPauses);
    expect(await runOrders(d)).toEqual({ placed: 1, failed: 0 });
    expect(fakePrivy.calls.sent).toHaveLength(2);
  });

  it('cancel stops an open order; a placed one answers 409', async () => {
    const id = (await limitBuy()).json().id as string;
    expect((await post(`/v1/orders/${id}/cancel`)).json().status).toBe('cancelled');
    expect((await post(`/v1/orders/${id}/cancel`)).statusCode).toBe(200);
    await runOrders(d);
    expect(fakePrivy.calls.sent).toHaveLength(2);
    const placed = (await t.app.inject({ method: 'GET', url: '/v1/orders', headers }))
      .json()
      .items.find((o: { status: string }) => o.status === 'placed');
    expect((await post(`/v1/orders/${placed.id}/cancel`)).statusCode).toBe(409);
  });

  it('fails (and says why) once the delegation spend cap is used up', async () => {
    // spent so far: 20 of 120. Two more 50s: first fits (70), then 3x: cap reached.
    await limitBuy({ amount: '50' });
    await limitBuy({ amount: '50' });
    await limitBuy({ amount: '50' });
    const r = await runOrders(d);
    expect(r.placed + r.failed).toBe(3);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const items = (await t.app.inject({ method: 'GET', url: '/v1/orders', headers })).json().items;
    expect(items.find((o: { status: string }) => o.status === 'failed')).toMatchObject({
      reason: 'over_spend_cap',
    });
  });
});

describe('take-profit / stop-loss', () => {
  let positionId: string;
  beforeAll(async () => {
    const [i] = await t.db
      .insert(schema.intents)
      .values({
        userId,
        userAddress: wallet,
        intentId: `0x${'ee'.repeat(32)}`,
        amountUsdc: '10000000',
        expiry: new Date(Date.now() + 3600_000),
        details: {
          eventId,
          marketId,
          outcomeId,
          venueId: 'polymarket',
          tokenId: 'x-yes',
          maxPrice: '0.5',
          remainder: 'return',
        },
        detailsHash: `0x${'dd'.repeat(32)}`,
        status: 'filled',
      })
      .returning();
    const [p] = await t.db
      .insert(schema.positions)
      .values({
        userId,
        intentRowId: i!.id,
        userAddress: wallet,
        eventId,
        marketId,
        outcomeId,
        venueId: 'polymarket',
        tokenId: 'x-yes',
        conditionId: '0xc',
        outcomeIndex: 0,
        sharesBought: '20000000',
        shares: '20000000',
        costUsdc: '10000000',
      })
      .returning();
    positionId = p!.id;
    await setQuote('0.48', '0.50');
  });

  it('refuses a trigger that is already crossed, and a stop-loss limit above the trigger', async () => {
    const tp = await post('/v1/orders', { kind: 'take_profit', positionId, triggerPrice: '0.40' });
    expect(tp.statusCode).toBe(409);
    expect(tp.json().error.code).toBe('would_trigger_now');
    const sl = await post('/v1/orders', {
      kind: 'stop_loss',
      positionId,
      triggerPrice: '0.60',
    });
    expect(sl.statusCode).toBe(400);
  });

  it('take-profit sells once through a delegated-signed Exit when the bid crosses', async () => {
    const created = await post('/v1/orders', {
      kind: 'take_profit',
      positionId,
      triggerPrice: '0.70',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().limitPrice).toBe('0.70');
    expect(await runOrders(d)).toEqual({ placed: 0, failed: 0 });
    await setQuote('0.72', '0.74');
    expect(await runOrders(d)).toEqual({ placed: 1, failed: 0 });
    expect(await runOrders(d)).toEqual({ placed: 0, failed: 0 });
    const ex = await t.db
      .select()
      .from(schema.exits)
      .where(eq(schema.exits.positionId, positionId));
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({
      kind: 'sell',
      shares: '20000000',
      minPrice: '0.70',
      status: 'requested',
    });
    expect(ex[0]!.signature).toMatch(/^0x[0-9a-f]+$/);
    expect(await order(id)).toMatchObject({ status: 'placed', exitId: ex[0]!.id });
  });

  it('a second order on the same position fails cleanly while an exit is live', async () => {
    await setQuote('0.30', '0.32');
    const sl = await post('/v1/orders', {
      kind: 'stop_loss',
      positionId,
      triggerPrice: '0.20',
      limitPrice: '0.10',
    });
    expect(sl.statusCode).toBe(201);
    await setQuote('0.18', '0.20');
    expect(await runOrders(d)).toEqual({ placed: 0, failed: 1 });
    expect(await order(sl.json().id)).toMatchObject({
      status: 'failed',
      reason: 'exit_in_progress',
    });
  });
});

describe('one-click bet', () => {
  it('previews, signs with the delegated signer and submits one Intent', async () => {
    await t.db.update(schema.delegations).set({ spentUsdc: '0' });
    poly.setBook('x-yes', { bids: [level('0.48', '500')], asks: [level('0.50', '1000')] });
    const before = fakePrivy.calls.sent.length;
    const r = await post('/v1/vault/bet', {
      eventId,
      outcome: 'Yes',
      amount: '5',
      maxPrice: '0.6',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().txHash).toMatch(/^0x/);
    expect(fakePrivy.calls.sent).toHaveLength(before + 1);
    const [i] = await t.db
      .select()
      .from(schema.intents)
      .where(eq(schema.intents.id, r.json().intentId));
    expect(i).toMatchObject({ userAddress: wallet, amountUsdc: '5000000' });
  });

  it('422 bet_blocked when the preview is blocked (no balance), nothing is signed', async () => {
    chain.set(wallet, {
      idle: 0n,
      reserved: 0n,
      inFlight: 0n,
      depositWallet: `0x${'33'.repeat(20)}`,
    });
    const before = fakePrivy.calls.signed.length;
    const r = await post('/v1/vault/bet', {
      eventId,
      outcome: 'Yes',
      amount: '5',
      maxPrice: '0.6',
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.message).toContain('insufficient_idle_balance');
    expect(fakePrivy.calls.signed).toHaveLength(before);
  });

  it('is unreachable by OAuth/MCP tokens', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/vault/bet',
      headers: { authorization: 'Bearer pa_fake' },
      payload: { eventId, outcome: 'Yes', amount: '5', maxPrice: '0.6' },
    });
    expect(r.statusCode).toBe(401);
  });
});
