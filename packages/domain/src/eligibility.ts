/**
 * Country x Venue eligibility. Pure: callers pass the Venue's capabilities and the caller's country.
 *
 * - `routable`: the Vault may place orders on this Venue for the caller.
 * - `redirect`: caller can use the Venue on its own site (read-only Venue, or country unknown); no Vault.
 * - `blocked`: the Venue is not available in the caller's country.
 */
export type Availability = 'routable' | 'redirect' | 'blocked';

export interface VenueRestrictions {
  routable: boolean;
  restrictedJurisdictions: readonly string[];
}

/**
 * Polymarket international geoblock (PRD, Vault risk findings 2e), whole-country granularity.
 * Includes close-only entries (API or frontend only): per-user gating must not route them through
 * a permitted Executor IP. Region-level entries (UA-43/14/09, CA provinces) are widened to the whole
 * country, failing closed. "Others in the docs" are added here as they are confirmed.
 */
export const POLYMARKET_RESTRICTED: readonly string[] = [
  // fully blocked
  ...['IR', 'SY', 'CU', 'KP', 'UA'],
  // close-only, frontend and API
  ...['US', 'GB', 'FR', 'DE', 'IT', 'PL', 'SG', 'TW', 'TH', 'AU', 'BE', 'BR', 'RU', 'BY', 'CA'],
  // close-only, frontend (and sports for MT)
  ...['IE', 'JP', 'MT', 'NL', 'KR'],
];

/** Restrictions that live in Paras rather than in the adapter's self-reported capabilities. */
const EXTRA_RESTRICTIONS: Record<string, readonly string[]> = { polymarket: POLYMARKET_RESTRICTED };

const RANK: Record<Availability, number> = { routable: 0, redirect: 1, blocked: 2 };

/** `country` null = unknown: fail closed to `redirect`. */
export function venueAvailability(
  venueId: string,
  caps: VenueRestrictions,
  country: string | null,
): Availability {
  if (!country) return 'redirect';
  const c = country.toUpperCase();
  const restricted = [...caps.restrictedJurisdictions, ...(EXTRA_RESTRICTIONS[venueId] ?? [])];
  if (restricted.includes(c)) return 'blocked';
  return caps.routable ? 'routable' : 'redirect';
}

/** Availability for a caller with several known countries (IP and attested): the worst wins. */
export function venueAvailabilityFor(
  venueId: string,
  caps: VenueRestrictions,
  countries: readonly string[],
): Availability {
  if (!countries.length) return venueAvailability(venueId, caps, null);
  return countries
    .map((c) => venueAvailability(venueId, caps, c))
    .reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}

export type IneligibleReason =
  | 'country_unknown'
  | 'attestation_required'
  | 'country_mismatch'
  | 'no_routable_venue'
  | 'disclosures_not_acknowledged';

export interface VaultEligibilityInput {
  ipCountry: string | null;
  attestedCountry: string | null;
  disclosuresAcknowledged: boolean;
  /** Availability per Venue computed for the caller. */
  venues: readonly Availability[];
}

export function vaultIneligibleReasons(i: VaultEligibilityInput): IneligibleReason[] {
  const r: IneligibleReason[] = [];
  if (!i.ipCountry) r.push('country_unknown');
  if (!i.attestedCountry) r.push('attestation_required');
  else if (i.ipCountry && i.ipCountry !== i.attestedCountry) r.push('country_mismatch');
  if (!i.venues.includes('routable')) r.push('no_routable_venue');
  if (!i.disclosuresAcknowledged) r.push('disclosures_not_acknowledged');
  return r;
}
