import { bookToQuote } from '@paras/domain';
import type { OrderBook, Quote } from '@paras/shared';
import { complement, validPrice } from './http.js';
import { toDecimalString } from './decimal.js';

export interface RawLevel {
  price: number;
  /** Shares. */
  size: number;
}

const toLevels = (levels: readonly RawLevel[]) =>
  levels
    .filter((l) => validPrice(l.price) && Number.isFinite(l.size) && l.size > 0)
    .map((l) => ({ price: toDecimalString(l.price), size: toDecimalString(l.size) }));

/** Book for an Outcome from raw levels (already in that Outcome's own terms). */
export function makeBook(
  outcomeExternalId: string,
  bids: readonly RawLevel[],
  asks: readonly RawLevel[],
  last: number | null,
  observedAt: Date,
): OrderBook {
  return {
    outcomeExternalId,
    bids: toLevels(bids),
    asks: toLevels(asks),
    lastTradePrice: last != null && validPrice(last) ? toDecimalString(last) : null,
    observedAt: observedAt.toISOString(),
  };
}

/**
 * Binary Markets publishing one book (the YES side): the NO book is its mirror. NO bids are
 * 1 - YES asks, NO asks are 1 - YES bids.
 */
export function mirrorBook(
  outcomeExternalId: string,
  side: 'yes' | 'no',
  yesBids: readonly RawLevel[],
  yesAsks: readonly RawLevel[],
  yesLast: number | null,
  observedAt: Date,
): OrderBook {
  if (side === 'yes') return makeBook(outcomeExternalId, yesBids, yesAsks, yesLast, observedAt);
  const flip = (ls: readonly RawLevel[]) => ls.map((l) => ({ ...l, price: complement(l.price) }));
  return makeBook(
    outcomeExternalId,
    flip(yesAsks),
    flip(yesBids),
    yesLast != null ? complement(yesLast) : null,
    observedAt,
  );
}

export function orderBookToQuote(book: OrderBook): Quote {
  return {
    outcomeExternalId: book.outcomeExternalId,
    ...bookToQuote(book),
    observedAt: book.observedAt,
  };
}
