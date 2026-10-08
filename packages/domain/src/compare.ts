import type { BookLevel } from './book.js';
import { divDecimal, formatDecimal, mulDecimal, parseDecimal, type Scaled } from './decimal.js';

const ONE = parseDecimal('1');

/** Structural twin of the shared FeeSchedule, so domain stays free of app deps. */
export type FeeModel =
  | { kind: 'none' }
  | { kind: 'curve'; rate: string; exponent: number; takerOnly: boolean }
  | { kind: 'profit'; rate: string }
  | { kind: 'tiered'; points: readonly { price: string; rate: string }[] };

/**
 * Fee per share (USD) a taker pays at `price`. Curve: rate * (p * (1 - p)) ^ exponent
 * (Polymarket's schedule; Kalshi's 0.07 quadratic fee is exponent 1). Orders here always cross
 * the book, so they are takers and `takerOnly` never zeroes the fee.
 */
export function feePerShare(fee: FeeModel, price: Scaled): Scaled {
  if (fee.kind === 'none' || price >= ONE) return 0n;
  // Charged on profit if the share wins (1 - p); priced as if it wins, the conservative case.
  if (fee.kind === 'profit') return mulDecimal(parseDecimal(fee.rate), ONE - price);
  if (fee.kind === 'tiered') return mulDecimal(price, tieredRate(fee.points, price));
  const base = mulDecimal(price, ONE - price);
  let pow: Scaled;
  if (Number.isInteger(fee.exponent) && fee.exponent >= 1) {
    pow = base;
    for (let i = 1; i < fee.exponent; i++) pow = mulDecimal(pow, base);
  } else {
    // shortcut: float pow for fractional exponents, 1e-9 precision; no Venue uses one today.
    pow = BigInt(Math.round(Math.pow(Number(base) / 1e9, fee.exponent) * 1e9));
  }
  return mulDecimal(parseDecimal(fee.rate), pow);
}

/** Rate at `price`: linear between points (ascending by price), clamped to the end rates. */
function tieredRate(points: readonly { price: string; rate: string }[], price: Scaled): Scaled {
  const pts = points.map((q) => ({ p: parseDecimal(q.price), r: parseDecimal(q.rate) }));
  const first = pts[0]!;
  if (price <= first.p) return first.r;
  for (let i = 1; i < pts.length; i++) {
    const lo = pts[i - 1]!;
    const hi = pts[i]!;
    if (price <= hi.p) return lo.r + mulDecimal(divDecimal(price - lo.p, hi.p - lo.p), hi.r - lo.r);
  }
  return pts[pts.length - 1]!.r;
}

export interface Fill {
  shares: string;
  /** Average price before fees. */
  avgPrice: string;
  fees: string;
  /** Price paid plus fees. */
  spent: string;
  /** spent / shares: what one share really costs. */
  effectivePrice: string;
  /** Part of the stake the book could not absorb. */
  unspent: string;
}

/**
 * Walk the asks cheapest-first spending up to `stake` USD (fees included) and report what that
 * buys. Returns null when nothing can be bought.
 */
export function walkAsks(asks: readonly BookLevel[], fee: FeeModel, stake: string): Fill | null {
  const total = parseDecimal(stake);
  let budget = total;
  let shares = 0n;
  let cost = 0n;
  let fees = 0n;
  const levels = asks
    .map((l) => ({ p: parseDecimal(l.price), s: parseDecimal(l.size) }))
    .filter((l) => l.s > 0n)
    .sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  for (const { p, s } of levels) {
    const f = feePerShare(fee, p);
    const unit = p + f;
    if (unit === 0n) continue;
    const affordable = divDecimal(budget, unit);
    const take = s < affordable ? s : affordable;
    if (take === 0n) break;
    shares += take;
    cost += mulDecimal(take, p);
    fees += mulDecimal(take, f);
    budget -= mulDecimal(take, unit);
    if (budget <= 0n) break;
  }
  if (shares === 0n) return null;
  const spent = cost + fees;
  return {
    shares: formatDecimal(shares),
    avgPrice: formatDecimal(divDecimal(cost, shares)),
    fees: formatDecimal(fees),
    spent: formatDecimal(spent),
    effectivePrice: formatDecimal(divDecimal(spent, shares)),
    unspent: formatDecimal(total > spent ? total - spent : 0n),
  };
}

export interface PricedQuote {
  feePerShare: string | null;
  /** Best ask plus its taker fee: the top-of-book cost of one share. */
  effectiveAsk: string | null;
  /** Mid of best bid/ask; falls back to the ask. Basis for divergence. */
  mid: string | null;
  fill: Fill | null;
}

export interface QuoteInput {
  bid: string | null;
  ask: string | null;
  fee: FeeModel;
  /** Full ask ladder; needed for `stake` fills. */
  asks?: readonly BookLevel[];
}

export function priceQuote({ bid, ask, fee, asks }: QuoteInput, stake?: string): PricedQuote {
  const a = ask === null ? null : parseDecimal(ask);
  const f = a === null ? null : feePerShare(fee, a);
  const mid = a === null ? null : bid === null ? a : (parseDecimal(bid) + a) / 2n;
  return {
    feePerShare: f === null ? null : formatDecimal(f),
    effectiveAsk: a === null || f === null ? null : formatDecimal(a + f),
    mid: mid === null ? null : formatDecimal(mid),
    fill: stake && asks ? walkAsks(asks, fee, stake) : null,
  };
}

export interface Candidate {
  eligible: boolean;
  priced: PricedQuote;
}

/**
 * Index of the best Venue to buy from: with a stake, the one that buys the most shares for it
 * (partial fills lose naturally); otherwise the lowest fee-adjusted ask. Ties go to the lower index.
 */
export function pickBest(candidates: readonly Candidate[], stake?: string): number | null {
  let best: number | null = null;
  let bestKey: Scaled = 0n;
  candidates.forEach(({ eligible, priced }, i) => {
    if (!eligible) return;
    let key: Scaled;
    if (stake) {
      if (!priced.fill) return;
      key = parseDecimal(priced.fill.shares);
    } else {
      if (!priced.effectiveAsk) return;
      key = -parseDecimal(priced.effectiveAsk);
    }
    if (best === null || key > bestKey) {
      best = i;
      bestKey = key;
    }
  });
  return best;
}

/** max(mid) - min(mid) across Venues, or null with fewer than two. Flags when it reaches `threshold`. */
export function midSpread(
  mids: readonly string[],
  threshold: string,
): { spread: string | null; divergent: boolean } {
  if (mids.length < 2) return { spread: null, divergent: false };
  const v = mids.map(parseDecimal);
  const spread = v.reduce((a, b) => (a > b ? a : b)) - v.reduce((a, b) => (a < b ? a : b));
  return { spread: formatDecimal(spread), divergent: spread >= parseDecimal(threshold) };
}

/**
 * Align a price series onto a shared time grid, carrying the last known price forward.
 * Grid points before the first observation are null. Both inputs ascending by time (ms).
 */
export function alignSeries(
  points: readonly { ts: number; price: string }[],
  grid: readonly number[],
): (string | null)[] {
  let i = 0;
  let last: string | null = null;
  return grid.map((t) => {
    while (i < points.length && points[i]!.ts <= t) last = points[i++]!.price;
    return last;
  });
}
