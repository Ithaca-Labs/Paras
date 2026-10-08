import { describe, expect, it } from 'vitest';
import { redeemPayout, resolutionState, toBase6, valuePosition } from '../src/index.js';

describe('portfolio math', () => {
  it('toBase6 truncates, never rounds up', () => {
    expect(toBase6('18.0909090909')).toBe(18_090_909n);
    expect(toBase6('5')).toBe(5_000_000n);
    expect(toBase6('0.1')).toBe(100_000n);
  });

  it('values an open position at the bid and splits realized vs unrealized P&L', () => {
    // bought 20 shares for $10, sold 5 for $3 (cost of those: $2.50), 15 left marked at 0.60.
    const v = valuePosition({
      shares: 15_000_000n,
      sharesBought: 20_000_000n,
      cost: 10_000_000n,
      proceeds: 3_000_000n,
      price: '0.60',
    });
    expect(v).toEqual({
      costBasis: 7_500_000n,
      value: 9_000_000n,
      unrealized: 1_500_000n,
      realized: 500_000n,
    });
  });

  it('unpriced positions are carried at cost', () => {
    const v = valuePosition({
      shares: 10_000_000n,
      sharesBought: 10_000_000n,
      cost: 4_000_000n,
      proceeds: 0n,
      price: null,
    });
    expect(v.value).toBe(4_000_000n);
    expect(v.unrealized).toBe(0n);
  });

  it('redeem payout is shares * numerator / denominator', () => {
    expect(redeemPayout(10_000_000n, 1n, 1n)).toBe(10_000_000n);
    expect(redeemPayout(10_000_000n, 0n, 1n)).toBe(0n);
    expect(redeemPayout(10_000_000n, 1n, 0n)).toBe(0n);
  });

  it('flags disputes and long-pending resolutions as delayed', () => {
    const end = new Date('2026-10-01T00:00:00Z');
    const now = new Date('2026-10-01T06:00:00Z');
    expect(resolutionState({ status: 'closed', endDate: end, umaStatus: 'proposed' }, now)).toEqual(
      { state: 'proposed', delayed: false },
    );
    expect(resolutionState({ status: 'closed', endDate: end, umaStatus: 'disputed' }, now)).toEqual(
      { state: 'disputed', delayed: true },
    );
    expect(
      resolutionState({ status: 'closed', endDate: end }, new Date('2026-10-03T00:00:00Z')),
    ).toEqual({ state: 'closed', delayed: true });
    expect(resolutionState({ status: 'resolved', endDate: end }, now).state).toBe('resolved');
  });
});
