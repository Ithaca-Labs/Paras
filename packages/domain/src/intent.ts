import { createHash } from 'node:crypto';

/**
 * Intent state machine (PRD > Data model). `previewed` precedes the PRD's `signed`.
 * `returning` is the shared refund/return leg: funds go back to the Vault, then the Intent takes `ctx.then`.
 */
export const INTENT_STATUSES = [
  'previewed',
  'signed',
  'dispatched',
  'bridging',
  'bridged',
  'ordering',
  'returning',
  'filled',
  'partially_filled',
  'failed',
  'expired',
  'cancelled',
] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

export const TERMINAL_INTENT_STATUSES: readonly IntentStatus[] = [
  'filled',
  'partially_filled',
  'failed',
  'expired',
  'cancelled',
];

/** What the User commits to off-chain; the Vault only stores `intentDetailsHash(details)`. */
export interface IntentDetails {
  eventId: string;
  marketId: string;
  outcomeId: string;
  venueId: string;
  /** Venue-native Outcome id (Polymarket: CLOB token id). */
  tokenId: string;
  /** Worst price per share (before fees), decimal 0..1. */
  maxPrice: string;
  /** Unfilled remainder: `rest` leaves a GTC order until expiry, `return` sends it back at once. */
  remainder: 'rest' | 'return';
}

export function intentDetailsHash(d: IntentDetails): `0x${string}` {
  // Fixed key order so the hash never depends on object construction order.
  const canonical = JSON.stringify([
    d.eventId,
    d.marketId,
    d.outcomeId,
    d.venueId,
    d.tokenId,
    d.maxPrice,
    d.remainder,
  ]);
  return `0x${createHash('sha256').update(canonical).digest('hex')}`;
}

interface Domain {
  vault: string;
  chainId: number;
}

const domain = (d: Domain) => ({
  name: 'ParasVault',
  version: '1',
  chainId: d.chainId,
  verifyingContract: d.vault as `0x${string}`,
});

/** EIP-712 payload for `Vault.submitIntent` (viem `signTypedData` shape; amounts are bigints). */
export function intentTypedData(
  p: Domain & {
    user: string;
    id: string;
    amount: bigint;
    expiry: bigint;
    detailsHash: string;
  },
) {
  return {
    domain: domain(p),
    types: {
      Intent: [
        { name: 'user', type: 'address' },
        { name: 'id', type: 'bytes32' },
        { name: 'amount', type: 'uint256' },
        { name: 'expiry', type: 'uint64' },
        { name: 'detailsHash', type: 'bytes32' },
      ],
    },
    primaryType: 'Intent' as const,
    message: {
      user: p.user as `0x${string}`,
      id: p.id as `0x${string}`,
      amount: p.amount,
      expiry: p.expiry,
      detailsHash: p.detailsHash as `0x${string}`,
    },
  };
}

/** EIP-712 payload for `Vault.registerDepositWallet`: the User names the one wallet that may receive their funds. */
export function registerTypedData(p: Domain & { user: string; wallet: string }) {
  return {
    domain: domain(p),
    types: {
      RegisterDepositWallet: [
        { name: 'user', type: 'address' },
        { name: 'wallet', type: 'address' },
      ],
    },
    primaryType: 'RegisterDepositWallet' as const,
    message: { user: p.user as `0x${string}`, wallet: p.wallet as `0x${string}` },
  };
}

/** Exits are verified by the API, not on-chain, so the domain names no contract. */
export const EXIT_MAX_TTL_S = 600;

/** EIP-712 payload the User signs to sell a position (#82). `shares` in base units, `deadline` unix seconds. */
export function exitTypedData(p: {
  user: string;
  positionId: string;
  shares: bigint;
  minPrice: string;
  returnTo: 'vault' | 'polygon';
  deadline: bigint;
}) {
  return {
    domain: { name: 'Paras', version: '1' },
    types: {
      Exit: [
        { name: 'user', type: 'address' },
        { name: 'positionId', type: 'string' },
        { name: 'shares', type: 'uint256' },
        { name: 'minPrice', type: 'string' },
        { name: 'returnTo', type: 'string' },
        { name: 'deadline', type: 'uint64' },
      ],
    },
    primaryType: 'Exit' as const,
    message: { ...p, user: p.user as `0x${string}` },
  };
}
