import { schema } from '@paras/db';
import { createFixtureFetch } from '@paras/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNearIntents } from '../src/near-intents.js';
import { createTestApp, type TestApp } from './harness.js';

const WALLET = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';
const DEPOSIT_ADDR = '0x76b4c56085ed136a8744d52be956396624a730e8';
const NOW = new Date('2026-10-11T12:00:00Z');

/** GET /tokens replays a recorded fixture (RECORD_FIXTURES=1); quote/submit/status are hand-written from the 1Click OpenAPI spec. */
const tokensFetch = createFixtureFetch({
  dir: new URL('./fixtures/near-intents/', import.meta.url),
});
const sent: { url: string; body?: Record<string, unknown>; apiKey: string | null }[] = [];
const fakeFetch: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const body = req.body ? JSON.parse(await req.clone().text()) : undefined;
  sent.push({ url: req.url, body, apiKey: req.headers.get('x-api-key') });
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const { pathname, searchParams } = new URL(req.url);
  if (pathname.endsWith('/tokens')) return tokensFetch(input, init);
  if (pathname.endsWith('/quote')) {
    return json({
      correlationId: 'c1',
      timestamp: NOW.toISOString(),
      signature: 'sig',
      quoteRequest: body,
      quote: {
        ...(body?.dry ? {} : { depositAddress: DEPOSIT_ADDR, deadline: '2026-10-11T13:00:00Z' }),
        amountIn: body?.amount,
        amountOut: '9950000',
        minAmountOut: '9850000',
        timeEstimate: 120,
      },
    });
  }
  if (pathname.endsWith('/deposit/submit')) return json({ status: 'PROCESSING' });
  if (pathname.endsWith('/status')) {
    return searchParams.get('depositAddress') === DEPOSIT_ADDR
      ? json({
          status: 'SUCCESS',
          updatedAt: NOW.toISOString(),
          swapDetails: { destinationChainTxHashes: [{ hash: '0xabc', explorerUrl: 'x' }] },
        })
      : json({ message: 'not found' }, 404);
  }
  return json({}, 404);
};

let testnet: TestApp;
let mainnet: TestApp;
let n = 0;
beforeAll(async () => {
  testnet = await createTestApp();
  mainnet = await createTestApp({
    now: () => NOW,
    nearIntents: createNearIntents({ apiKey: 'k', fetch: fakeFetch }),
  });
});
afterAll(async () => {
  await testnet.close();
  await mainnet.close();
});

async function signIn(app: TestApp, wallets: string[]) {
  const email = `dep${++n}-${Date.now()}@example.com`;
  await app.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
  const r = await app.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: app.mailer.lastCode(email), session: 'bearer' },
  });
  const headers = { authorization: `Bearer ${r.json().token as string}` };
  const me = (await app.app.inject({ method: 'GET', url: '/v1/me', headers })).json();
  for (const address of wallets) {
    await app.db.insert(schema.walletLinks).values({ userId: me.id, address, chainId: 143 });
  }
  return headers;
}

const quoteBody = (over: Record<string, unknown> = {}) => ({
  originAsset: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
  amount: '10000000',
  refundTo: '0x4444444444444444444444444444444444444444',
  recipient: WALLET,
  ...over,
});

describe('testnet (no 1Click client)', () => {
  it('flag is off and every endpoint answers 404 feature_disabled', async () => {
    const cfg = await testnet.app.inject({ method: 'GET', url: '/v1/config' });
    expect(cfg.json()).toEqual({ features: { anyChainDeposit: false } });
    const headers = await signIn(testnet, [WALLET]);
    for (const [method, url, payload] of [
      ['GET', '/v1/deposit/any-chain/tokens'],
      ['POST', '/v1/deposit/any-chain/quote', quoteBody()],
      ['POST', '/v1/deposit/any-chain/submit', { txHash: '0x1', depositAddress: DEPOSIT_ADDR }],
      ['GET', `/v1/deposit/any-chain/status?depositAddress=${DEPOSIT_ADDR}`],
    ] as const) {
      const res = await testnet.app.inject({ method, url, headers, payload });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error.code).toBe('feature_disabled');
    }
  });
});

describe('mainnet (1Click client set)', () => {
  it('flag is on; lists USDC origin assets from the recorded token list', async () => {
    const cfg = await mainnet.app.inject({ method: 'GET', url: '/v1/config' });
    expect(cfg.json().features.anyChainDeposit).toBe(true);
    const headers = await signIn(mainnet, []);
    const res = await mainnet.app.inject({
      method: 'GET',
      url: '/v1/deposit/any-chain/tokens',
      headers,
    });
    const { items } = res.json();
    expect(items.length).toBeGreaterThan(5);
    expect(items.every((t: { symbol: string }) => t.symbol === 'USDC')).toBe(true);
    expect(items.map((t: { blockchain: string }) => t.blockchain)).toContain('arb');
  });

  it('quotes to the own linked wallet, flags non-atomic, then polls status', async () => {
    const headers = await signIn(mainnet, [WALLET]);
    sent.length = 0;
    const res = await mainnet.app.inject({
      method: 'POST',
      url: '/v1/deposit/any-chain/quote',
      headers,
      payload: quoteBody(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      atomic: false,
      recipient: WALLET,
      depositAddress: DEPOSIT_ADDR,
      amountOut: '9950000',
    });
    const q = sent.find((s) => s.url.endsWith('/quote'))!;
    expect(q.apiKey).toBe('k');
    expect(q.body).toMatchObject({
      recipient: WALLET,
      recipientType: 'DESTINATION_CHAIN',
      destinationAsset: 'nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx',
      deadline: '2026-10-11T13:00:00.000Z',
      dry: false,
    });

    const dry = await mainnet.app.inject({
      method: 'POST',
      url: '/v1/deposit/any-chain/quote',
      headers,
      payload: quoteBody({ dry: true }),
    });
    expect(dry.json().depositAddress).toBeUndefined();

    const sub = await mainnet.app.inject({
      method: 'POST',
      url: '/v1/deposit/any-chain/submit',
      headers,
      payload: { txHash: '0x1', depositAddress: DEPOSIT_ADDR },
    });
    expect(sub.json()).toEqual({ status: 'PROCESSING' });

    const st = await mainnet.app.inject({
      method: 'GET',
      url: `/v1/deposit/any-chain/status?depositAddress=${DEPOSIT_ADDR}`,
      headers,
    });
    expect(st.json()).toMatchObject({
      atomic: false,
      status: 'SUCCESS',
      destinationTxHashes: ['0xabc'],
    });
    const missing = await mainnet.app.inject({
      method: 'GET',
      url: '/v1/deposit/any-chain/status?depositAddress=0xnope',
      headers,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('refuses a recipient that is not the caller linked wallet (403) and never calls 1Click', async () => {
    const alice = await signIn(mainnet, ['0x5555555555555555555555555555555555555555']);
    await signIn(mainnet, [OTHER]);
    sent.length = 0;
    const res = await mainnet.app.inject({
      method: 'POST',
      url: '/v1/deposit/any-chain/quote',
      headers: alice,
      payload: quoteBody({ recipient: OTHER }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('wallet_not_linked');
    expect(sent).toHaveLength(0);
  });

  it('requires sign-in', async () => {
    const res = await mainnet.app.inject({ method: 'POST', url: '/v1/deposit/any-chain/quote' });
    expect(res.statusCode).toBe(401);
  });
});
