import { createDb, schema, type DbHandle } from '@paras/db';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { eq } from 'drizzle-orm';
import { decodeFunctionData, recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { depositWalletAbi } from '../../src/wallet/abi.js';
import { batchTypedData, type Batch } from '../../src/wallet/batch.js';
import {
  approve,
  burnToVault,
  swapUsdc,
  unwrapToUsdcE,
  wrapUsdcE,
} from '../../src/wallet/calls.js';
import { POLYGON, POLYGON_CHAIN_ID } from '../../src/wallet/constants.js';
import { EnvKeyCipher, type KeyCipher } from '../../src/wallet/key-cipher.js';
import { PolicyViolation } from '../../src/wallet/policy.js';
import type { RelayerClient } from '../../src/wallet/relayer.js';
import { WalletService } from '../../src/wallet/service.js';

const MASTER = '11'.repeat(32);
const VAULT: Address = '0x2222222222222222222222222222222222222222';
const attacker: Address = '0x000000000000000000000000000000000000bEEF';

/** Relayer double: records submissions, tracks nonces, can be told to fail. */
class FakeRelayer implements RelayerClient {
  deployed: { owner: Address; salt: Hex }[] = [];
  submitted: { batch: Batch; signature: Hex; signer: Address }[] = [];
  nonce = 0n;
  failSubmit = false;
  async deployWallet(p: { owner: Address; salt: Hex }) {
    this.deployed.push(p);
    return { txId: `deploy-${this.deployed.length}` };
  }
  async submitBatch(p: { batch: Batch; signature: Hex; signer: Address }) {
    if (this.failSubmit) throw new Error('relayer down');
    this.submitted.push(p);
    this.nonce += 1n;
    return { txId: `tx-${this.submitted.length}` };
  }
  async getNonce() {
    return this.nonce;
  }
  async waitConfirmed() {}
}

/** Counts decrypts so tests can prove a rejected batch never touches key material. */
class SpyCipher implements KeyCipher {
  decrypts = 0;
  private inner = new EnvKeyCipher(MASTER);
  encrypt = (p: string, a: string) => this.inner.encrypt(p, a);
  decrypt(c: string, a: string) {
    this.decrypts += 1;
    return this.inner.decrypt(c, a);
  }
}

describe('WalletService (Seam 4: provisioning, session keys, rotation, policy)', () => {
  let testDb: TestDatabase;
  let h: DbHandle;
  const owner = privateKeyToAccount(generatePrivateKey());
  const relayer = new FakeRelayer();
  const cipher = new SpyCipher();
  let clock = new Date('2026-10-09T12:00:00Z');
  let svc: WalletService;
  let userId: string;
  let walletId: string;
  let walletAddress: Address;
  const registered: unknown[] = [];

  beforeAll(async () => {
    testDb = await createTestDatabase();
    h = createDb(testDb.url);
    const [u] = await h.db.insert(schema.users).values({}).returning();
    userId = u!.id;
    svc = new WalletService({
      db: h.db,
      cipher,
      relayer,
      now: () => clock,
      chain: { predictWalletAddress: async (salt) => `0x${salt.slice(2, 42)}` as Address },
      vault: {
        vault: VAULT,
        registerDepositWallet: async (p) => void registered.push(p),
      },
    });
  });
  afterAll(async () => {
    await h.close();
    await testDb.drop();
  });

  const ownerSign = (b: Batch) => owner.signTypedData(batchTypedData(b, POLYGON_CHAIN_ID));

  async function changeKey() {
    const p = await svc.beginSessionKeyChange(walletId);
    const sig = await ownerSign(p.batch);
    return {
      p,
      key: await svc.completeSessionKeyChange({
        keyId: p.keyId,
        batch: p.batch,
        ownerSignature: sig,
      }),
    };
  }

  it('provisions a Deposit Wallet once (idempotent) owned by the user EOA', async () => {
    const w = await svc.provision({ userId, owner: owner.address });
    expect(w.status).toBe('deployed');
    expect(w.ownerAddress).toBe(owner.address.toLowerCase());
    expect(relayer.deployed).toHaveLength(1);
    expect(relayer.deployed[0]!.owner).toBe(owner.address);
    const again = await svc.provision({ userId, owner: owner.address });
    expect(again.id).toBe(w.id);
    expect(relayer.deployed).toHaveLength(1);
    walletId = w.id;
    walletAddress = w.walletAddress as Address;
  });

  it('refuses to re-provision with a different owner', async () => {
    await expect(svc.provision({ userId, owner: attacker })).rejects.toThrow(/owner differs/);
  });

  it('registers the wallet with the Vault', async () => {
    const w = await svc.registerWithVault(walletId);
    expect(w.status).toBe('registered');
    expect(registered).toHaveLength(1);
    await svc.registerWithVault(walletId);
    expect(registered).toHaveLength(1);
  });

  it('cannot sign before a key is granted', async () => {
    await svc.openIntent({ intentId: 'i1', walletId, capUsdc: 500_000_000n });
    await expect(
      svc.submitSessionBatch({
        walletId,
        intentId: 'i1',
        calls: [approve(POLYGON.pUSD, POLYGON.offramp, 1n)],
      }),
    ).rejects.toThrow(/no active session key/);
  });

  it('rejects a grant whose owner signature is not from the wallet owner', async () => {
    const p = await svc.beginSessionKeyChange(walletId);
    const bad = await privateKeyToAccount(generatePrivateKey()).signTypedData(
      batchTypedData(p.batch, POLYGON_CHAIN_ID),
    );
    await expect(
      svc.completeSessionKeyChange({ keyId: p.keyId, batch: p.batch, ownerSignature: bad }),
    ).rejects.toThrow(/signature invalid/);
    expect(relayer.submitted).toHaveLength(0);
  });

  it('rejects a grant that smuggles a different call into the owner batch', async () => {
    const p = await svc.beginSessionKeyChange(walletId);
    const tampered: Batch = { ...p.batch, calls: [approve(POLYGON.pUSD, attacker, 1n)] };
    await expect(
      svc.completeSessionKeyChange({
        keyId: p.keyId,
        batch: tampered,
        ownerSignature: await ownerSign(tampered),
      }),
    ).rejects.toThrow(/does not match/);
  });

  let firstKey: string;
  it('grants a 180-day session key via an owner-signed authorizeSessionSigner batch; key stored encrypted', async () => {
    const { p, key } = await changeKey();
    firstKey = key.id;
    expect(key.status).toBe('active');
    expect(key.validUntil.getTime() - clock.getTime()).toBe(180 * 86_400_000);
    const sub = relayer.submitted.at(-1)!;
    expect(sub.signer).toBe(owner.address);
    expect(
      await recoverTypedDataAddress({
        ...batchTypedData(sub.batch, POLYGON_CHAIN_ID),
        signature: sub.signature,
      }),
    ).toBe(owner.address);
    const calls = sub.batch.calls.map((c) =>
      decodeFunctionData({ abi: depositWalletAbi, data: c.data }),
    );
    expect(calls.map((c) => c.functionName)).toEqual(['authorizeSessionSigner']);
    expect(calls[0]!.args![0]).toBe(p.sessionAddress);
    // At rest: ciphertext, not a private key, bound to the key address.
    const [row] = await h.db
      .select()
      .from(schema.executorSessionKeys)
      .where(eq(schema.executorSessionKeys.id, key.id));
    expect(row!.ciphertext).toMatch(/^v1\./);
    expect(row!.ciphertext).not.toMatch(/0x[0-9a-f]{64}/);
    await expect(cipher.decrypt(row!.ciphertext, attacker.toLowerCase())).rejects.toThrow();
  });

  it('signs an allowed batch with the session key (verifiable signature, nonce from relayer)', async () => {
    const before = relayer.submitted.length;
    const { txId } = await svc.submitSessionBatch({
      walletId,
      intentId: 'i1',
      calls: [
        approve(POLYGON.usdcNative, POLYGON.swapRouter02, 100_000_000n),
        swapUsdc('nativeToE', walletAddress, 100_000_000n, 99_500_000n),
        approve(POLYGON.usdcE, POLYGON.onramp, 99_500_000n),
        wrapUsdcE(walletAddress, 99_500_000n),
      ],
    });
    expect(txId).toBeTruthy();
    const sub = relayer.submitted.at(-1)!;
    expect(relayer.submitted).toHaveLength(before + 1);
    expect(sub.batch.nonce).toBe(relayer.nonce - 1n);
    const [k] = await h.db
      .select()
      .from(schema.executorSessionKeys)
      .where(eq(schema.executorSessionKeys.id, firstKey));
    expect(sub.signer).toBe((await import('viem')).getAddress(k!.address));
  });

  it('refuses non-allowlisted batches WITHOUT touching key material or the relayer', async () => {
    const decrypts = cipher.decrypts;
    const submitted = relayer.submitted.length;
    const bad: Parameters<typeof svc.submitSessionBatch>[0][] = [
      // pUSD.transfer(attacker, all): the exact on-chain-permitted attack from spikes/17
      {
        walletId,
        intentId: 'i1',
        calls: [
          {
            target: POLYGON.pUSD,
            value: 0n,
            data: '0xa9059cbb000000000000000000000000000000000000000000000000000000000000beef0000000000000000000000000000000000000000000000000000000005f5e100',
          },
        ],
      },
      { walletId, intentId: 'i1', calls: [approve(POLYGON.pUSD, attacker, 1n)] },
      { walletId, intentId: 'i1', calls: [burnToVault(attacker, 1n)] },
      { walletId, intentId: 'i1', calls: [wrapUsdcE(attacker, 1n)] },
    ];
    for (const b of bad)
      await expect(svc.submitSessionBatch(b)).rejects.toBeInstanceOf(PolicyViolation);
    expect(cipher.decrypts).toBe(decrypts);
    expect(relayer.submitted).toHaveLength(submitted);
  });

  it('enforces the per-Intent funding cap cumulatively and releases it if the relayer fails', async () => {
    await svc.openIntent({ intentId: 'cap', walletId, capUsdc: 150_000_000n });
    const buy = (amt: bigint) => ({
      walletId,
      intentId: 'cap',
      calls: [swapUsdc('nativeToE', walletAddress, amt, (amt * 995n) / 1000n)],
    });
    await svc.submitSessionBatch(buy(100_000_000n));
    await expect(svc.submitSessionBatch(buy(100_000_000n))).rejects.toThrow(/funding cap/);
    relayer.failSubmit = true;
    await expect(svc.submitSessionBatch(buy(50_000_000n))).rejects.toThrow(/relayer down/);
    relayer.failSubmit = false;
    // reservation was released, so the remaining 50 still fits
    await svc.submitSessionBatch(buy(50_000_000n));
    await expect(svc.submitSessionBatch(buy(1000n))).rejects.toThrow(/funding cap/);
  });

  it('allows sweep-back (unwrap, swap, burn to Vault) without consuming funding', async () => {
    await svc.openIntent({ intentId: 'sweep', walletId, capUsdc: 0n });
    await svc.submitSessionBatch({
      walletId,
      intentId: 'sweep',
      calls: [
        unwrapToUsdcE(walletAddress, 10_000_000n),
        swapUsdc('eToNative', walletAddress, 10_000_000n, 9_950_000n),
        burnToVault(VAULT, 9_950_000n),
      ],
    });
  });

  it('rotation: new key active, old key revoked on-chain (batch) and locally, old key unusable', async () => {
    clock = new Date(clock.getTime() + 160 * 86_400_000); // 20 days left
    const due = await svc.keysDueForRotation();
    expect(due.map((k) => k.id)).toEqual([firstKey]);

    const { p, key: second } = await changeKey();
    const sub = relayer.submitted.at(-1)!;
    const names = sub.batch.calls.map((c) =>
      decodeFunctionData({ abi: depositWalletAbi, data: c.data }),
    );
    expect(names.map((n) => n.functionName)).toEqual([
      'revokeSessionSigner',
      'authorizeSessionSigner',
    ]);
    expect(names[0]!.args![0]!.toString().toLowerCase()).not.toBe(p.sessionAddress.toLowerCase());
    expect(names[1]!.args![0]).toBe(p.sessionAddress);

    const rows = await h.db
      .select()
      .from(schema.executorSessionKeys)
      .where(eq(schema.executorSessionKeys.walletId, walletId));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[firstKey]).toBe('revoked');
    expect(byId[second.id]).toBe('active');
    expect(await svc.keysDueForRotation()).toEqual([]);

    // signing now uses the new key
    await svc.submitSessionBatch({
      walletId,
      intentId: 'sweep',
      calls: [approve(POLYGON.pUSD, POLYGON.offramp, 1n)],
    });
    expect(relayer.submitted.at(-1)!.signer.toLowerCase()).toBe(second.address);
  });

  it('refuses to sign with an expired key and after the local kill switch', async () => {
    const [active] = await h.db
      .select()
      .from(schema.executorSessionKeys)
      .where(eq(schema.executorSessionKeys.status, 'active'));
    const call = approve(POLYGON.pUSD, POLYGON.offramp, 1n);
    const real = clock;
    clock = new Date(active!.validUntil.getTime() + 1000);
    await expect(
      svc.submitSessionBatch({ walletId, intentId: 'sweep', calls: [call] }),
    ).rejects.toThrow(/key expired/);
    clock = real;
    await svc.disableSessionKey(active!.id);
    await expect(
      svc.submitSessionBatch({ walletId, intentId: 'sweep', calls: [call] }),
    ).rejects.toThrow(/no active session key/);
  });
});
