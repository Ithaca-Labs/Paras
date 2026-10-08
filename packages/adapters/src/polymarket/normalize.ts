import { bookToQuote } from '@paras/domain';
import type { NormalizedMarket, OrderBook, PricePoint, Quote } from '@paras/shared';
import { toDecimalString } from '../decimal.js';
import type { ClobBook, GammaMarket } from './raw.js';

export const POLYMARKET_ID = 'polymarket';
export const POLYMARKET_SITE = 'https://polymarket.com';

const parseJsonArray = (raw: string | null | undefined): string[] | null => {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null;
  } catch {
    return null;
  }
};

const toIso = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Polymarket site URL: /event/<event-slug>[/<market-slug>]. */
export function polymarketDeepLink(m: {
  slug: string | null;
  meta: Record<string, unknown>;
}): string {
  const eventSlug = typeof m.meta.eventSlug === 'string' ? m.meta.eventSlug : null;
  if (eventSlug) {
    return `${POLYMARKET_SITE}/event/${eventSlug}${m.slug && m.slug !== eventSlug ? `/${m.slug}` : ''}`;
  }
  return m.slug ? `${POLYMARKET_SITE}/market/${m.slug}` : POLYMARKET_SITE;
}

/**
 * Gamma market -> NormalizedMarket. Returns null for Markets Paras cannot quote
 * (no condition id, no CLOB tokens, order book disabled, or outcomes/tokens misaligned).
 */
export function normalizeGammaMarket(raw: GammaMarket): NormalizedMarket | null {
  const labels = parseJsonArray(raw.outcomes);
  const tokens = parseJsonArray(raw.clobTokenIds);
  if (!raw.conditionId || !raw.question || !labels || !tokens || labels.length !== tokens.length) {
    return null;
  }
  if (raw.enableOrderBook === false) return null;

  const status = raw.closed
    ? raw.umaResolutionStatus === 'resolved'
      ? 'resolved'
      : 'closed'
    : raw.active === false
      ? 'closed'
      : 'open';

  const meta: Record<string, unknown> = {
    gammaId: raw.id ?? null,
    eventSlug: raw.events?.[0]?.slug ?? null,
    negRisk: raw.negRisk ?? false,
    tickSize: raw.orderPriceMinTickSize ?? null,
    minOrderSize: raw.orderMinSize ?? null,
  };
  const slug = raw.slug ?? null;

  return {
    venueId: POLYMARKET_ID,
    externalId: raw.conditionId,
    slug,
    question: raw.question,
    description: raw.description ?? '',
    resolutionSource: raw.resolutionSource || null,
    // Gamma /markets carries no tags; categories arrive with tagging (see PRD, Interest Profile).
    category: null,
    tags: [],
    status,
    endDate: toIso(raw.endDate),
    volume: toDecimalString(raw.volumeNum ?? raw.volume),
    liquidity: toDecimalString(raw.liquidityNum ?? raw.liquidity),
    imageUrl: raw.image || null,
    url: polymarketDeepLink({ slug, meta }),
    fee:
      raw.feesEnabled && raw.feeSchedule
        ? {
            kind: 'curve',
            rate: toDecimalString(raw.feeSchedule.rate),
            exponent: raw.feeSchedule.exponent,
            takerOnly: raw.feeSchedule.takerOnly ?? true,
          }
        : { kind: 'none' },
    outcomes: labels.map((label, index) => ({ externalId: tokens[index]!, label, index })),
    meta,
  };
}

const bookTime = (b: ClobBook, now: Date): string => {
  const ms = Number(b.timestamp);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : now.toISOString();
};

/** CLOB book -> OrderBook (levels unsorted, as the CLOB returns them). */
export function normalizeClobBook(raw: ClobBook, now: Date): OrderBook {
  return {
    outcomeExternalId: raw.asset_id,
    bids: raw.bids.map((l) => ({ price: toDecimalString(l.price), size: toDecimalString(l.size) })),
    asks: raw.asks.map((l) => ({ price: toDecimalString(l.price), size: toDecimalString(l.size) })),
    lastTradePrice: raw.last_trade_price ? toDecimalString(raw.last_trade_price) : null,
    observedAt: bookTime(raw, now),
  };
}

export function orderBookToQuote(book: OrderBook): Quote {
  return {
    outcomeExternalId: book.outcomeExternalId,
    ...bookToQuote(book),
    observedAt: book.observedAt,
  };
}

export function normalizeHistory(history: { t: number; p: number }[]): PricePoint[] {
  return history
    .map((h) => ({
      ts: new Date(h.t * 1000).toISOString(),
      price: toDecimalString(Math.min(Math.max(h.p, 0), 1)),
    }))
    .sort((a, b) => a.ts.localeCompare(b.ts));
}
