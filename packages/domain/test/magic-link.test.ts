import { describe, expect, it } from 'vitest';
import { signMagicLink, verifyMagicLink, type MagicLinkClaims } from '../src/magic-link.js';

const claims: MagicLinkClaims = {
  jti: 'j1',
  eventId: 'e1',
  source: 'codex',
  iat: 1000,
  exp: 2000,
};
const k1 = { activeKid: 'k1', keys: { k1: 'a'.repeat(32) } };

describe('magic link tokens', () => {
  it('round-trips claims and expires at exp', () => {
    const token = signMagicLink(claims, k1);
    expect(verifyMagicLink(token, k1, 1500)).toEqual({ ok: true, claims });
    expect(verifyMagicLink(token, k1, 2000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rotation: old links verify while their key is kept; dropped key is rejected', () => {
    const old = signMagicLink(claims, k1);
    const rotated = { activeKid: 'k2', keys: { k1: 'a'.repeat(32), k2: 'b'.repeat(32) } };
    expect(verifyMagicLink(old, rotated, 1500).ok).toBe(true);
    const fresh = signMagicLink(claims, rotated);
    expect(verifyMagicLink(fresh, rotated, 1500).ok).toBe(true);
    expect(verifyMagicLink(fresh, k1, 1500)).toEqual({ ok: false, reason: 'unknown_kid' });
    const dropped = { activeKid: 'k2', keys: { k2: 'b'.repeat(32) } };
    expect(verifyMagicLink(old, dropped, 1500)).toEqual({ ok: false, reason: 'unknown_kid' });
  });

  it('a kid pointing at the wrong secret fails the signature', () => {
    const token = signMagicLink(claims, k1);
    const other = { activeKid: 'k1', keys: { k1: 'c'.repeat(32) } };
    expect(verifyMagicLink(token, other, 1500)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
