import { createDb, schema } from '@paras/db';
import { createTestDatabase } from '@paras/testkit';
import { custom, decodeFunctionData, parseTransaction, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createIris } from '../../src/intents/clients.js';
import { pollVault } from '../../src/intents/runner.js';
import { vaultAbi } from '../../src/vault/abi.js';
import { createMonad } from '../../src/vault/chain.js';

const VAULT = '0x2222222222222222222222222222222222222222';
const user = '0x1111111111111111111111111111111111111111';
const wallet = '0x3333333333333333333333333333333333333333';

/** Minimal JSON-RPC node: enough for viem to sign, send and confirm a transaction. Records raw txs. */
function fakeNode() {
  const raw: Hex[] = [];
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_chainId':
          return '0x8f';
        case 'eth_getTransactionCount':
          return '0x0';
        case 'eth_estimateGas':
          return '0x30d40';
        case 'eth_gasPrice':
        case 'eth_maxPriorityFeePerGas':
          return '0x1';
        case 'eth_getBlockByNumber':
          return { number: '0x1', baseFeePerGas: '0x1', timestamp: '0x1', transactions: [] };
        case 'eth_sendRawTransaction':
          raw.push(params![0] as Hex);
          return '0x' + '11'.repeat(32);
        case 'eth_getTransactionReceipt':
          return {
            status: '0x1',
            transactionHash: '0x' + '11'.repeat(32),
            blockNumber: '0x1',
            blockHash: '0x' + '22'.repeat(32),
            transactionIndex: '0x0',
            from: user,
            to: VAULT,
            cumulativeGasUsed: '0x1',
            gasUsed: '0x1',
            effectiveGasPrice: '0x1',
            logs: [],
            logsBloom: '0x' + '00'.repeat(256),
            type: '0x2',
            contractAddress: null,
          };
        default:
          throw new Error(`unexpected rpc ${method}`);
      }
    },
  } as never);
  return { transport, raw };
}

describe('Monad Vault client (#57: viem VaultRegistry)', () => {
  it('registerDepositWallet sends the user signature to Vault.registerDepositWallet from the Executor key', async () => {
    const node = fakeNode();
    const sent = node.raw;
    const account = privateKeyToAccount(generatePrivateKey());
    const { registry } = createMonad({
      transport: node.transport,
      pollingMs: 10,
      chainId: 143,
      account,
      vault: VAULT,
      messageTransmitter: '0x4444444444444444444444444444444444444444',
    });
    const signature = `0x${'ab'.repeat(65)}` as Hex;
    await registry.registerDepositWallet({
      userId: 'u',
      owner: user,
      wallet,
      signature,
    });
    const tx = parseTransaction(sent[0]!);
    expect(tx.to?.toLowerCase()).toBe(VAULT);
    const call = decodeFunctionData({ abi: vaultAbi, data: tx.data! });
    expect(call.functionName).toBe('registerDepositWallet');
    expect((call.args![0] as string).toLowerCase()).toBe(user);
    expect((call.args![1] as string).toLowerCase()).toBe(wallet);
    expect(call.args![2]).toBe(signature);
  });
});

describe('Iris client', () => {
  it('returns the attestation once complete, null while pending or unindexed', async () => {
    const mk = (status: number, body: unknown) =>
      createIris({ fetch: (async () => new Response(JSON.stringify(body), { status })) as never });
    expect(await mk(404, {}).attestation(15, '0x01')).toBeNull();
    expect(
      await mk(200, { messages: [{ status: 'pending_confirmations', message: '0x', attestation: 'PENDING' }] }).attestation(15, '0x01'),
    ).toBeNull();
    expect(
      await mk(200, { messages: [{ status: 'complete', message: '0xaa', attestation: '0xbb' }] }).attestation(15, '0x01'),
    ).toEqual({ message: '0xaa', attestation: '0xbb' });
  });
});

describe('pollVault', () => {
  it('applies events then advances the cursor; replays are harmless', async () => {
    const testDb = await createTestDatabase();
    const h = createDb(testDb.url);
    const seen: unknown[] = [];
    const vault = {
      events: async (from: bigint) => ({
        events: from === 5n ? [{ kind: 'cancelled' as const, user: user as never, id: '0x01' as Hex, block: 5n }] : [],
        toBlock: from + 2n,
      }),
    };
    const engine = { onVaultEvent: async (e: unknown) => void seen.push(e) };
    expect(await pollVault(h.db, vault as never, engine as never, 5n)).toBe(1);
    expect(await pollVault(h.db, vault as never, engine as never, 5n)).toBe(0); // resumes at block 8
    const [cur] = await h.db.select().from(schema.chainCursors);
    expect(cur!.block).toBe('10');
    expect(seen).toHaveLength(1);
    await h.close();
    await testDb.drop();
  });
});
