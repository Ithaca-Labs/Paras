import { describe, expect, it } from 'vitest';
import { vaultIneligibleReasons, venueAvailability, venueAvailabilityFor } from '../src/index.js';

const poly = { routable: true, restrictedJurisdictions: ['US'] };
const kalshi = { routable: false, restrictedJurisdictions: [] };

describe('eligibility matrix', () => {
  it('routable, redirect, blocked', () => {
    expect(venueAvailability('polymarket', poly, 'IN')).toBe('routable');
    expect(venueAvailability('polymarket', poly, 'us')).toBe('blocked');
    expect(venueAvailability('polymarket', poly, 'DE')).toBe('blocked'); // geoblock list
    expect(venueAvailability('kalshi', kalshi, 'US')).toBe('redirect');
  });
  it('unknown country fails closed', () => {
    expect(venueAvailability('polymarket', poly, null)).toBe('redirect');
  });
  it('worst country wins', () => {
    expect(venueAvailabilityFor('polymarket', poly, ['IN', 'US'])).toBe('blocked');
  });
  it('reasons', () => {
    const ok = {
      ipCountry: 'IN',
      attestedCountry: 'IN',
      disclosuresAcknowledged: true,
      venues: ['routable'] as const,
    };
    expect(vaultIneligibleReasons(ok)).toEqual([]);
    expect(vaultIneligibleReasons({ ...ok, attestedCountry: 'BR' })).toEqual(['country_mismatch']);
  });
});
