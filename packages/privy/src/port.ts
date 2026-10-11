import type { DelegationPolicyBody } from '@paras/domain';

export interface TypedDataInput {
  domain: { name?: string; version?: string; chainId?: number; verifyingContract?: string };
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** What Paras needs from Privy. The real client wraps @privy-io/node; tests inject `createFakePrivy`. */
export interface PrivyPort {
  /** Verify the access + identity tokens; returns the Privy user id and their Ethereum embedded wallet, if any. */
  verifyLogin(tokens: {
    accessToken: string;
    identityToken: string;
  }): Promise<{ privyUserId: string; wallet: { id: string; address: string } | null }>;
  createPolicy(body: DelegationPolicyBody): Promise<{ id: string }>;
  /** Key-quorum ids registered as additional signers on the wallet. */
  walletSigners(walletId: string): Promise<string[]>;
  /** Signs with the Paras authorization key (the session signer); Privy enforces the policy. */
  signTypedData(walletId: string, typed: TypedDataInput): Promise<`0x${string}`>;
  /** Sends from the wallet on `eip155:<chainId>`; Privy enforces the policy. */
  sendTransaction(
    walletId: string,
    tx: { chainId: number; to: string; data: `0x${string}` },
  ): Promise<{ hash: string }>;
}
