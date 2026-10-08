import { formatDecimal, mulDecimal, parseDecimal } from './decimal.js';

export interface BookLevel {
  /** Decimal string, 0..1 (USD per share). */
  price: string;
  /** Decimal string, shares. */
  size: string;
}

export interface BookInput {
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
  lastTradePrice?: string | null;
}

export interface BookQuote {
  bid: string | null;
  ask: string | null;
  last: string | null;
  /** Total USD notional resting on the bid side of the book as fetched. */
  bidDepth: string;
  /** Total USD notional resting on the ask side of the book as fetched. */
  askDepth: string;
}

interface Level {
  p: bigint;
  s: bigint;
}

/**
 * Derive a Quote from an order book: best bid/ask and total depth per side.
 * Level order is irrelevant (Venues differ), and zero-size levels are ignored.
 * Throws on a crossed book so bad data never reaches storage.
 */
export function bookToQuote(book: BookInput): BookQuote {
  const parse = (levels: readonly BookLevel[]): Level[] =>
    levels
      .map((l) => ({ p: parseDecimal(l.price), s: parseDecimal(l.size) }))
      .filter((l) => l.s > 0n);
  const bids = parse(book.bids);
  const asks = parse(book.asks);

  const best = (levels: Level[], pick: (a: bigint, b: bigint) => bigint) =>
    levels.length ? levels.map((l) => l.p).reduce(pick) : null;
  const bid = best(bids, (a, b) => (a > b ? a : b));
  const ask = best(asks, (a, b) => (a < b ? a : b));
  if (bid !== null && ask !== null && bid > ask) {
    throw new RangeError(`crossed book: bid=${formatDecimal(bid)} ask=${formatDecimal(ask)}`);
  }

  const depth = (levels: Level[]) =>
    formatDecimal(levels.reduce((sum, l) => sum + mulDecimal(l.p, l.s), 0n));
  return {
    bid: bid === null ? null : formatDecimal(bid),
    ask: ask === null ? null : formatDecimal(ask),
    last: book.lastTradePrice ? formatDecimal(parseDecimal(book.lastTradePrice)) : null,
    bidDepth: depth(bids),
    askDepth: depth(asks),
  };
}

/** True when a Quote observed at `observedAt` is older than `maxAgeMs` at `now`. */
export function isStale(observedAt: Date, now: Date, maxAgeMs: number): boolean {
  return now.getTime() - observedAt.getTime() > maxAgeMs;
}
