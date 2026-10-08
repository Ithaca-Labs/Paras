import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseScopes, pkceMatches, redirectUriMatches, validRedirectUri } from '../src/index.js';

describe('oauth', () => {
  it('parseScopes defaults to all, always keeps markets:read, rejects unknown', () => {
    expect(parseScopes(undefined)).toEqual(['markets:read', 'feed:read', 'portfolio:read']);
    expect(parseScopes('feed:read')).toEqual(['markets:read', 'feed:read']);
    expect(parseScopes('feed:read trade:write')).toBeNull();
  });

  it('validates redirect URIs', () => {
    expect(validRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('http://127.0.0.1:9/cb')).toBe(true);
    expect(validRedirectUri('cursor://anysphere.cursor/oauth')).toBe(true);
    expect(validRedirectUri('http://evil.example/cb')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
    expect(validRedirectUri('https://a.example/cb#x')).toBe(false);
  });

  it('matches redirect URIs exactly, loopback ignoring port', () => {
    const reg = ['https://a.example/cb', 'http://127.0.0.1/cb'];
    expect(redirectUriMatches(reg, 'https://a.example/cb')).toBe(true);
    expect(redirectUriMatches(reg, 'https://a.example/cb2')).toBe(false);
    expect(redirectUriMatches(reg, 'http://127.0.0.1:5555/cb')).toBe(true);
    expect(redirectUriMatches(reg, 'http://127.0.0.1:5555/other')).toBe(false);
    expect(redirectUriMatches(reg, 'https://a.example:444/cb')).toBe(false);
  });

  it('checks PKCE S256', () => {
    const v = 'a'.repeat(43);
    const c = createHash('sha256').update(v).digest('base64url');
    expect(pkceMatches(v, c)).toBe(true);
    expect(pkceMatches('b'.repeat(43), c)).toBe(false);
    expect(pkceMatches('short', c)).toBe(false);
  });
});
