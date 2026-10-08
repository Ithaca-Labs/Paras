import { describe, expect, it } from 'vitest';
import { feePerShare, formatDecimal, parseDecimal, priceQuote } from '../src/index.js';

const f = (fee: Parameters<typeof feePerShare>[0], p: string) =>
  formatDecimal(feePerShare(fee, parseDecimal(p)));

describe('feePerShare', () => {
  it('profit: rate * (1 - p) per share', () => {
    expect(f({ kind: 'profit', rate: '0.01' }, '0.6')).toBe('0.004');
    expect(f({ kind: 'profit', rate: '0.01' }, '1')).toBe('0');
  });

  const tiered = {
    kind: 'tiered',
    points: [
      { price: '0.5', rate: '0.03' },
      { price: '0.6', rate: '0.02' },
    ],
  } as const;

  it('tiered: clamps outside the points, interpolates between, scales by price', () => {
    expect(f(tiered, '0.4')).toBe('0.012'); // 3% flat below first point
    expect(f(tiered, '0.55')).toBe('0.01375'); // 2.5% * 0.55
    expect(f(tiered, '0.8')).toBe('0.016'); // 2% clamped above last
  });

  it('flows into effective ask', () => {
    const fee = { kind: 'profit', rate: '0.01' } as const;
    expect(priceQuote({ bid: null, ask: '0.6', fee }).effectiveAsk).toBe('0.604');
  });
});
