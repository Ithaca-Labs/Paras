import { createHash } from 'node:crypto';

/** No write or trade scope exists, by design. `markets:read` is always granted (public data). */
export const OAUTH_SCOPES = ['markets:read', 'feed:read', 'portfolio:read'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

/** Space-delimited `scope` param. Absent/blank = every scope. Null if any scope is unknown. */
export function parseScopes(raw: string | undefined): OAuthScope[] | null {
  const asked = raw?.split(/\s+/).filter(Boolean) ?? [];
  if (!asked.length) return [...OAUTH_SCOPES];
  const known = new Set<string>(OAUTH_SCOPES);
  if (asked.some((s) => !known.has(s))) return null;
  return OAUTH_SCOPES.filter((s) => s === 'markets:read' || asked.includes(s));
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const BAD_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:']);

/** Redirect URI acceptable at registration: https, loopback http, or an app's private-use scheme. */
export function validRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || BAD_SCHEMES.has(u.protocol)) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return true;
}

/** Exact match; loopback redirects may differ in port only (RFC 8252 7.3). */
export function redirectUriMatches(registered: string[], given: string): boolean {
  if (registered.includes(given)) return true;
  let g: URL;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return (
        u.protocol === 'http:' &&
        u.hostname === g.hostname &&
        u.pathname === g.pathname &&
        u.search === g.search
      );
    } catch {
      return false;
    }
  });
}

/** PKCE S256 check (RFC 7636). */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return createHash('sha256').update(verifier).digest('base64url') === challenge;
}
