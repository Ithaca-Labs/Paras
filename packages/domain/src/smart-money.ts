/** Smart-money signal for one Polymarket Market, from Nansen holder + trade data. Pure. */

export interface HolderRow {
  side: string; // "Yes" | "No"
  position_size: number;
  current_price: number;
  unrealized_pnl_usd: number;
}
export interface TradeRow {
  taker_action: string; // "buy" | "sell"
  side: string;
  usdc_value: number;
}

export interface SmartMoneySignal {
  /** -1 (all NO) .. +1 (all YES). */
  lean: number;
  /** |lean|, 0..1. */
  strength: number;
  /** Share of smart-holder value on YES, or null when no smart holders. */
  yesShare: number | null;
  smartHolders: number;
  /** Net USD recently moved toward YES (negative = toward NO). */
  flowUsd: number;
  /** Smart-money token net flow (24h USD) for crypto-price Markets, else null. */
  netflow24hUsd: number | null;
}

/** Below this strength the signal reads as neutral. */
export const SMART_MONEY_MIN = 0.2;
/** Strength that warrants an alert. */
export const SMART_MONEY_ALERT = 0.5;
const FLOW_SCALE_USD = 10_000;
const isYes = (s: string) => s.toLowerCase() === 'yes';

/**
 * Smart holders = profitable ones (unrealized PnL > 0); labelled-address data would sharpen this
 * but costs more credits. lean = 60% holder skew + 25% recent trade flow + 15% token netflow.
 * `netflowYesSign` says which way a rising token netflow points for the question (+1 / -1 / 0).
 */
export function computeSmartMoney(input: {
  holders: readonly HolderRow[];
  trades: readonly TradeRow[];
  netflow24hUsd?: number | null;
  netflowYesSign?: number;
}): SmartMoneySignal {
  let yes = 0;
  let no = 0;
  let smartHolders = 0;
  for (const h of input.holders) {
    if (h.unrealized_pnl_usd <= 0) continue;
    smartHolders++;
    const v = h.position_size * h.current_price;
    if (isYes(h.side)) yes += v;
    else no += v;
  }
  const yesShare = yes + no > 0 ? yes / (yes + no) : null;
  const holderLean = yesShare === null ? 0 : 2 * yesShare - 1;

  const flowUsd = input.trades.reduce(
    (sum, t) =>
      sum +
      (t.taker_action.toLowerCase() === 'buy' ? 1 : -1) * (isYes(t.side) ? 1 : -1) * t.usdc_value,
    0,
  );
  const netflow = input.netflow24hUsd ?? null;
  const netflowLean = netflow === null ? 0 : Math.tanh(netflow / 1e6) * (input.netflowYesSign ?? 0);

  const lean = Math.max(
    -1,
    Math.min(1, 0.6 * holderLean + 0.25 * Math.tanh(flowUsd / FLOW_SCALE_USD) + 0.15 * netflowLean),
  );
  return {
    lean,
    strength: Math.abs(lean),
    yesShare,
    smartHolders,
    flowUsd,
    netflow24hUsd: netflow,
  };
}

export type SmartMoneyLeaning = 'YES' | 'NO' | 'neutral';
export const smartMoneyLeaning = (
  s: Pick<SmartMoneySignal, 'lean' | 'strength'>,
): SmartMoneyLeaning => (s.strength < SMART_MONEY_MIN ? 'neutral' : s.lean > 0 ? 'YES' : 'NO');

export const smartMoneyReason = (s: Pick<SmartMoneySignal, 'lean' | 'strength'>) => {
  const l = smartMoneyLeaning(s);
  return l === 'neutral' ? 'Smart money is undecided' : `Smart money is leaning ${l}`;
};

/** Crypto symbol a price question is about (BTC, ETH, MON), or null. */
export function cryptoSymbol(question: string): 'BTC' | 'ETH' | 'MON' | null {
  if (/\b(bitcoin|btc)\b/i.test(question)) return 'BTC';
  if (/\b(ethereum|eth)\b/i.test(question)) return 'ETH';
  if (/\b(monad|mon)\b/i.test(question)) return 'MON';
  return null;
}

/** +1 when YES means price goes up ("above", "reach"), -1 for down ("below", "dip"), else 0. */
export function priceDirection(question: string): number {
  if (/\b(below|under|dip|drop|fall|crash)\b/i.test(question)) return -1;
  if (/\b(above|over|reach|hit|exceed|higher|rise)\b/i.test(question)) return 1;
  return 0;
}

/** Plain-language "why is this moving" for the Event API / MCP. */
export function explainMarket(e: {
  title: string;
  move24h: number;
  signal: SmartMoneySignal | null;
}): string {
  const parts = [
    e.move24h >= 0.01
      ? `"${e.title}" moved ${Math.round(e.move24h * 100)} points in 24h.`
      : `"${e.title}" has been steady over 24h.`,
  ];
  const s = e.signal;
  if (!s) parts.push('No smart-money data for this Event yet.');
  else {
    parts.push(`${smartMoneyReason(s)} (strength ${Math.round(s.strength * 100)}%).`);
    if (s.yesShare !== null)
      parts.push(
        `${Math.round(s.yesShare * 100)}% of profitable-holder value is on YES across ${s.smartHolders} profitable holders.`,
      );
    if (Math.abs(s.flowUsd) >= 1)
      parts.push(
        `Recent trades net $${Math.round(Math.abs(s.flowUsd))} toward ${s.flowUsd > 0 ? 'YES' : 'NO'}.`,
      );
    if (s.netflow24hUsd !== null)
      parts.push(`Smart-money token netflow 24h: $${Math.round(s.netflow24hUsd)}.`);
  }
  return parts.join(' ');
}
