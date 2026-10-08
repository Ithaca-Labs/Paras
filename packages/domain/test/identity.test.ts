import { describe, expect, it } from 'vitest';
import { normalizeEmail, pickMergeSurvivor, sanitizeReturnTo } from '../src/index.js';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => expect(normalizeEmail('  A@B.Co ')).toBe('a@b.co'));
  it('rejects junk', () => {
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
  });
});

describe('sanitizeReturnTo', () => {
  it('keeps relative paths', () => expect(sanitizeReturnTo('/m/abc?x=1')).toBe('/m/abc?x=1'));
  it.each(['https://evil.com', '//evil.com', '/\\evil', 'javascript:1', '', '/a\nb'])(
    'drops %j',
    (v) => expect(sanitizeReturnTo(v)).toBeNull(),
  );
  it('handles nullish', () => expect(sanitizeReturnTo(undefined)).toBeNull());
});

describe('pickMergeSurvivor', () => {
  const old = { id: 'b', createdAt: new Date(1) };
  const young = { id: 'a', createdAt: new Date(2) };
  it('older survives regardless of order', () => {
    expect(pickMergeSurvivor(old, young).survivor).toBe(old);
    expect(pickMergeSurvivor(young, old).survivor).toBe(old);
  });
  it('ties break on id', () => {
    const x = { id: 'a', createdAt: new Date(1) };
    const y = { id: 'b', createdAt: new Date(1) };
    expect(pickMergeSurvivor(y, x).survivor).toBe(x);
  });
});
