import type { VenueCapabilities } from '@paras/shared';

export interface LongTailVenue {
  /** Paras Venue id (lowercase slug). */
  id: string;
  name: string;
  /** Platform ids PolyRouter may use for it (matched case-insensitively, `-`/`_` ignored). */
  aliases: string[];
  /** Venue home page, used when a Market carries no URL. */
  site: string;
  capabilities: VenueCapabilities;
}

const base = {
  routable: false,
  // PolyRouter exposes order books only for Polymarket, Kalshi, Limitless and Manifold.
  orderBook: false,
  priceHistory: true,
} as const;

const offshore = (): VenueCapabilities => ({
  ...base,
  realMoney: true,
  regulation: 'offshore',
  restrictedJurisdictions: ['US'],
});

/**
 * Long-tail Venues reached through PolyRouter. Venues Paras covers natively (Polymarket, Kalshi,
 * Limitless, SX Bet) are deliberately absent so they never appear twice.
 *
 * Regulation labels are conservative. `unknown` means "not verified by us", never "unregulated";
 * tighten via a PRD decision-log entry once legal confirms each Venue's status.
 */
export const LONG_TAIL_VENUES: readonly LongTailVenue[] = [
  {
    id: 'myriad',
    name: 'Myriad',
    aliases: ['myriad'],
    site: 'https://myriad.markets',
    capabilities: offshore(),
  },
  {
    id: 'opinion',
    name: 'Opinion',
    aliases: ['opinion', 'opinionlabs'],
    site: 'https://opinion.trade',
    capabilities: offshore(),
  },
  {
    id: 'predict-fun',
    name: 'Predict.fun',
    aliases: ['predictfun', 'predict', 'probable'],
    site: 'https://predict.fun',
    capabilities: offshore(),
  },
  {
    id: 'prophetx',
    name: 'ProphetX',
    aliases: ['prophetx'],
    site: 'https://prophetx.co',
    capabilities: { ...base, realMoney: true, regulation: 'unknown', restrictedJurisdictions: [] },
  },
  {
    id: 'novig',
    name: 'Novig',
    aliases: ['novig'],
    site: 'https://novig.us',
    capabilities: { ...base, realMoney: true, regulation: 'unknown', restrictedJurisdictions: [] },
  },
  {
    id: 'polymarket-us',
    name: 'Polymarket US',
    aliases: ['polymarketus'],
    site: 'https://polymarket.us',
    capabilities: {
      ...base,
      realMoney: true,
      regulation: 'cftc_regulated',
      restrictedJurisdictions: [],
    },
  },
  {
    id: 'manifold',
    name: 'Manifold',
    aliases: ['manifold', 'manifoldmarkets'],
    site: 'https://manifold.markets',
    capabilities: {
      ...base,
      realMoney: false,
      regulation: 'play_money',
      restrictedJurisdictions: [],
    },
  },
];

/** PolyRouter platform ids Paras covers natively: never ingested through PolyRouter. */
export const NATIVE_PLATFORMS: ReadonlySet<string> = new Set([
  'polymarket',
  'kalshi',
  'limitless',
  'sxbet',
]);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Map a PolyRouter platform id to a long-tail Venue, or null (native, or unknown to Paras). */
export function resolvePlatform(platform: string): LongTailVenue | null {
  const key = squash(platform);
  if (NATIVE_PLATFORMS.has(key)) return null;
  return LONG_TAIL_VENUES.find((v) => v.aliases.includes(key) || squash(v.id) === key) ?? null;
}
