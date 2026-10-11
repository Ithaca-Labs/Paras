import { createPublicClient, http, parseAbi, parseUnits, formatUnits } from 'viem';
import { monadTestnet } from 'viem/chains';

/** Monad testnet (demo). Vault + USDC addresses come from GET /v1/config, never hardcoded. */
export const chain = monadTestnet;
export const publicClient = createPublicClient({ chain, transport: http() });

export const vaultAbi = parseAbi([
  'function deposit(uint256 amount)',
  'function withdraw(uint256 amount)',
  'function submitIntent((address user, bytes32 id, uint256 amount, uint64 expiry, bytes32 detailsHash) i, bytes sig)',
  'function cancelIntent(bytes32 id)',
]);
export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);

/** USDC has 6 decimals. */
export const toUsdc = (v: string) => parseUnits(v, 6);
export const fromUsdc = (v: bigint) => formatUnits(v, 6);

export const txUrl = (hash: string) => `${chain.blockExplorers.default.url}/tx/${hash}`;

/** Positive decimal with at most 6 places. */
export const validAmount = (v: string) => /^\d+(\.\d{1,6})?$/.test(v) && Number(v) > 0;
