import { describe, expect, it } from 'vitest';
import { computeRoute, fillWithinMaxPrice, type RouteVenue } from '../src/route.js';
import { intentDetailsHash, intentTypedData } from '../src/intent.js';

const poly: RouteVenue = {
  venueId: 'polymarket',
  caps: { routable: true, restrictedJurisdictions: [] },
  fee: { kind: 'none' },
  asks: [
    { price: '0.50', size: '100' },
    { price: '0.60', size: '100' },
  ],
  redirectUrl: 'https://polymarket.com/x',
  overheadBps: 1,
};
const kalshi: RouteVenue = {
  venueId: 'kalshi',
  caps: { routable: false, restrictedJurisdictions: [] },
  fee: { kind: 'none' },
  asks: [{ price: '0.40', size: '1000' }],
  redirectUrl: 'https://kalshi.com/x',
};

describe('Route (venue-agnostic)', () => {
  it('routes to the routable Venue and hints at a cheaper read-only Venue', () => {
    const r = computeRoute({ venues: [poly, kalshi], stake: '10', maxPrice: '0.55', countries: ['IN'] });
    expect(r.kind).toBe('route');
    if (r.kind !== 'route') return;
    expect(r.route.venueId).toBe('polymarket');
    expect(r.route.overhead).toBe('0.001');
    expect(r.hint?.venueId).toBe('kalshi');
    expect(r.hint?.redirectUrl).toBe('https://kalshi.com/x');
  });

  it('enforces max price: only asks at or below the cap fill', () => {
    const { fill } = fillWithinMaxPrice(poly, '100', '0.50');
    expect(fill?.shares).toBe('100'); // the 0.50 level only; 50 USD spent, the rest unspent
    expect(fill?.unspent).toBe('49.99'); // net of the 1 bps path overhead
    expect(fillWithinMaxPrice(poly, '10', '0.40').fill).toBeNull();
  });

  it('answers max_price / no_depth / no_routable_venue with redirects', () => {
    const base = { stake: '10', countries: ['IN'] };
    const cap = computeRoute({ ...base, venues: [poly, kalshi], maxPrice: '0.40' });
    expect(cap).toMatchObject({ kind: 'none', reason: 'max_price' });
    const empty = computeRoute({ ...base, venues: [{ ...poly, asks: [] }], maxPrice: '0.9' });
    expect(empty).toMatchObject({ kind: 'none', reason: 'no_depth' });
    const us = computeRoute({ ...base, venues: [poly, kalshi], maxPrice: '0.9', countries: ['US'] });
    expect(us).toMatchObject({ kind: 'none', reason: 'no_routable_venue' });
    if (us.kind === 'none') expect(us.redirects.map((x) => x.venueId)).toEqual(['kalshi']);
  });

  it('unknown country fails closed (no route)', () => {
    expect(computeRoute({ venues: [poly], stake: '10', maxPrice: '0.9', countries: [] }).kind).toBe('none');
  });
});

describe('Intent commitments', () => {
  const d = {
    eventId: 'e',
    marketId: 'm',
    outcomeId: 'o',
    venueId: 'polymarket',
    tokenId: 't',
    maxPrice: '0.55',
    remainder: 'return' as const,
  };
  it('hash binds every field', () => {
    const h = intentDetailsHash(d);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(intentDetailsHash({ ...d, maxPrice: '0.56' })).not.toBe(h);
    expect(intentDetailsHash({ ...d, remainder: 'rest' })).not.toBe(h);
  });
  it('typed data matches the Vault Intent struct', () => {
    const t = intentTypedData({
      vault: '0x2222222222222222222222222222222222222222',
      chainId: 143,
      user: '0x1111111111111111111111111111111111111111',
      id: `0x${'aa'.repeat(32)}`,
      amount: 10_000_000n,
      expiry: 99n,
      detailsHash: intentDetailsHash(d),
    });
    expect(t.types.Intent.map((f) => f.name)).toEqual(['user', 'id', 'amount', 'expiry', 'detailsHash']);
    expect(t.domain).toMatchObject({ name: 'ParasVault', version: '1', chainId: 143 });
  });
});
