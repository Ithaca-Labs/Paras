import { createPublicClient, http, parseAbi, type Address } from 'viem';

export interface VaultAccount {
  idle: bigint;
  reserved: bigint;
  inFlight: bigint;
  /** Registered Deposit Wallet (Polygon), null if none. */
  depositWallet: Address | null;
}

/** Reads Vault state from Monad. Injectable so tests use a fake. */
export interface VaultReader {
  readonly vault: Address;
  readonly chainId: number;
  accounts(users: Address[]): Promise<VaultAccount[]>;
}

const abi = parseAbi([
  'function balanceOf(address) view returns (uint256 idle, uint256 reserved, uint256 inFlight)',
  'function depositWalletOf(address) view returns (address)',
]);

export function createVaultReader(p: {
  rpcUrl: string;
  vault: Address;
  chainId: number;
}): VaultReader {
  const client = createPublicClient({ transport: http(p.rpcUrl) });
  return {
    vault: p.vault,
    chainId: p.chainId,
    async accounts(users) {
      const reads = await Promise.all(
        users.map(async (u) => {
          const [bal, wallet] = await Promise.all([
            client.readContract({ address: p.vault, abi, functionName: 'balanceOf', args: [u] }),
            client.readContract({
              address: p.vault,
              abi,
              functionName: 'depositWalletOf',
              args: [u],
            }),
          ]);
          return { bal, wallet };
        }),
      );
      return reads.map(({ bal: [idle, reserved, inFlight], wallet }) => ({
        idle,
        reserved,
        inFlight,
        depositWallet: /^0x0+$/.test(wallet) ? null : wallet,
      }));
    },
  };
}
