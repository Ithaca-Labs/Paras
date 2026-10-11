/**
 * Privy delegation (#92): what Paras's session signer may do for a User's embedded wallet.
 * `buildDelegationPolicy` is the Privy policy registered for the signer; `checkDelegatedRequest`
 * is the same allowlist enforced in-process before any Privy call (defence in depth, and the
 * only place the cumulative spend cap lives, since Privy policies are stateless).
 */

export interface DelegationScope {
  vault: string;
  chainId: number;
  /** The User's embedded wallet. */
  wallet: string;
  /** Max USDC base units for a single Intent. */
  maxIntent: bigint;
}

/** Vault functions the signer may call. Everything else is denied. */
export const DELEGATED_FUNCTIONS = ['submitIntent', 'cancelIntent'] as const;

const INTENT_TYPES = {
  Intent: [
    { name: 'user', type: 'address' },
    { name: 'id', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'expiry', type: 'uint64' },
    { name: 'detailsHash', type: 'bytes32' },
  ],
};
const EXIT_TYPES = {
  Exit: [
    { name: 'user', type: 'address' },
    { name: 'positionId', type: 'string' },
    { name: 'shares', type: 'uint256' },
    { name: 'minPrice', type: 'string' },
    { name: 'returnTo', type: 'string' },
    { name: 'deadline', type: 'uint64' },
  ],
};
const ABI = [
  {
    type: 'function',
    name: 'submitIntent',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'i',
        type: 'tuple',
        components: [
          { name: 'user', type: 'address' },
          { name: 'id', type: 'bytes32' },
          { name: 'amount', type: 'uint256' },
          { name: 'expiry', type: 'uint64' },
          { name: 'detailsHash', type: 'bytes32' },
        ],
      },
      { name: 'sig', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelIntent',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
  },
];

const lc = (s: string) => s.toLowerCase();

/** Body for Privy `POST /v1/policies`. Privy compares strings case-sensitively, so addresses are lowercase. */
export function buildDelegationPolicy(s: DelegationScope) {
  const msg = (
    primary: 'Intent' | 'Exit',
    field: string,
    operator: 'eq' | 'lte',
    value: string,
  ) => ({
    field_source: 'ethereum_typed_data_message' as const,
    field,
    operator,
    value,
    typed_data: {
      primary_type: primary,
      types: primary === 'Intent' ? INTENT_TYPES : EXIT_TYPES,
    },
  });
  const domain = (field: 'chainId' | 'verifyingContract', value: string | number) => ({
    field_source: 'ethereum_typed_data_domain' as const,
    field,
    operator: 'eq' as const,
    value,
  });
  const tx = (field: string, value: string) => ({
    field_source: 'ethereum_transaction' as const,
    field,
    operator: 'eq' as const,
    value,
  });
  const wallet = lc(s.wallet);
  return {
    version: '1.0' as const,
    name: `paras-delegation-${wallet}`,
    chain_type: 'ethereum' as const,
    rules: [
      {
        name: 'Sign Vault Intent for this wallet, capped',
        method: 'eth_signTypedData_v4' as const,
        conditions: [
          domain('verifyingContract', lc(s.vault)),
          domain('chainId', s.chainId),
          msg('Intent', 'user', 'eq', wallet),
          msg('Intent', 'amount', 'lte', s.maxIntent.toString()),
        ],
        action: 'ALLOW' as const,
      },
      {
        // The Exit domain names no contract (the API verifies it), so only the signer's own user is pinned.
        name: 'Sign Exit for this wallet',
        method: 'eth_signTypedData_v4' as const,
        conditions: [msg('Exit', 'user', 'eq', wallet)],
        action: 'ALLOW' as const,
      },
      {
        name: 'Call Vault submitIntent / cancelIntent, no value',
        method: 'eth_sendTransaction' as const,
        conditions: [
          tx('to', lc(s.vault)),
          tx('value', '0'),
          {
            field_source: 'ethereum_calldata' as const,
            abi: ABI,
            field: 'function_name',
            operator: 'in' as const,
            value: [...DELEGATED_FUNCTIONS],
          },
        ],
        action: 'ALLOW' as const,
      },
    ],
  };
}

export type DelegationPolicyBody = ReturnType<typeof buildDelegationPolicy>;

export type DelegatedRequest =
  | {
      kind: 'typedData';
      domain: { chainId?: number | bigint | undefined; verifyingContract?: string | undefined };
      primaryType: string;
      message: Record<string, unknown>;
    }
  | { kind: 'tx'; to: string; value: bigint; fn: string; chainId: number };

/** null = allowed, else the refusal reason. Mirrors the Privy policy above. */
export function checkDelegatedRequest(s: DelegationScope, r: DelegatedRequest): string | null {
  if (r.kind === 'tx') {
    if (lc(r.to) !== lc(s.vault)) return 'to_not_vault';
    if (r.chainId !== s.chainId) return 'wrong_chain';
    if (r.value !== 0n) return 'value_not_zero';
    if (!(DELEGATED_FUNCTIONS as readonly string[]).includes(r.fn)) return 'function_not_allowed';
    return null;
  }
  const user = r.message.user;
  if (typeof user !== 'string' || lc(user) !== lc(s.wallet)) return 'user_not_wallet';
  if (r.primaryType === 'Exit') return null;
  if (r.primaryType !== 'Intent') return 'primary_type_not_allowed';
  if (lc(r.domain.verifyingContract ?? '') !== lc(s.vault)) return 'verifying_contract_not_vault';
  if (Number(r.domain.chainId) !== s.chainId) return 'wrong_chain';
  const amount = r.message.amount;
  if (typeof amount !== 'bigint' || amount <= 0n) return 'bad_amount';
  if (amount > s.maxIntent) return 'over_intent_cap';
  return null;
}
