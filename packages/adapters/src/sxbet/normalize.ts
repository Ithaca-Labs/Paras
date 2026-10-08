import { bookToQuote } from '@paras/domain';
import type { BookLevel, NormalizedMarket, OrderBook, Quote } from '@paras/shared';
import { SxMarket, type SxSnapshot } from './raw.js';

export const SXBET_ID = 'sxbet';
export const SXBET_SITE = 'https://sx.bet';

/** Outcome ids are `<marketHash>:1` and `<marketHash>:2` (outcome one / two). */
export type OutcomeNo = 1 | 2;
export const outcomeId = (hash: string, no: OutcomeNo): string => `${hash}:${no}`;
export function parseOutcomeId(id: string): { hash: string; no: OutcomeNo } | null {
  const i = id.lastIndexOf(':');
  const no = id.slice(i + 1);
  return i > 0 && (no === '1' || no === '2')
    ? { hash: id.slice(0, i), no: Number(no) as OutcomeNo }
    : null;
}

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Site URL for a Market. sx.bet is a single-page app with no documented per-market URL, so link to
 * the league page (verified to resolve) and fall back to the home page.
 */
export function sxbetDeepLink(m: { externalId: string; meta: Record<string, unknown> }): string {
  const { sport, league } = m.meta as { sport?: unknown; league?: unknown };
  return typeof sport === 'string' && typeof league === 'string' && sport && league
    ? `${SXBET_SITE}/${slugify(sport)}/${slugify(league)}`
    : SXBET_SITE;
}

/** SX Markets have no title: compose one from the fixture and the two sides. */
function question(raw: SxMarket): string {
  const { teamOneName: t1, teamTwoName: t2, outcomeOneName: o1, outcomeTwoName: o2 } = raw;
  const sides = `${o1} vs ${o2}`;
  if (!t1 || !t2) return sides;
  const moneyline = new Set([t1, t2]).has(o1) && new Set([t1, t2]).has(o2);
  return moneyline ? `${t1} vs ${t2}` : `${t1} vs ${t2}: ${sides}`;
}

/** SX /markets/active row -> NormalizedMarket. Null when the row is malformed or not CLOB-tradable. */
export function normalizeSxMarket(row: unknown): NormalizedMarket | null {
  const parsed = SxMarket.safeParse(row);
  if (!parsed.success) return null;
  const raw = parsed.data;
  if (raw.tradingModes && !raw.tradingModes.includes('CLOB')) return null;

  const gameTime = raw.gameTime ? new Date(raw.gameTime * 1000) : null;
  const meta: Record<string, unknown> = {
    marketHash: raw.marketHash,
    sport: raw.sportLabel ?? null,
    league: raw.leagueLabel ?? null,
    leagueId: raw.leagueId ?? null,
    eventId: raw.sportXeventId ?? null,
    marketType: raw.type ?? null,
    line: raw.line ?? null,
    mainLine: raw.mainLine ?? null,
    teams: [raw.teamOneName ?? null, raw.teamTwoName ?? null],
  };
  return {
    venueId: SXBET_ID,
    externalId: raw.marketHash,
    slug: null,
    question: question(raw),
    description: raw.outcomeVoidName ? `Bets are voided on: ${raw.outcomeVoidName}.` : '',
    resolutionSource: null,
    category: raw.sportLabel ?? null,
    tags: [raw.sportLabel, raw.leagueLabel].filter((t): t is string => !!t),
    status: raw.status === 'ACTIVE' ? 'open' : 'closed',
    endDate: gameTime && !Number.isNaN(gameTime.getTime()) ? gameTime.toISOString() : null,
    // /markets/active exposes neither volume nor liquidity; depth comes from fetchQuotes.
    volume: '0',
    liquidity: '0',
    imageUrl: null,
    url: sxbetDeepLink({ externalId: raw.marketHash, meta }),
    // 1% taker fee on net profit (docs.sx.bet/user-guides/trading/fees); makers pay 0.
    fee: { kind: 'profit', rate: '0.01' },
    outcomes: [
      { externalId: outcomeId(raw.marketHash, 1), label: raw.outcomeOneName, index: 0 },
      { externalId: outcomeId(raw.marketHash, 2), label: raw.outcomeTwoName, index: 1 },
    ],
    meta,
  };
}

const ODDS = 10n ** 20n;
/** Price precision kept from the 1e20-scaled odds. */
const PRICE_SCALE = 10n ** 9n;

/** Bigint `value / 10^decimals` as a trimmed plain decimal string. */
function fromScaled(value: bigint, decimals: number): string {
  const div = 10n ** BigInt(decimals);
  const whole = value / div;
  const frac = (value % div).toString().padStart(decimals, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * One resting maker level -> a book level for the outcome the *taker* buys.
 * A maker staking `size` at implied probability `p` for outcome A offers the opposite outcome B
 * at price 1-p. Shares are stake / p (each share pays $1; the maker paid p, the taker pays 1-p).
 */
function takerLevel(l: { percentageOdds: string; size: string }): BookLevel | null {
  let odds: bigint;
  let stake: bigint;
  try {
    odds = BigInt(l.percentageOdds);
    stake = BigInt(l.size);
  } catch {
    return null;
  }
  if (odds <= 0n || odds >= ODDS || stake <= 0n) return null;
  const shares = (stake * ODDS) / odds; // micro-shares
  return {
    price: fromScaled(((ODDS - odds) * PRICE_SCALE) / ODDS, 9),
    size: fromScaled(shares, 6),
  };
}

/** Maker level for the outcome the maker bets (a bid for that outcome): price p, shares stake / p. */
function makerLevel(l: { percentageOdds: string; size: string }): BookLevel | null {
  let odds: bigint;
  let stake: bigint;
  try {
    odds = BigInt(l.percentageOdds);
    stake = BigInt(l.size);
  } catch {
    return null;
  }
  if (odds <= 0n || odds >= ODDS || stake <= 0n) return null;
  return {
    price: fromScaled((odds * PRICE_SCALE) / ODDS, 9),
    size: fromScaled((stake * ODDS) / odds, 6),
  };
}

const compact = (levels: (BookLevel | null)[]): BookLevel[] =>
  levels.filter((l): l is BookLevel => l !== null);

/**
 * SX snapshot -> book for one outcome. Makers resting on outcome N are bids for N; makers resting
 * on the other outcome offer N to takers (asks at 1-p).
 */
export function normalizeSxBook(
  hash: string,
  no: OutcomeNo,
  snap: SxSnapshot['data'],
  now: Date,
): OrderBook {
  const own = no === 1 ? snap.outcomeOne : snap.outcomeTwo;
  const other = no === 1 ? snap.outcomeTwo : snap.outcomeOne;
  return {
    outcomeExternalId: outcomeId(hash, no),
    bids: compact(own.map(makerLevel)),
    asks: compact(other.map(takerLevel)),
    // The snapshot carries no last trade.
    lastTradePrice: null,
    observedAt: now.toISOString(),
  };
}

export function orderBookToQuote(book: OrderBook): Quote {
  return {
    outcomeExternalId: book.outcomeExternalId,
    ...bookToQuote(book),
    observedAt: book.observedAt,
  };
}
