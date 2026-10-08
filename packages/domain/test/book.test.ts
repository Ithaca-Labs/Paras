import { describe, expect, it } from 'vitest';
import { bookToQuote, formatDecimal, isStale, mulDecimal, parseDecimal } from '../src/index.js';

describe('decimal', () => {
  it('round-trips and multiplies exactly', () => {
    expect(formatDecimal(parseDecimal('0.520'))).toBe('0.52');
    expect(formatDecimal(parseDecimal('10'))).toBe('10');
    expect(formatDecimal(mulDecimal(parseDecimal('0.1'), parseDecimal('0.2')))).toBe('0.02');
    expect(() => parseDecimal('1e-7')).toThrow(RangeError);
  });
});

describe('bookToQuote', () => {
  it('finds best bid/ask regardless of level order and sums depth', () => {
    const q = bookToQuote({
      bids: [
        { price: '0.01', size: '100' },
        { price: '0.14', size: '10' },
        { price: '0.15', size: '20' },
      ],
      asks: [
        { price: '0.99', size: '5' },
        { price: '0.17', size: '4' },
        { price: '0.16', size: '2.5' },
      ],
      lastTradePrice: '0.150',
    });
    expect(q).toEqual({
      bid: '0.15',
      ask: '0.16',
      last: '0.15',
      bidDepth: '5.4', // 1 + 1.4 + 3
      askDepth: '6.03', // 4.95 + 0.68 + 0.4
    });
  });

  it('handles empty sides and ignores zero-size levels', () => {
    expect(bookToQuote({ bids: [{ price: '0.5', size: '0' }], asks: [] })).toEqual({
      bid: null,
      ask: null,
      last: null,
      bidDepth: '0',
      askDepth: '0',
    });
  });

  it('rejects a crossed book', () => {
    expect(() =>
      bookToQuote({ bids: [{ price: '0.6', size: '1' }], asks: [{ price: '0.5', size: '1' }] }),
    ).toThrow(/crossed/);
  });
});

describe('isStale', () => {
  it('compares age to the max', () => {
    const now = new Date('2026-01-01T00:02:00Z');
    expect(isStale(new Date('2026-01-01T00:00:00Z'), now, 60_000)).toBe(true);
    expect(isStale(new Date('2026-01-01T00:01:30Z'), now, 60_000)).toBe(false);
  });
});
