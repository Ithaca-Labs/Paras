import type { PrivyClient } from '@privy-io/node';
import {
  custom,
  decodeFunctionData,
  encodeFunctionData,
  parseAbi,
  parseTransaction,
  type Hex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { vaultAbi } from '../../src/vault/abi.js';
import { createMonad } from '../../src/vault/chain.js';
import { executorPolicy, privyExecutorAccount } from '../../src/vault/privy.js';

const VAULT = '0x2222222222222222222222222222222222222222';
const user = '0x1111111111111111111111111111111111111111';
const CHAIN = 10143;
const key = privateKeyToAccount(generatePrivateKey());

type Cond = { field_source: string; field: string; operator: string; value: string; abi?: never };

interface PrivyTx {
  to: Hex;
  data: Hex;
  chain_id: number;
  nonce?: number;
  gas_limit: Hex;
  max_fee_per_gas: Hex;
  max_priority_fee_per_gas: Hex;
}

/** Fake Privy: evaluates the policy body like Privy would (deny by default), then signs with a local key. */
function fakePrivy(policy: ReturnType<typeof executorPolicy>) {
  const signTransaction = async (_id: string, { params }: { params: { transaction: PrivyTx } }) => {
    const tx = params.transaction;
    const fn = (() => {
      try {
        return decodeFunctionData({ abi: vaultAbi, data: tx.data }).functionName as string;
      } catch {
        return undefined;
      }
    })();
    const fields: Record<string, string | undefined> = {
      to: tx.to,
      chain_id: String(tx.chain_id),
      function_name: fn,
    };
    const allowed = policy.rules.some((r) =>
      (r.conditions as readonly Cond[]).every(
        (c) => fields[c.field]?.toLowerCase() === c.value.toLowerCase(),
      ),
    );
    if (!allowed) throw new Error('policy violation: denied');
    const signed = await key.signTransaction({
      type: 'eip1559',
      to: tx.to,
      data: tx.data,
      chainId: tx.chain_id,
      nonce: tx.nonce ?? 0,
      gas: BigInt(tx.gas_limit),
      maxFeePerGas: BigInt(tx.max_fee_per_gas),
      maxPriorityFeePerGas: BigInt(tx.max_priority_fee_per_gas),
    });
    return { signed_transaction: signed, encoding: 'rlp' };
  };
  return {
    wallets: () => ({
      get: async () => ({ address: key.address }),
      ethereum: () => ({ signTransaction }),
    }),
  } as unknown as PrivyClient;
}

function fakeNode() {
  const raw: Hex[] = [];
  const transport = custom({
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_chainId':
          return '0x' + CHAIN.toString(16);
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
            from: key.address,
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

const monadWith = async (vault = VAULT) => {
  const node = fakeNode();
  const account = await privyExecutorAccount(
    fakePrivy(executorPolicy({ vault: VAULT, chainId: CHAIN })),
    'w1',
  );
  const { chain } = createMonad({
    transport: node.transport,
    pollingMs: 10,
    chainId: CHAIN,
    account,
    vault: vault as `0x${string}`,
    messageTransmitter: '0x4444444444444444444444444444444444444444',
  });
  return { chain, node };
};

describe('Executor Monad signer on Privy (#94)', () => {
  it('policy body: ALLOW rules for exactly the Executor Vault functions, pinned to Vault + chain', () => {
    const p = executorPolicy({ vault: VAULT, chainId: CHAIN });
    expect(p.chain_type).toBe('ethereum');
    expect(p.rules.map((r) => r.name)).toEqual([
      'vault.registerDepositWallet',
      'vault.dispatch',
      'vault.settle',
      'vault.closeIntent',
      'vault.expireIntent',
    ]);
    for (const r of p.rules) {
      expect(r.action).toBe('ALLOW');
      expect(r.conditions).toContainEqual(
        expect.objectContaining({ field: 'to', operator: 'eq', value: VAULT }),
      );
      expect(r.conditions).toContainEqual(
        expect.objectContaining({ field: 'chain_id', operator: 'eq', value: String(CHAIN) }),
      );
    }
  });

  it('allowed Vault call is signed by the Privy wallet and sent', async () => {
    const { chain, node } = await monadWith();
    await chain.closeIntent(user, `0x${'01'.repeat(32)}`);
    const tx = parseTransaction(node.raw[0]!);
    expect(tx.to?.toLowerCase()).toBe(VAULT);
    expect(decodeFunctionData({ abi: vaultAbi, data: tx.data! }).functionName).toBe('closeIntent');
  });

  it('refuses a call to a non-Vault address (negative)', async () => {
    const { chain, node } = await monadWith('0x9999999999999999999999999999999999999999');
    await expect(chain.closeIntent(user, `0x${'01'.repeat(32)}`)).rejects.toThrow(
      /policy violation/,
    );
    expect(node.raw).toHaveLength(0);
  });

  it('refuses a non-allowlisted function on the Vault (negative)', async () => {
    const account = await privyExecutorAccount(
      fakePrivy(executorPolicy({ vault: VAULT, chainId: CHAIN })),
      'w1',
    );
    const data = encodeFunctionData({
      abi: parseAbi(['function withdraw(uint256 amount)']),
      functionName: 'withdraw',
      args: [1n],
    });
    await expect(
      account.signTransaction({
        type: 'eip1559',
        to: VAULT,
        data,
        chainId: CHAIN,
        gas: 100000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
      }),
    ).rejects.toThrow(/policy violation/);
  });
});
