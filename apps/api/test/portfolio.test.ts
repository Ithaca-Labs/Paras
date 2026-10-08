import { createFakeAdapter, fakeMarket } from '@paras/adapters';
import { recordQuotes, schema, upsertMarkets, upsertVenue } from '@paras/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';

const WALLET = '0x3333333333333333333333333333333333333333';
const USER_ADDR = '0x1111111111111111111111111111111111111111';
const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

let t: TestApp;
let headers: Record<string, string>;
let userId: string;
let marketId: string;
let outcomeId: string;
let tokenId: string;
let positionId: string;
let otherHeaders: Record<string, string>;

const login = async (email: string) => {
  await t.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
  const r = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  return { authorization: `Bearer ${r.json().token}` };
};

beforeAll(async () => {
  const poly = createFakeAdapter({
    id: 'polymarket',
    name: 'Polymarket',
    capabilities: { routable: true },
    markets: [fakeMarket('x', { venueId: 'polymarket' })],
  });
  poly.setBook('x-yes', {
    bids: [{ price: '0.6', size: '500' }],
    asks: [{ price: '0.62', size: '500' }],
  });
  t = await createTestApp({ adapters: [poly] });
  const { items } = await poly.listMarkets({ status: 'all' });
  await upsertVenue(t.db, poly);
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
    .where(eq(schema.outcomes.marketId, marketId));
  outcomeId = o!.id;
  tokenId = o!.externalId;

  headers = await login(`pf-${Date.now()}@example.com`);
  otherHeaders = await login(`pf2-${Date.now()}@example.com`);
  userId = (await t.app.inject({ method: 'GET', url: '/v1/me', headers })).json().id;
  await t.db.insert(schema.walletLinks).values({ userId, address: USER_ADDR, chainId: 10143 });
  await t.db.insert(schema.depositWallets).values({
    userId,
    ownerAddress: USER_ADDR,
    walletAddress: WALLET,
    salt: H(1),
    chainId: '137',
    status: 'registered',
  });

  // A filled buy: 20 shares for $10, then a sell of 5 shares that returned $3.
  const details = {
    eventId: randomUUID(),
    marketId,
    outcomeId,
    venueId: 'polymarket',
    tokenId,
    maxPrice: '0.55',
    remainder: 'return' as const,
  };
  const [intent] = await t.db
    .insert(schema.intents)
    .values({
      userId,
      userAddress: USER_ADDR,
      intentId: H(7),
      amountUsdc: '10000000',
      expiry: new Date(Date.now() + 3_600_000),
      details,
      detailsHash: H(8),
      status: 'filled',
      ctx: {
        filledShares: '20',
        spentUsdc: '10000000',
        submitTx: H(100),
        dispatchTx: H(101),
        convertTx: H(102),
        reason: undefined,
      },
    })
    .returning();
  const [p] = await t.db
    .insert(schema.positions)
    .values({
      userId,
      intentRowId: intent!.id,
      userAddress: USER_ADDR,
      eventId: details.eventId,
      marketId,
      outcomeId,
      venueId: 'polymarket',
      tokenId,
      conditionId: m!.externalId,
      outcomeIndex: 0,
      sharesBought: '20000000',
      shares: '15000000',
      costUsdc: '10000000',
    })
    .returning();
  positionId = p!.id;
  await t.db.insert(schema.exits).values({
    positionId,
    userId,
    kind: 'sell',
    status: 'done',
    shares: '5000000',
    minPrice: '0.5',
    returnTo: 'vault',
    ctx: { soldShares: '5000000', proceedsUsdc: '3000000', returnTx: H(200), settleTx: H(201) },
  });
  await t.db.insert(schema.chainTransfers).values([
    { wallet: WALLET, asset: tokenId, delta: '20000000', block: '1', txHash: H(300), logIndex: 0 },
    { wallet: WALLET, asset: tokenId, delta: '-5000000', block: '2', txHash: H(301), logIndex: 0 },
    { wallet: WALLET, asset: 'pusd', delta: '2500000', block: '2', txHash: H(301), logIndex: 1 },
  ]);
  await t.db.insert(schema.vaultActivity).values({
    userAddress: USER_ADDR,
    kind: 'deposit',
    amountUsdc: '50000000',
    txHash: H(400),
    logIndex: 0,
    at: new Date('2026-10-01T00:00:00Z'),
  });
});
afterAll(() => t.close());

const get = (url: string, h = headers) => t.app.inject({ method: 'GET', url, headers: h });

describe('GET /v1/portfolio (Seam 1: indexer-backed value and P&L)', () => {
  it('401 when signed out', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/v1/portfolio' })).statusCode).toBe(401);
  });

  it('values the position at the best bid and splits realized from unrealized P&L', async () => {
    const res = await get('/v1/portfolio');
    expect(res.statusCode).toBe(200);
    const pf = res.json();
    const [pos] = pf.positions;
    expect(pos).toMatchObject({
      id: positionId,
      shares: '15',
      onchainShares: '15', // indexer: 20 in, 5 out
      avgCost: '0.5',
      price: '0.6',
      costBasis: '7.5',
      value: '9',
      unrealizedPnl: '1.5',
      realizedPnl: '0.5', // sold 5 shares costing 2.5 for 3
      resolution: { state: 'open', delayed: false },
      returnTo: 'vault',
    });
    expect(pf.totals).toMatchObject({ value: '9', costBasis: '7.5', pnl: '2' });
    expect(pf.collateral).toEqual({ wallet: WALLET, pusd: '2.5' });
  });

  it('shows dispute and delay states from the Market', async () => {
    await t.db
      .update(schema.markets)
      .set({
        status: 'closed',
        endDate: new Date(Date.now() - 3 * 86_400_000),
        meta: { umaResolutionStatus: 'disputed' },
      })
      .where(eq(schema.markets.id, marketId));
    expect((await get('/v1/portfolio')).json().positions[0].resolution).toEqual({
      state: 'disputed',
      delayed: true,
    });
    await t.db
      .update(schema.markets)
      .set({ status: 'open', meta: {} })
      .where(eq(schema.markets.id, marketId));
  });

  it('does not show other Users positions', async () => {
    expect((await get('/v1/portfolio', otherHeaders)).json().positions).toEqual([]);
  });
});

describe('GET /v1/vault/history', () => {
  it('lists deposits, bets and exits newest first, each with explorer links', async () => {
    const res = await get('/v1/vault/history');
    expect(res.statusCode).toBe(200);
    const { items, nextCursor } = res.json();
    expect(nextCursor).toBeNull();
    expect(items.map((i: { kind: string }) => i.kind).sort()).toEqual(['bet', 'deposit', 'exit']);
    const bet = items.find((i: { kind: string }) => i.kind === 'bet');
    expect(bet).toMatchObject({ state: 'complete', amount: '10', shares: '20' });
    expect(bet.txs.map((x: { label: string }) => x.label)).toEqual([
      'Intent signed',
      'Dispatched to Polygon',
      'Swapped and wrapped to pUSD',
    ]);
    expect(bet.txs[0]).toMatchObject({ chain: 'monad', url: `https://monadscan.com/tx/${H(100)}` });
    expect(bet.txs[2]).toMatchObject({
      chain: 'polygon',
      url: `https://polygonscan.com/tx/${H(102)}`,
    });
    const exit = items.find((i: { kind: string }) => i.kind === 'exit');
    expect(exit).toMatchObject({ state: 'complete', amount: '3', shares: '5' });
    expect(exit.txs).toHaveLength(2);
    const dep = items.find((i: { kind: string }) => i.kind === 'deposit');
    expect(dep).toMatchObject({ amount: '50', txs: [{ label: 'Deposit', chain: 'monad' }] });
  });

  it('flags a stalled step as delayed and paginates', async () => {
    await t.db.insert(schema.exits).values({
      positionId,
      userId,
      kind: 'redeem',
      status: 'returning',
      returnTo: 'vault',
      updatedAt: new Date(Date.now() - 3_600_000),
    });
    const page = (await get('/v1/vault/history?limit=2')).json();
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
    const all = (await get('/v1/vault/history')).json().items;
    expect(all.find((i: { kind: string }) => i.kind === 'redemption').state).toBe('delayed');
    await t.db.delete(schema.exits).where(eq(schema.exits.kind, 'redeem'));
  });
});

describe('exits API', () => {
  const exit = (id: string, body: object, h = headers) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/vault/positions/${id}/exit`,
      headers: h,
      payload: body,
    });

  it('validates, creates one live exit, and refuses a second', async () => {
    expect((await exit(positionId, { minPrice: '1.5' })).statusCode).toBe(400);
    expect((await exit(positionId, { minPrice: '0.5', shares: '99' })).statusCode).toBe(400);
    expect((await exit(positionId, { minPrice: '0.5' }, otherHeaders)).statusCode).toBe(404);
    const ok = await exit(positionId, { minPrice: '0.5', shares: '10', returnTo: 'polygon' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ kind: 'sell', status: 'requested' });
    const [row] = await t.db.select().from(schema.exits).where(eq(schema.exits.id, ok.json().id));
    expect(row).toMatchObject({ shares: '10000000', minPrice: '0.5', returnTo: 'polygon' });
    expect((await exit(positionId, { minPrice: '0.5' })).statusCode).toBe(409);
  });

  it('lets the User choose where proceeds go', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: `/v1/vault/positions/${positionId}/return-to`,
      headers,
      payload: { returnTo: 'polygon' },
    });
    expect(res.json()).toEqual({ returnTo: 'polygon' });
    expect((await get('/v1/portfolio')).json().positions[0].returnTo).toBe('polygon');
  });
});
