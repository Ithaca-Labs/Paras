import { bookToQuote, formatDecimal, parseDecimal } from '@paras/domain';
import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { toDecimalString } from '../decimal.js';
import type { KalshiCandle, KalshiEvent, KalshiMarket } from './raw.js';

export const KALSHI_ID = 'kalshi';
export const KALSHI_SITE = 'https://kalshi.com';

/** Kalshi quadratic taker fee: 0.07 * p * (1 - p) per contract. */
const KALSHI_FEE = { kind: 'curve', rate: '0.07', exponent: 1, takerOnly: true } as const;

type Side = 'yes' | 'no';
type Levels = [string, string][];

/** Outcome ids are `<market ticker>:yes|no`; Kalshi tickers never contain a colon. */
export const outcomeId = (ticker: string, side: Side) => `${ticker}:${side}`;

export function parseOutcomeId(id: string): { ticker: string; side: Side } | null {
  const i = id.lastIndexOf(':');
  const side = id.slice(i + 1);
  return i > 0 && (side === 'yes' || side === 'no') ? { ticker: id.slice(0, i), side } : null;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Kalshi site URL: /markets/<series>/<title-slug>/<event>, all lowercase. The slug is cosmetic. */
export function kalshiDeepLink(m: { externalId: string; meta: Record<string, unknown> }): string {
  const str = (v: unknown) => (typeof v === 'string' && v ? v.toLowerCase() : null);
  const event = str(m.meta.eventTicker);
  const series = str(m.meta.seriesTicker);
  const slug = str(m.meta.urlSlug);
  if (series && event) return `${KALSHI_SITE}/markets/${series}/${slug ?? series}/${event}`;
  return `${KALSHI_SITE}/markets/${(event ?? m.externalId).toLowerCase()}`;
}

const toIso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const STATUS: Record<string, NormalizedMarket['status']> = {
  active: 'open',
  initialized: 'closed',
  inactive: 'closed',
  closed: 'closed',
  disputed: 'closed',
  determined: 'resolved',
  amended: 'resolved',
  finalized: 'resolved',
};

/**
 * Kalshi event + market -> NormalizedMarket. Returns null for anything Paras cannot quote as a
 * binary YES/NO Market (scalar markets, unknown status, no title).
 */
export function normalizeKalshiMarket(
  event: KalshiEvent,
  raw: KalshiMarket,
): NormalizedMarket | null {
  if (raw.market_type && raw.market_type !== 'binary') return null;
  const status = STATUS[raw.status ?? ''];
  const eventTitle = event.title ?? '';
  const sub = raw.yes_sub_title || raw.title || '';
  const multi = (event.markets?.length ?? 1) > 1;
  const question = multi && eventTitle && sub ? `${eventTitle}: ${sub}` : raw.title || eventTitle;
  if (!status || !question) return null;

  const meta: Record<string, unknown> = {
    ticker: raw.ticker,
    eventTicker: raw.event_ticker,
    seriesTicker: event.series_ticker ?? null,
    urlSlug: slugify(eventTitle),
    priceLevelStructure: raw.price_level_structure ?? null,
  };
  // Top-of-book resting USD on the YES side; full depth comes from the order book.
  const topUsd =
    Number(raw.yes_bid_dollars ?? 0) * Number(raw.yes_bid_size_fp ?? 0) +
    Number(raw.yes_ask_dollars ?? 0) * Number(raw.yes_ask_size_fp ?? 0);

  return {
    venueId: KALSHI_ID,
    externalId: raw.ticker,
    slug: raw.ticker.toLowerCase(),
    question,
    description: [raw.rules_primary, raw.rules_secondary].filter(Boolean).join('\n\n'),
    resolutionSource: event.settlement_sources?.[0]?.name || null,
    category: event.category || null,
    tags: [],
    status,
    endDate: toIso(raw.close_time),
    // Kalshi reports volume in contracts (US$1 notional each); its site shows it as dollars.
    volume: toDecimalString(raw.volume_fp),
    liquidity: toDecimalString(topUsd),
    imageUrl: null,
    url: kalshiDeepLink({ externalId: raw.ticker, meta }),
    fee: KALSHI_FEE,
    outcomes: [
      { externalId: outcomeId(raw.ticker, 'yes'), label: 'Yes', index: 0 },
      { externalId: outcomeId(raw.ticker, 'no'), label: 'No', index: 1 },
    ],
    meta,
  };
}

/** 1 - price, exact. Clamps bad (>1) input to 0. */
const complement = (price: string) => {
  const p = parseDecimal(toDecimalString(price));
  const one = parseDecimal('1');
  return formatDecimal(p > one ? 0n : one - p);
};

/**
 * Kalshi book (resting bids for YES and for NO) -> YES and NO OrderBooks.
 * A NO bid at p is a YES ask at 1 - p, and vice versa.
 */
export function normalizeKalshiBook(
  ticker: string,
  raw: { yes: Levels; no: Levels },
  observedAt: string,
): OrderBook[] {
  const bids = (ls: Levels) =>
    ls.map(([price, size]) => ({ price: toDecimalString(price), size: toDecimalString(size) }));
  const asks = (ls: Levels) =>
    ls.map(([price, size]) => ({ price: complement(price), size: toDecimalString(size) }));
  return [
    {
      outcomeExternalId: outcomeId(ticker, 'yes'),
      bids: bids(raw.yes),
      asks: asks(raw.no),
      lastTradePrice: null,
      observedAt,
    },
    {
      outcomeExternalId: outcomeId(ticker, 'no'),
      bids: bids(raw.no),
      asks: asks(raw.yes),
      lastTradePrice: null,
      observedAt,
    },
  ];
}

export function orderBookToQuote(book: OrderBook): Quote {
  return {
    outcomeExternalId: book.outcomeExternalId,
    ...bookToQuote(book),
    observedAt: book.observedAt,
  };
}

/** Candlesticks (YES prices) -> points for `side`. Periods with no price data are skipped. */
export function normalizeCandles(candles: readonly KalshiCandle[], side: Side): PricePoint[] {
  const points: PricePoint[] = [];
  for (const c of candles) {
    const yes = Number(c.price?.close_dollars || c.price?.previous_dollars);
    if (!Number.isFinite(yes)) continue;
    const yesPrice = toDecimalString(Math.min(Math.max(yes, 0), 1));
    points.push({
      ts: new Date(c.end_period_ts * 1000).toISOString(),
      price: side === 'yes' ? yesPrice : complement(yesPrice),
    });
  }
  return points.sort((a, b) => a.ts.localeCompare(b.ts));
}
