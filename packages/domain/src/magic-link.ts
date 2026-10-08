import { createHmac, timingSafeEqual } from 'node:crypto';

export type MagicLinkSource = 'claude' | 'codex' | 'web';

/** What a Magic Link carries. Money fields are decimal strings. Never executes anything. */
export interface MagicLinkClaims {
  /** Audit row id. */
  jti: string;
  eventId: string;
  /** Outcome label (Venue-agnostic), e.g. "Yes". */
  outcome?: string;
  /** Intended stake in USDC. */
  amount?: string;
  /** Worst acceptable price per share, 0..1. */
  maxPrice?: string;
  source: MagicLinkSource;
  /** If set, only this User may resolve the link. */
  userId?: string;
  /** Unix seconds. */
  iat: number;
  exp: number;
}

/** Signing keys by `kid`; rotate by adding a new active key and keeping old ones until their links expire. */
export interface MagicLinkKeys {
  activeKid: string;
  keys: Record<string, string>;
}

export type MagicLinkVerdict =
  | { ok: true; claims: MagicLinkClaims }
  | { ok: false; reason: 'malformed' | 'unknown_kid' | 'bad_signature' | 'expired' };

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (key: string, data: string) => createHmac('sha256', key).update(data).digest();

/** Compact JWS (HS256): `header.payload.signature`, header carries `kid`. */
export function signMagicLink(claims: MagicLinkClaims, k: MagicLinkKeys): string {
  const key = k.keys[k.activeKid];
  if (!key) throw new Error(`magic link key ${k.activeKid} missing`);
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'ML', kid: k.activeKid }));
  const body = b64(JSON.stringify(claims));
  return `${head}.${body}.${b64(mac(key, `${head}.${body}`))}`;
}

/** Signature is checked before the payload is trusted; expiry is checked last. */
export function verifyMagicLink(token: string, k: MagicLinkKeys, nowSec: number): MagicLinkVerdict {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) {
    return { ok: false, reason: 'malformed' };
  }
  const [head, body, sig] = parts as [string, string, string];
  let kid: unknown;
  try {
    const h = JSON.parse(Buffer.from(head, 'base64url').toString()) as {
      alg?: unknown;
      kid?: unknown;
    };
    if (h.alg !== 'HS256') return { ok: false, reason: 'malformed' };
    kid = h.kid;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const key = typeof kid === 'string' ? k.keys[kid] : undefined;
  if (!key) return { ok: false, reason: 'unknown_kid' };
  const expected = mac(key, `${head}.${body}`);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  let claims: MagicLinkClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as MagicLinkClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claims.exp !== 'number' || typeof claims.eventId !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  if (nowSec >= claims.exp) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}
