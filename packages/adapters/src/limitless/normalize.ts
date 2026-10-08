import { bookToQuote } from '@paras/domain';
import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { toDecimalString } from '../decimal.js';
import { LimitlessMarket, type LimitlessBook } from './raw.js';

export const LIMITLESS_ID = 'limitless';
export const LIMITLESS_SITE = 'https://limitless.exchange';

/** Order books and history are keyed by Market slug; Outcome ids are `<slug>:yes` / `<slug>:no`. */
export type Side = 'yes' | 'no';
export const outcomeId = (slug: string, side: Side): string => `${slug}:${side}`;
// CLOB buy taker rate by price (docs.limitless.exchange/user-guide/fees); makers pay 0.
const LIMITLESS_FEE = {
  kind: 'tiered',
  points: [
    ['0.5', '0.03'],
    ['0.55', '0.0252'],
    ['0.6', '0.0213'],
    ['0.65', '0.018'],
    ['0.7', '0.0151'],
    ['0.75', '0.0126'],
    ['0.8', '0.0105'],
    ['0.85', '0.0085'],
    ['0.9', '0.0068'],
    ['0.95', '0.0053'],
    ['0.99', '0.0042'],
    ['0.999', '0.004'],
  ].map(([price, rate]) => ({ price: price!, rate: rate! })),
} as const;

export function parseOutcomeId(id: string): { slug: string; side: Side } | null {
  const i = id.lastIndexOf(':');
  const side = id.slice(i + 1);
  return i > 0 && (side === 'yes' || side === 'no') ? { slug: id.slice(0, i), side } : null;
}

/** Complement of a 0..1 price, rounded to 6 places (Limitless ticks are 0.001 or coarser). */
const complement = (price: number): number => Math.round((1 - price) * 1e6) / 1e6;
const validPrice = (p: number): boolean => Number.isFinite(p) && p > 0 && p < 1;

export function limitlessDeepLink(m: {
  externalId: string;
  meta: Record<string, unknown>;
}): string {
  const slug = typeof m.meta.groupSlug === 'string' ? m.meta.groupSlug : m.externalId;
  return `${LIMITLESS_SITE}/markets/${slug}`;
}

const toIso = (ms: number | null | undefined): string | null => {
  if (!ms) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** USD volume: prefer the formatted field, else scale raw base units by collateral decimals. */
function usdVolume(raw: LimitlessMarket): string {
  if (raw.volumeFormatted != null) return toDecimalString(raw.volumeFormatted);
  const base = Number(raw.volume);
  if (!Number.isFinite(base) || base < 0) return '0';
  return toDecimalString(base / 10 ** (raw.collateralToken?.decimals ?? 6));
}

interface Parent {
  title: string;
  slug: string;
  imageUrl: string | null;
}

/**
 * Limitless Market -> NormalizedMarket. Returns null for non-CLOB (AMM) Markets or rows without
 * outcome tokens: Paras can only quote order books.
 */
export function normalizeLimitlessMarket(
  raw: LimitlessMarket,
  parent?: Parent,
): NormalizedMarket | null {
  if (raw.tradeType && raw.tradeType !== 'clob') return null;
  if (!raw.tokens) return null;

  const status =
    raw.winningOutcomeIndex != null || raw.status === 'RESOLVED'
      ? 'resolved'
      : raw.expired || (raw.status != null && raw.status !== 'FUNDED')
        ? 'closed'
        : 'open';
  const meta: Record<string, unknown> = {
    conditionId: raw.conditionId ?? null,
    exchange: raw.venue?.exchange ?? null,
    tokenIds: raw.tokens,
    minSize: raw.settings?.minSize != null ? String(raw.settings.minSize) : null,
    ...(parent ? { groupSlug: parent.slug } : {}),
  };
  const [category, ...rest] = raw.categories ?? [];

  return {
    venueId: LIMITLESS_ID,
    externalId: raw.slug,
    slug: raw.slug,
    question: parent ? `${parent.title}: ${raw.title}` : raw.title,
    description: raw.description ?? '',
    resolutionSource: null,
    category: category ?? null,
    tags: [...rest, ...(raw.tags ?? [])],
    status,
    endDate: toIso(raw.expirationTimestamp),
    volume: usdVolume(raw),
    // The list endpoint carries no resting liquidity; depth comes from fetchQuotes.
    liquidity: '0',
    imageUrl: raw.imageUrl || raw.logo || parent?.imageUrl || null,
    url: limitlessDeepLink({ externalId: raw.slug, meta }),
    fee: LIMITLESS_FEE,
    outcomes: [
      { externalId: outcomeId(raw.slug, 'yes'), label: 'Yes', index: 0 },
      { externalId: outcomeId(raw.slug, 'no'), label: 'No', index: 1 },
    ],
    meta,
  };
}

/** Flatten a list row: group rows expand to their child Markets, bad rows are skipped. */
export function normalizeLimitlessRow(row: unknown): NormalizedMarket[] {
  const parsed = LimitlessMarket.safeParse(row);
  if (!parsed.success) return [];
  const raw = parsed.data;
  if (raw.marketType !== 'group') {
    const m = normalizeLimitlessMarket(raw);
    return m ? [m] : [];
  }
  const parent: Parent = {
    title: raw.title,
    slug: raw.slug,
    imageUrl: raw.imageUrl || raw.logo || null,
  };
  return (raw.markets ?? []).flatMap((child) => {
    const c = LimitlessMarket.safeParse(child);
    const m = c.success ? normalizeLimitlessMarket(c.data, parent) : null;
    return m ? [m] : [];
  });
}

const shares = (v: string | number): string => toDecimalString(Number(v) / 1e6);

/**
 * Limitless publishes one book per Market, for the YES token (sizes are 6-decimal shares).
 * The NO book is its mirror: NO bids are 1 - YES asks, NO asks are 1 - YES bids.
 */
export function normalizeLimitlessBook(
  slug: string,
  side: Side,
  raw: LimitlessBook,
  now: Date,
): OrderBook {
  const lvl = (price: number, sz: string | number) => ({
    price: toDecimalString(side === 'yes' ? price : complement(price)),
    size: shares(sz),
  });
  const yesBids = raw.bids.filter((l) => validPrice(l.price)).map((l) => lvl(l.price, l.size));
  const yesAsks = raw.asks.filter((l) => validPrice(l.price)).map((l) => lvl(l.price, l.size));
  const last =
    raw.lastTradePrice != null && validPrice(raw.lastTradePrice)
      ? toDecimalString(side === 'yes' ? raw.lastTradePrice : complement(raw.lastTradePrice))
      : null;
  return {
    outcomeExternalId: outcomeId(slug, side),
    bids: side === 'yes' ? yesBids : yesAsks,
    asks: side === 'yes' ? yesAsks : yesBids,
    lastTradePrice: last,
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

export function normalizeLimitlessHistory(
  side: Side,
  prices: { timestamp: string | number; price: number }[],
): PricePoint[] {
  return prices
    .filter((p) => Number.isFinite(Number(p.timestamp)) && p.price >= 0 && p.price <= 1)
    .map((p) => ({
      ts: new Date(Number(p.timestamp)).toISOString(),
      price: toDecimalString(side === 'yes' ? p.price : complement(p.price)),
    }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}
