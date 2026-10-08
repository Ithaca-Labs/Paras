import { describe, expect, it } from 'vitest';
import { apiRoutes, buildOpenApiDocument, createApiClient } from '../src/index.js';

describe('openapi', () => {
  it('generates an OpenAPI 3.1 document from route definitions', () => {
    const doc = buildOpenApiDocument(apiRoutes);
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths?.['/v1/health']?.get?.operationId).toBe('getHealth');
  });
});

describe('typed client', () => {
  it('calls routes and parses responses', async () => {
    const fakeFetch = (async (url: string | URL | Request) => {
      expect(String(url)).toBe('http://x/v1/health');
      return Response.json({ status: 'ok', db: true, venues: [] });
    }) as typeof fetch;
    const client = createApiClient({ baseUrl: 'http://x', fetch: fakeFetch });
    await expect(client.getHealth()).resolves.toEqual({ status: 'ok', db: true, venues: [] });
  });
});
