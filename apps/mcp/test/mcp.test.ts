import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

const app = buildApp();
let url: string;
beforeAll(async () => {
  url = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(() => app.close());

describe('mcp', () => {
  it('serves /health', async () => {
    const res = await fetch(`${url}/health`);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('completes the MCP handshake with a real client and exposes no tools yet', async () => {
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    expect(client.getServerVersion()?.name).toBe('paras');
    // No tools registered, so the server does not advertise the capability.
    expect(client.getServerCapabilities()?.tools).toBeUndefined();
    await client.close();
  });
});
