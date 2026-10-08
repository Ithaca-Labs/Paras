import { createDb, schema, type DbHandle } from '@paras/db';
import { createTestDatabase, type TestDatabase } from '@paras/testkit';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { depositWalletAbi, erc20Abi, walletFactoryAbi } from '../../src/wallet/abi.js';
import { batchTypedData, signBatchAsSession, type Batch } from '../../src/wallet/batch.js';
import { POLYGON, POLYGON_CHAIN_ID } from '../../src/wallet/constants.js';
import { EnvKeyCipher } from '../../src/wallet/key-cipher.js';
import { PolicyViolation } from '../../src/wallet/policy.js';
import type { RelayerClient } from '../../src/wallet/relayer.js';
import { WalletService } from '../../src/wallet/service.js';

const forkUrl = process.env.POLYGON_FORK_RPC_URL;
const PORT = 8546;
const rpc = `http://127.0.0.1:${PORT}`;
const factoryAbi = parseAbi([
  'function owner() view returns (address)',
  'function addAdmin(address)',
  'function addOperator(address)',
  'function deploy(address[] owners, bytes32[] ids)',
  'function proxy((address wallet, uint256 nonce, uint256 deadline, (address target, uint256 value, bytes data)[] calls)[] batches, bytes[] sigs)',
]);

/** Local fork only: gated, never runs in CI. Stands in for Polymarket's relayer by being a factory operator. */
describe.skipIf(!forkUrl)('Polygon fork: real DepositWallet (set POLYGON_FORK_RPC_URL)', () => {
  let anvil: ChildProcess;
  let testDb: TestDatabase;
  let h: DbHandle;
  const pub = createPublicClient({ chain: polygon, transport: http(rpc) });
  const test = createTestClient({ chain: polygon, mode: 'anvil', transport: http(rpc) });
  const operator = privateKeyToAccount(generatePrivateKey());
  const op = createWalletClient({ account: operator, chain: polygon, transport: http(rpc) });
  const owner = privateKeyToAccount(generatePrivateKey());
  const attacker: Address = '0x000000000000000000000000000000000000bEEF';
  let nonce = 0n;

  const relayer: RelayerClient = {
    async deployWallet(p) {
      const hash = await op.writeContract({
        address: POLYGON.walletFactory,
        abi: factoryAbi,
        functionName: 'deploy',
        args: [[p.owner], [p.salt]],
      });
      await pub.waitForTransactionReceipt({ hash });
      return { txId: hash };
    },
    async submitBatch(p) {
      const hash = await op.writeContract({
        address: POLYGON.walletFactory,
        abi: factoryAbi,
        functionName: 'proxy',
        args: [[p.batch], [p.signature]],
      });
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('batch reverted');
      nonce += 1n;
      return { txId: hash };
    },
    getNonce: async () => nonce,
    waitConfirmed: async () => ({}),
  };

  beforeAll(async () => {
    anvil = spawn('anvil', ['--fork-url', forkUrl!, '--port', String(PORT), '--silent']);
    for (let i = 0; i < 60; i++) {
      try {
        await pub.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await test.setBalance({ address: operator.address, value: 10n ** 20n });
    const fOwner = (await pub.readContract({
      address: POLYGON.walletFactory,
      abi: factoryAbi,
      functionName: 'owner',
    })) as Address;
    await test.impersonateAccount({ address: fOwner });
    await test.setBalance({ address: fOwner, value: 10n ** 20n });
    const asOwner = await createWalletClient({
      chain: polygon,
      transport: http(rpc),
    }).writeContract({
      account: fOwner,
      address: POLYGON.walletFactory,
      abi: factoryAbi,
      functionName: 'addAdmin',
      args: [operator.address],
    });
    await pub.waitForTransactionReceipt({ hash: asOwner });
    const asAdmin = await op.writeContract({
      address: POLYGON.walletFactory,
      abi: factoryAbi,
      functionName: 'addOperator',
      args: [operator.address],
    });
    await pub.waitForTransactionReceipt({ hash: asAdmin });
    testDb = await createTestDatabase();
    h = createDb(testDb.url);
  }, 120_000);

  afterAll(async () => {
    anvil?.kill();
    await h?.close();
    await testDb?.drop();
  });

  it('provisions, grants a session key, rotates it, and the policy blocks what the chain would allow', async () => {
    const [u] = await h.db.insert(schema.users).values({}).returning();
    const block = await pub.getBlock();
    const now = new Date(Number(block.timestamp) * 1000);
    const svc = new WalletService({
      db: h.db,
      cipher: new EnvKeyCipher('22'.repeat(32)),
      relayer,
      now: () => now,
      chain: {
        walletOwner: async (w: Address) => pub.readContract({ address: w, abi: depositWalletAbi, functionName: 'owner' }),
        predictWalletAddress: (id: Hex) =>
          pub.readContract({
            address: POLYGON.walletFactory,
            abi: walletFactoryAbi,
            functionName: 'predictWalletAddress',
            args: [id],
          }),
      },
      vault: {
        vault: '0x2222222222222222222222222222222222222222',
        chainId: 143,
        registerDepositWallet: async () => {},
      },
    });

    const w = await svc.provision({ userId: u!.id, owner: owner.address });
    const wallet = w.walletAddress as Address;
    expect(
      await pub.readContract({ address: wallet, abi: depositWalletAbi, functionName: 'owner' }),
    ).toBe(owner.address);

    const grant = async () => {
      const p = await svc.beginSessionKeyChange(w.id);
      await svc.completeSessionKeyChange({
        keyId: p.keyId,
        batch: p.batch,
        ownerSignature: await owner.signTypedData(batchTypedData(p.batch, POLYGON_CHAIN_ID)),
      });
      return p.sessionAddress;
    };
    const until = (s: Address) =>
      pub.readContract({
        address: wallet,
        abi: depositWalletAbi,
        functionName: 'sessionSignerAuthorizedUntil',
        args: [s],
      });

    const k1 = await grant();
    expect(await until(k1)).toBeGreaterThan(block.timestamp);
    const k2 = await grant();
    expect(await until(k2)).toBeGreaterThan(block.timestamp);
    expect(await until(k1)).toBeLessThanOrEqual(block.timestamp); // revoked on-chain

    // Policy layer refuses a transfer to an arbitrary address.
    await svc.openIntent({ intentId: 'fork', walletId: w.id, capUsdc: 1n });
    const evil = {
      target: POLYGON.pUSD,
      value: 0n,
      data: '0xa9059cbb000000000000000000000000000000000000000000000000000000000000beef0000000000000000000000000000000000000000000000000000000000000001' as Hex,
    };
    await expect(
      svc.submitSessionBatch({ walletId: w.id, intentId: 'fork', calls: [evil] }),
    ).rejects.toBeInstanceOf(PolicyViolation);

    // Documents WHY the policy exists: the chain itself accepts a session-signed ERC-20 call to anyone (spikes/17).
    const rows = await h.db.select().from(schema.executorSessionKeys);
    const active = rows.find((r) => r.status === 'active')!;
    const pk = (await new EnvKeyCipher('22'.repeat(32)).decrypt(
      active.ciphertext,
      active.address,
    )) as Hex;
    const raw: Batch = {
      wallet,
      nonce,
      deadline: block.timestamp + 3600n,
      calls: [
        {
          target: POLYGON.pUSD,
          value: 0n,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'transfer',
            args: [attacker, 0n],
          }),
        },
      ],
    };
    const sig = await signBatchAsSession(pk, raw, POLYGON_CHAIN_ID);
    await expect(
      relayer.submitBatch({ batch: raw, signature: sig, signer: privateKeyToAccount(pk).address }),
    ).resolves.toBeTruthy();
  }, 120_000);
});
