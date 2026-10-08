import { schema } from '@paras/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';
import type { VaultAccount, VaultReader } from '../src/vault.js';

const VAULT = '0x1111111111111111111111111111111111111111' as const;
const ALICE_EOA = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa' as const;
const WALLET = '0x2222222222222222222222222222222222222222' as const;

/** Fake chain: balances keyed by lowercase address; mutate to simulate deposits/withdrawals. */
const chain = new Map<string, VaultAccount>();
const fake: VaultReader = {
  vault: VAULT,
  chainId: 10143,
  accounts: async (users) =>
    users.map(
      (u) =>
        chain.get(u.toLowerCase()) ?? { idle: 0n, reserved: 0n, inFlight: 0n, depositWallet: null },
    ),
};

let t: TestApp;
let withVault: TestApp;
let n = 0;

beforeAll(async () => {
  t = await createTestApp();
  withVault = await createTestApp({ vault: fake });
});
afterAll(async () => {
  await t.close();
  await withVault.close();
});

async function signIn(app: TestApp, wallets: string[] = []) {
  const email = `vault${++n}-${Date.now()}@example.com`;
  await app.app.inject({ method: 'POST', url: '/v1/auth/email/request', payload: { email } });
  const r = await app.app.inject({
    method: 'POST',
    url: '/v1/auth/email/verify',
    payload: { email, code: app.mailer.lastCode(email), session: 'bearer' },
  });
  const token = r.json().token as string;
  const headers = { authorization: `Bearer ${token}` };
  const me = (await app.app.inject({ method: 'GET', url: '/v1/me', headers })).json();
  for (const address of wallets) {
    await app.db
      .insert(schema.walletLinks)
      .values({ userId: me.id, address: address.toLowerCase(), chainId: 10143 });
  }
  return headers;
}

describe('GET /v1/vault/balance', () => {
  it('401 when signed out', async () => {
    const res = await withVault.app.inject({ method: 'GET', url: '/v1/vault/balance' });
    expect(res.statusCode).toBe(401);
  });

  it('503 when the chain is not configured', async () => {
    const headers = await signIn(t);
    const res = await t.app.inject({ method: 'GET', url: '/v1/vault/balance', headers });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('vault_unavailable');
  });

  it('empty breakdown for a User with no linked wallet', async () => {
    const headers = await signIn(withVault);
    const res = await withVault.app.inject({ method: 'GET', url: '/v1/vault/balance', headers });
    expect(res.json()).toEqual({
      vault: VAULT,
      chainId: 10143,
      total: { idle: '0', reserved: '0', inFlight: '0' },
      accounts: [],
    });
  });

  it('reflects on-chain deposits, reservations, in-flight and withdrawals', async () => {
    const headers = await signIn(withVault, [ALICE_EOA]);
    const get = async () =>
      (await withVault.app.inject({ method: 'GET', url: '/v1/vault/balance', headers })).json();

    chain.set(ALICE_EOA.toLowerCase(), {
      idle: 100_000_000n,
      reserved: 0n,
      inFlight: 0n,
      depositWallet: null,
    });
    let b = await get();
    expect(b.total).toEqual({ idle: '100', reserved: '0', inFlight: '0' });
    expect(b.accounts[0]).toMatchObject({ address: ALICE_EOA.toLowerCase(), depositWallet: null });

    chain.set(ALICE_EOA.toLowerCase(), {
      idle: 25_500_000n,
      reserved: 40_000_000n,
      inFlight: 34_500_000n,
      depositWallet: WALLET,
    });
    b = await get();
    expect(b.total).toEqual({ idle: '25.5', reserved: '40', inFlight: '34.5' });
    expect(b.accounts[0].depositWallet).toBe(WALLET);

    // withdraw everything idle
    chain.set(ALICE_EOA.toLowerCase(), {
      idle: 0n,
      reserved: 40_000_000n,
      inFlight: 34_500_000n,
      depositWallet: WALLET,
    });
    expect((await get()).total.idle).toBe('0');
  });

  it("does not expose other Users' balances", async () => {
    const other = '0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb';
    chain.set(other.toLowerCase(), { idle: 9n, reserved: 0n, inFlight: 0n, depositWallet: null });
    const headers = await signIn(withVault, ['0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc']);
    const res = await withVault.app.inject({ method: 'GET', url: '/v1/vault/balance', headers });
    expect(res.json().total.idle).toBe('0');
  });
});
