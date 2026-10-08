import type { NormalizedMarket, Quote } from '@paras/shared';
import { toDecimalString } from '../decimal.js';
import type { PrMarket } from './raw.js';
import type { LongTailVenue } from './venues.js';

const SEP = ':';

/** Outcome id = `<market id>:<PolyRouter outcome id>`, so Quotes resolve without a lookup table. */
export const outcomeExternalId = (marketId: string, outcomeId: string) =>
  `${marketId}${SEP}${outcomeId}`;

export function splitOutcomeId(id: string): { marketId: string; outcomeId: string } | null {
  const i = id.lastIndexOf(SEP);
  return i > 0 && i < id.length - 1
    ? { marketId: id.slice(0, i), outcomeId: id.slice(i + 1) }
    : null;
}

const toIso = (v: string | null | undefined): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Clamp a Venue price into 0..1 and format as a decimal string. */
const toPrice = (n: number | null | undefined): string | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? toDecimalString(Math.min(n, 1)) : null;

const STATUS: Record<string, NormalizedMarket['status']> = {
  open: 'open',
  resolved: 'resolved',
  paused: 'closed',
  cancelled: 'closed',
  closed: 'closed',
  unopened: 'closed',
};

export function normalizePrMarket(raw: PrMarket, venue: LongTailVenue): NormalizedMarket | null {
  if (!raw.title || raw.outcomes.length === 0) return null;
  const url = raw.source_url && /^https?:\/\//.test(raw.source_url) ? raw.source_url : venue.site;
  return {
    venueId: venue.id,
    externalId: raw.id,
    slug: raw.market_slug ?? raw.slug ?? null,
    question: raw.title,
    description: raw.resolution_criteria ?? raw.description ?? '',
    resolutionSource: raw.resolution_source ?? null,
    category: raw.category ?? null,
    tags: raw.tags ?? [],
    status: STATUS[raw.status] ?? 'closed',
    endDate: toIso(raw.trading_end_at),
    volume: toDecimalString(raw.volume_total),
    liquidity: toDecimalString(raw.liquidity),
    imageUrl: raw.image_url ?? null,
    url,
    // PolyRouter reports at most a flat fee rate; the curve model does not apply.
    fee: { kind: 'none' },
    outcomes: raw.outcomes.map((o, index) => ({
      externalId: outcomeExternalId(raw.id, o.id),
      label: o.name,
      index,
    })),
    meta: { source: 'polyrouter', sourceUrl: url, eventId: raw.event_id ?? null },
  };
}

/**
 * Quotes from a Market's `current_prices`. PolyRouter has no order books for long-tail Venues,
 * so depth is unknown and reported as 0.
 */
export function quotesFromMarket(raw: PrMarket, observedAt: Date): Quote[] {
  return raw.outcomes.flatMap((o) => {
    const p = raw.current_prices[o.id];
    if (!p) return [];
    return [
      {
        outcomeExternalId: outcomeExternalId(raw.id, o.id),
        bid: toPrice(p.bid),
        ask: toPrice(p.ask),
        last: toPrice(p.price),
        bidDepth: '0',
        askDepth: '0',
        observedAt: observedAt.toISOString(),
      },
    ];
  });
}
