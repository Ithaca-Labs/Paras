import type { BookLevel } from './book.js';
import { pickBest, walkAsks, type FeeModel, type Fill } from './compare.js';
import { formatDecimal, parseDecimal } from './decimal.js';
import { venueAvailabilityFor, type VenueRestrictions } from './eligibility.js';

/** Cost of the CCTP + native USDC -> USDC.e swap + wrap path, in bps of the stake (PRD risk finding 2c: ~1 bps). */
export const POLYMARKET_ROUTE_OVERHEAD_BPS = 1;

/** One Venue the Route may consider: routable ones can execute, the rest only produce a redirect hint. */
export interface RouteVenue {
  venueId: string;
  caps: VenueRestrictions;
  fee: FeeModel;
  asks: readonly BookLevel[];
  redirectUrl: string;
  /** Extra cost of reaching the Venue, bps of stake. */
  overheadBps?: number;
}

export interface RoutedFill {
  venueId: string;
  fill: Fill;
  /** Part of the stake lost to bridging/swapping (USD). */
  overhead: string;
  redirectUrl: string;
}

export interface RedirectHint {
  venueId: string;
  redirectUrl: string;
  shares: string;
  effectivePrice: string;
  /** Extra shares vs the routed fill for the same stake. */
  extraShares: string;
}

export type RouteResult =
  | { kind: 'route'; route: RoutedFill; hint: RedirectHint | null }
  | {
      kind: 'none';
      reason: 'no_routable_venue' | 'max_price' | 'no_depth';
      redirects: { venueId: string; redirectUrl: string; fill: Fill | null }[];
    };

/**
 * What `stake` buys on one Venue without paying more than `maxPrice` per share (before fees) and
 * after the path overhead. `fill` is null when no ask at or below the cap can absorb anything. The
 * Executor reuses this at order time, so preview and execution share one definition of "within limit".
 */
export function fillWithinMaxPrice(
  v: Pick<RouteVenue, 'asks' | 'fee' | 'overheadBps'>,
  stake: string,
  maxPrice: string,
): { fill: Fill | null; overhead: string } {
  const gross = parseDecimal(stake);
  const overhead = (gross * BigInt(v.overheadBps ?? 0)) / 10_000n;
  const cap = parseDecimal(maxPrice);
  const asks = v.asks.filter((l) => parseDecimal(l.price) <= cap);
  return {
    fill: walkAsks(asks, v.fee, formatDecimal(gross - overhead)),
    overhead: formatDecimal(overhead),
  };
}

/**
 * Venue-agnostic Route: the best routable Venue for a stake under `maxPrice`, plus a redirect hint when a
 * read-only Venue (Kalshi) would buy more shares. V1 has one routable Venue; the list shape is Kalshi-ready.
 */
export function computeRoute(p: {
  venues: readonly RouteVenue[];
  stake: string;
  maxPrice: string;
  /** Caller countries (IP and attested); the worst availability wins. */
  countries: readonly string[];
}): RouteResult {
  const avail = p.venues.map((v) => venueAvailabilityFor(v.venueId, v.caps, p.countries));
  const cands = p.venues
    .filter((_, i) => avail[i] === 'routable')
    .map((v) => ({ v, ...fillWithinMaxPrice(v, p.stake, p.maxPrice) }));
  const others = p.venues
    .filter((_, i) => avail[i] === 'redirect')
    .map((v) => ({ v, fill: walkAsks(v.asks, v.fee, p.stake) }));

  const best = pickBest(
    cands.map((c) => ({
      eligible: true,
      priced: { feePerShare: null, effectiveAsk: null, mid: null, fill: c.fill },
    })),
    p.stake,
  );

  if (best === null) {
    let reason: 'no_routable_venue' | 'max_price' | 'no_depth' = 'no_routable_venue';
    if (cands.length) {
      reason = cands.some((c) => walkAsks(c.v.asks, c.v.fee, p.stake)) ? 'max_price' : 'no_depth';
    }
    return {
      kind: 'none',
      reason,
      redirects: others.map(({ v, fill }) => ({
        venueId: v.venueId,
        redirectUrl: v.redirectUrl,
        fill,
      })),
    };
  }

  const c = cands[best]!;
  const routed = parseDecimal(c.fill!.shares);
  let hint: RedirectHint | null = null;
  for (const { v, fill } of others) {
    if (!fill) continue;
    const shares = parseDecimal(fill.shares);
    if (shares > routed && (!hint || shares > parseDecimal(hint.shares))) {
      hint = {
        venueId: v.venueId,
        redirectUrl: v.redirectUrl,
        shares: fill.shares,
        effectivePrice: fill.effectivePrice,
        extraShares: formatDecimal(shares - routed),
      };
    }
  }
  return {
    kind: 'route',
    route: {
      venueId: c.v.venueId,
      fill: c.fill!,
      overhead: c.overhead,
      redirectUrl: c.v.redirectUrl,
    },
    hint,
  };
}
