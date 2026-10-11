import { PrivyClient } from '@privy-io/node';
import { createViemAccount } from '@privy-io/node/viem';
import type { Address, LocalAccount } from 'viem';
import { vaultAbi } from './abi.js';

/** The only Vault functions the Executor may call on Monad. */
export const EXECUTOR_VAULT_FUNCTIONS = [
  'registerDepositWallet',
  'dispatch',
  'settle',
  'closeIntent',
  'expireIntent',
] as const;

/**
 * Privy policy for the Executor's Monad wallet. Privy denies by default, so: one ALLOW rule per Vault function,
 * each pinned to `to` = Vault, `chain_id` and that function's name (decoded from the ABI). No `value` condition:
 * viem omits zero value from the request, and the Vault functions are non-payable.
 */
export function executorPolicy(o: { vault: Address; chainId: number }) {
  const rules = EXECUTOR_VAULT_FUNCTIONS.map((fn) => ({
    name: `vault.${fn}`,
    method: 'eth_signTransaction' as const,
    action: 'ALLOW' as const,
    conditions: [
      { field_source: 'ethereum_transaction', field: 'to', operator: 'eq', value: o.vault },
      {
        field_source: 'ethereum_transaction',
        field: 'chain_id',
        operator: 'eq',
        value: String(o.chainId),
      },
      {
        field_source: 'ethereum_calldata',
        abi: vaultAbi.filter((i) => i.type === 'function' && i.name === fn),
        field: 'function_name',
        operator: 'eq',
        value: fn,
      },
    ] as const,
  }));
  return {
    name: 'paras-executor-monad',
    version: '1.0' as const,
    chain_type: 'ethereum' as const,
    rules,
  };
}

export function createPrivy(o: { appId: string; appSecret: string }) {
  return new PrivyClient({ appId: o.appId, appSecret: o.appSecret });
}

/** One-time setup: create the policy and a server wallet bound to it. */
export async function provisionExecutorWallet(
  privy: PrivyClient,
  o: { vault: Address; chainId: number },
) {
  const policy = await privy.policies().create(executorPolicy(o) as never);
  const w = await privy.wallets().create({ chain_type: 'ethereum', policy_ids: [policy.id] });
  return { walletId: w.id, address: w.address as Address, policyId: policy.id };
}

/** viem account signed by the Privy server wallet (key never leaves Privy; policy enforced there). */
export async function privyExecutorAccount(
  privy: PrivyClient,
  walletId: string,
): Promise<LocalAccount> {
  const w = await privy.wallets().get(walletId);
  return createViemAccount(privy, {
    walletId,
    address: w.address as Address,
  }) as unknown as LocalAccount;
}
