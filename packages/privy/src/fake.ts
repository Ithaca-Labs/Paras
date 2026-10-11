import type { DelegationPolicyBody } from '@paras/domain';
import { privateKeyToAccount } from 'viem/accounts';
import type { PrivyPort, TypedDataInput } from './port.js';

/** In-memory Privy for tests: records every call, signs with a throwaway key per wallet. */
export function createFakePrivy(
  opts: {
    /** Login result per access token. */
    users?: Record<string, { privyUserId: string; wallet: { id: string; address: string } | null }>;
    /** Wallet id -> signer ids registered at Privy. */
    signers?: Record<string, string[]>;
    /** Wallet id -> private key used to sign typed data. */
    keys?: Record<string, `0x${string}`>;
  } = {},
) {
  const calls = {
    policies: [] as DelegationPolicyBody[],
    signed: [] as { walletId: string; typed: TypedDataInput }[],
    sent: [] as { walletId: string; chainId: number; to: string; data: string }[],
  };
  const signers = opts.signers ?? {};
  const port: PrivyPort = {
    async verifyLogin({ accessToken }) {
      const u = opts.users?.[accessToken];
      if (!u) throw new Error('invalid privy token');
      return u;
    },
    async createPolicy(body) {
      calls.policies.push(body);
      return { id: `policy_${calls.policies.length}` };
    },
    async walletSigners(walletId) {
      return signers[walletId] ?? [];
    },
    async signTypedData(walletId, typed) {
      calls.signed.push({ walletId, typed });
      const key = opts.keys?.[walletId];
      if (!key) throw new Error('no key for wallet');
      const types = typed.types as Record<string, { name: string; type: string }[]>;
      return privateKeyToAccount(key).signTypedData({
        domain: {
          ...typed.domain,
          verifyingContract: typed.domain.verifyingContract as `0x${string}` | undefined,
        },
        types,
        primaryType: typed.primaryType,
        // The real Privy takes decimal strings for uints; viem needs bigints back.
        message: Object.fromEntries(
          Object.entries(typed.message).map(([k, v]) => {
            const t = types[typed.primaryType]!.find((f) => f.name === k)?.type;
            return [k, t?.startsWith('uint') ? BigInt(v as string) : v];
          }),
        ),
      });
    },
    async sendTransaction(walletId, tx) {
      calls.sent.push({ walletId, ...tx });
      return { hash: `0x${calls.sent.length.toString(16).padStart(64, '0')}` };
    },
  };
  return { port, calls, signers };
}
