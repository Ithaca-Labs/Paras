import { DECIMAL_SCALE, parseDecimal } from './decimal.js';

/** Exit/redemption state machine: requested -> (ordering | redeeming) -> returning -> done, or failed. */
export const EXIT_STATUSES = [
  'requested',
  'ordering',
  'redeeming',
  'returning',
  'done',
  'failed',
] as const;
export type ExitStatus = (typeof EXIT_STATUSES)[number];
export const TERMINAL_EXIT_STATUSES: readonly ExitStatus[] = ['done', 'failed'];

/** Shares (CTF) and USDC/pUSD all have 6 decimals, so one base-unit scale serves both. */
const UNIT = 6;

/** Decimal string -> 6-decimal base units, truncating extra digits (never rounds up past a real balance). */
export function toBase6(value: string): bigint {
  const [w = '0', f = ''] = value.split('.');
  return BigInt(w || '0') * 10n ** BigInt(UNIT) + BigInt(f.slice(0, UNIT).padEnd(UNIT, '0') || '0');
}

export type ResolutionState = 'open' | 'closed' | 'proposed' | 'disputed' | 'resolved';

/** A resolution that is still pending this long after the Market ended counts as delayed. */
export const RESOLUTION_DELAY_MS = 24 * 3_600_000;

/** Where a Market is in resolution, from Venue status plus the UMA status Polymarket reports (meta). */
export function resolutionState(
  m: { status: 'open' | 'closed' | 'resolved'; endDate: Date | null; umaStatus?: string | null },
  now: Date,
): { state: ResolutionState; delayed: boolean } {
  if (m.status === 'open') return { state: 'open', delayed: false };
  if (m.status === 'resolved') return { state: 'resolved', delayed: false };
  const state =
    m.umaStatus === 'disputed' ? 'disputed' : m.umaStatus === 'proposed' ? 'proposed' : 'closed';
  const late = m.endDate && now.getTime() - m.endDate.getTime() > RESOLUTION_DELAY_MS;
  return { state, delayed: state === 'disputed' || Boolean(late) };
}

export interface PositionMath {
  /** Shares still held (base units). */
  shares: bigint;
  /** Shares originally bought. */
  sharesBought: bigint;
  /** USDC spent on the original fill (base units). */
  cost: bigint;
  /** USDC received from exits and redemptions so far (base units). */
  proceeds: bigint;
  /** Exit price per share (best bid), decimal; null = unpriced. */
  price: string | null;
}

/** Value and P&L in base units. Unpriced positions are carried at cost (no unrealized P&L). */
export function valuePosition(p: PositionMath) {
  const costBasis = p.sharesBought === 0n ? 0n : (p.cost * p.shares) / p.sharesBought;
  const value =
    p.price === null
      ? costBasis
      : (p.shares * parseDecimal(p.price)) / 10n ** BigInt(DECIMAL_SCALE);
  const realized = p.proceeds - (p.cost - costBasis);
  return { costBasis, value, unrealized: value - costBasis, realized };
}

/** Redemption payout for `shares` of an outcome: shares * numerator / denominator. */
export const redeemPayout = (shares: bigint, numerator: bigint, denominator: bigint): bigint =>
  denominator === 0n ? 0n : (shares * numerator) / denominator;

export type TxChain = 'monad' | 'polygon';
const EXPLORER: Record<TxChain, string> = {
  monad: 'https://monadscan.com/tx/',
  polygon: 'https://polygonscan.com/tx/',
};
export const txUrl = (chain: TxChain, hash: string): string => `${EXPLORER[chain]}${hash}`;
