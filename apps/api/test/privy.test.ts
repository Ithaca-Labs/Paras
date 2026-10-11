import { exitTypedData, intentTypedData } from '@paras/domain';
import { schema } from '@paras/db';
import { createDelegatedSigner, createFakePrivy, DelegationError } from '@paras/privy';
import { eq } from 'drizzle-orm';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './harness.js';
import type { VaultReader } from '../src/vault.js';

const VAULT = '0x1111111111111111111111111111111111111111' as const;
const SIGNER = 'kq_paras';
const key = generatePrivateKey();
const account = privateKeyToAccount(key);
const WALLET_ID = 'wallet_1';

const vault: VaultReader = {
  vault: VAULT,
  chainId: 10143,
  accounts: async (u) =>
    u.map(() => ({ idle: 0n, reserved: 0n, inFlight: 0n, depositWallet: null })),
};
const fake = createFakePrivy({
  users: {
    good: {
      privyUserId: 'did:privy:1',
      wallet: { id: WALLET_ID, address: account.address },
    },
    bare: { privyUserId: 'did:privy:2', wallet: null },
  },
  keys: { [WALLET_ID]: key },
});

let t: TestApp;
let headers: { authorization: string };
let userId: string;
const post = (url: string, payload?: object) =>
  t.app.inject({ method: 'POST', url, headers, payload });

beforeAll(async () => {
  t = await createTestApp({ vault, privy: { port: fake.port, signerId: SIGNER } });
});
afterAll(() => t.close());

const intent = (amount: bigint, over: { vault?: string; user?: string } = {}) =>
  intentTypedData({
    vault: over.vault ?? VAULT,
    chainId: 10143,
    user: over.user ?? account.address,
    id: `0x${'ab'.repeat(32)}`,
    amount,
    expiry: 2_000_000_000n,
    detailsHash: `0x${'cd'.repeat(32)}`,
  });

describe('Privy login (Seam 1, Privy faked)', () => {
  it('503 without Privy, 401 for a bad token, 400 without embedded wallet', async () => {
    const off = await createTestApp({ vault });
    const r = await off.app.inject({
      method: 'POST',
      url: '/v1/auth/privy',
      payload: { accessToken: 'good', identityToken: 'x' },
    });
    expect(r.statusCode).toBe(503);
    await off.close();
    const login = (accessToken: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/auth/privy',
        payload: { accessToken, identityToken: 'x', session: 'bearer' },
      });
    expect((await login('nope')).statusCode).toBe(401);
    expect((await login('bare')).statusCode).toBe(400);
  });

  it('creates a User, links the embedded wallet, and is idempotent', async () => {
    const r = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/privy',
      payload: { accessToken: 'good', identityToken: 'x', session: 'bearer' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.user.wallets).toEqual([{ address: account.address.toLowerCase(), chainId: 10143 }]);
    headers = { authorization: `Bearer ${body.token}` };
    userId = body.user.id;
    const [w] = await t.db.select().from(schema.privyWallets);
    expect(w).toMatchObject({ walletId: WALLET_ID, userId, privyUserId: 'did:privy:1' });

    const again = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/privy',
      payload: { accessToken: 'good', identityToken: 'x', session: 'bearer' },
    });
    expect(again.json().user.id).toBe(userId);
  });
});

describe('delegation lifecycle', () => {
  it('starts with none; grant creates the policy and a pending row', async () => {
    const g = await t.app.inject({ method: 'GET', url: '/v1/delegation', headers });
    expect(g.json()).toMatchObject({ status: 'none', wallet: account.address.toLowerCase() });

    const bad = await post('/v1/delegation', { maxIntent: '100', cap: '10' });
    expect(bad.statusCode).toBe(400);

    const r = await post('/v1/delegation', { maxIntent: '50', cap: '120' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      status: 'pending',
      signerId: SIGNER,
      policyIds: ['policy_1'],
      maxIntent: '50',
      cap: '120',
      spent: '0',
    });
    const policy = fake.calls.policies[0]!;
    expect(policy.rules[0]!.conditions).toContainEqual(
      expect.objectContaining({ field: 'amount', operator: 'lte', value: '50000000' }),
    );
    expect(policy.rules[0]!.conditions).toContainEqual(
      expect.objectContaining({ field: 'verifyingContract', value: VAULT }),
    );
  });

  it('signer refuses while pending; confirm needs the signer registered at Privy', async () => {
    const signer = createDelegatedSigner({
      privy: fake.port,
      db: t.db,
      vault: VAULT,
      chainId: 10143,
    });
    await expect(signer.signIntent(userId, intent(1n))).rejects.toThrow(DelegationError);

    expect((await post('/v1/delegation/confirm')).statusCode).toBe(409);
    fake.signers[WALLET_ID] = [SIGNER];
    const ok = await post('/v1/delegation/confirm');
    expect(ok.json().status).toBe('active');
  });

  it('signs an in-scope Intent that recovers to the User wallet, and charges the cap', async () => {
    const signer = createDelegatedSigner({
      privy: fake.port,
      db: t.db,
      vault: VAULT,
      chainId: 10143,
    });
    const typed = intent(40_000_000n, { user: account.address });
    const sig = await signer.signIntent(userId, typed);
    expect(await recoverTypedDataAddress({ ...typed, signature: sig as Hex })).toBe(
      account.address,
    );
    // what Privy received is JSON-safe and lowercase
    const sent = fake.calls.signed.at(-1)!.typed;
    expect(sent.message.amount).toBe('40000000');
    expect(sent.message.user).toBe(account.address.toLowerCase());
    expect(sent.domain.verifyingContract).toBe(VAULT);
    const g = await t.app.inject({ method: 'GET', url: '/v1/delegation', headers });
    expect(g.json().spent).toBe('40');
  });

  it('refuses anything outside the policy and never calls Privy for it', async () => {
    const signer = createDelegatedSigner({
      privy: fake.port,
      db: t.db,
      vault: VAULT,
      chainId: 10143,
    });
    const before = fake.calls.signed.length;
    const code = async (p: Promise<unknown>) =>
      p.then(
        () => 'allowed',
        (e: DelegationError) => e.code,
      );
    expect(await code(signer.signIntent(userId, intent(50_000_001n)))).toBe('over_intent_cap');
    expect(
      await code(
        signer.signIntent(
          userId,
          intent(1n, { vault: '0x3333333333333333333333333333333333333333' }),
        ),
      ),
    ).toBe('verifying_contract_not_vault');
    expect(
      await code(
        signer.signIntent(
          userId,
          intent(1n, { user: '0x4444444444444444444444444444444444444444' }),
        ),
      ),
    ).toBe('user_not_wallet');
    // cumulative cap: 40 spent of 120; 50 fits (90), another 50 would be 140
    expect(await code(signer.signIntent(userId, intent(50_000_000n)))).toBe('allowed');
    expect(await code(signer.signIntent(userId, intent(50_000_000n)))).toBe('over_spend_cap');
    expect(fake.calls.signed.length).toBe(before + 1);
  });

  it('signs Exits, relays submitIntent / cancelIntent to the Vault only', async () => {
    const signer = createDelegatedSigner({
      privy: fake.port,
      db: t.db,
      vault: VAULT,
      chainId: 10143,
    });
    const e = exitTypedData({
      user: account.address,
      positionId: 'pos',
      shares: 5n,
      minPrice: '0.4',
      returnTo: 'vault',
      deadline: 2_000_000_000n,
    });
    const sig = await signer.signExit(userId, e);
    expect(sig).toMatch(/^0x[0-9a-f]+$/);

    const hash = await signer.cancelIntent(userId, `0x${'ab'.repeat(32)}`);
    expect(hash.hash).toMatch(/^0x/);
    const tx = fake.calls.sent.at(-1)!;
    expect(tx).toMatchObject({ walletId: WALLET_ID, chainId: 10143, to: VAULT });
    expect(tx.data.startsWith('0x')).toBe(true);
    await signer.submitIntent(userId, intent(1n).message, '0x1234');
    expect(fake.calls.sent).toHaveLength(2);
    expect(fake.calls.sent.at(-1)!.to).toBe(VAULT);
  });

  it('revoke stops the signer immediately; re-grant resets spend', async () => {
    const signer = createDelegatedSigner({
      privy: fake.port,
      db: t.db,
      vault: VAULT,
      chainId: 10143,
    });
    const r = await post('/v1/delegation/revoke');
    expect(r.json().status).toBe('revoked');
    await expect(signer.signIntent(userId, intent(1n))).rejects.toMatchObject({
      code: 'no_active_delegation',
    });
    await expect(signer.cancelIntent(userId, `0x${'ab'.repeat(32)}`)).rejects.toThrow(
      DelegationError,
    );
    const g = await post('/v1/delegation', { maxIntent: '10', cap: '10' });
    expect(g.json()).toMatchObject({ status: 'pending', spent: '0' });
    const [d] = await t.db
      .select()
      .from(schema.delegations)
      .where(eq(schema.delegations.userId, userId));
    expect(d!.status).toBe('pending');
  });

  it('a failed Privy sign refunds the charged amount', async () => {
    fake.signers[WALLET_ID] = [SIGNER];
    await post('/v1/delegation/confirm');
    const failing = createDelegatedSigner({
      privy: { ...fake.port, signTypedData: async () => Promise.reject(new Error('privy down')) },
      db: t.db,
      vault: VAULT,
      chainId: 10143,
    });
    await expect(failing.signIntent(userId, intent(5_000_000n))).rejects.toThrow('privy down');
    const g = await t.app.inject({ method: 'GET', url: '/v1/delegation', headers });
    expect(g.json().spent).toBe('0');
  });
});
