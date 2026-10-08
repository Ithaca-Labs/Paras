import { describe, expect, it } from 'vitest';
import { quoteSpread } from '../src/index.js';

describe('quoteSpread', () => {
  it('returns ask minus bid', () => {
    expect(quoteSpread({ bid: 0.42, ask: 0.45 })).toBe(0.03);
  });

  it('rejects a crossed book', () => {
    expect(() => quoteSpread({ bid: 0.6, ask: 0.5 })).toThrow(RangeError);
  });
});
