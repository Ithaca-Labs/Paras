import { schema } from '@paras/db';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEnvioActivity, type VaultActivitySource } from '../src/envio.js';
import { createTestApp, type TestApp } from './harness.js';

const ADDR = privateKeyToAccount(generatePrivateKey()).address.toLowerCase();
const H = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

const calls: Parameters<VaultActivitySource['cash']>[0][] = [];
let broken = false;
const fake: VaultActivitySource = {
  async cash(p) {
    calls.push(p);
    if (broken) throw new Error('envio down');
    return [
      {
        id: 'e1',
        kind: 'withdrawal',
        amountUsdc: '3000000',
        txHash: H(2),
        at: new Date('2026-10-02'),
      },
    ];
  },
};

let t: TestApp;
let headers: Record<string, string>;
beforeAll(async () => {
  t = await createTestApp({ activity: fake });
  const email = `envio-${Date.now()}@example.com`;
  await t.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
  const r = await t.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: t.mailer.lastCode(email), session: 'bearer' },
  });
  headers = { authorization: `Bearer ${r.json().token}` };
  const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers });
  await t.db
    .insert(schema.walletLinks)
    .values({ userId: me.json().id, address: ADDR, chainId: 10143 });
  await t.db.insert(schema.vaultActivity).values({
    userAddress: ADDR,
    kind: 'deposit',
    amountUsdc: '9000000',
    txHash: H(1),
    logIndex: 0,
    at: new Date('2026-10-01'),
  });
});
afterAll(() => t.close());

const history = async () =>
  (await t.app.inject({ method: 'GET', url: '/v1/vault/history', headers })).json().items;

describe('history with ENVIO_GRAPHQL_URL set', () => {
  it('reads cash flows from Envio, not the polled table', async () => {
    const items = await history();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'withdrawal', amount: '3' });
    expect(calls.at(-1)?.users).toEqual([ADDR]);
  });

  it('falls back to the polled table when Envio fails', async () => {
    broken = true;
    const items = await history();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'deposit', amount: '9' });
  });
});

describe('createEnvioActivity', () => {
  it('queries Hasura and maps rows', async () => {
    let body: { variables: Record<string, unknown> } | undefined;
    const src = createEnvioActivity('http://envio.test/v1/graphql', (async (_u, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({
        data: {
          VaultActivity: [
            { id: 'a', kind: 'deposit', amount: '5', txHash: H(3), blockTimestamp: 1_700_000_000 },
          ],
        },
      });
    }) as typeof fetch);
    const rows = await src.cash({ users: ['0xABC'], limit: 5 });
    expect(body?.variables).toMatchObject({ users: ['0xabc'], limit: 5 });
    expect(rows).toEqual([
      { id: 'a', kind: 'deposit', amountUsdc: '5', txHash: H(3), at: new Date(1_700_000_000_000) },
    ]);
  });

  it('throws on a GraphQL error', async () => {
    const src = createEnvioActivity('http://envio.test', (async () =>
      Response.json({ errors: [{ message: 'x' }] })) as typeof fetch);
    await expect(src.cash({ users: [], limit: 1 })).rejects.toThrow('envio query failed');
  });
});
