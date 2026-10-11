import { computeSmartMoney } from '@paras/domain';
import { createFixtureFetch } from '@paras/testkit';
import { describe, expect, it } from 'vitest';
import { createNansenClient, NansenError } from '../src/index.js';

// Fixtures are HAND-WRITTEN from docs.nansen.ai schemas (no API key when recorded).
// Refresh against the real API with: RECORD_FIXTURES=1 NANSEN_API_KEY=... (costs credits).
const client = createNansenClient({
  apiKey: 'test-key',
  fetch: createFixtureFetch({ dir: new URL('./fixtures/nansen/', import.meta.url) }),
});

describe('nansen client (fixture replay)', () => {
  it('parses holders + trades and feeds the smart-money signal', async () => {
    const holders = await client.topHolders('0xcond1');
    const trades = await client.tradesByMarket('0xcond1', '2026-10-10T00:00:00.000Z');
    expect(holders.data).toHaveLength(4);
    expect(trades.data).toHaveLength(4);
    const s = computeSmartMoney({ holders: holders.data, trades: trades.data });
    expect(s.smartHolders).toBe(3);
    expect(s.lean).toBeGreaterThan(0.5);
  });

  it('parses smart-money netflow rows', async () => {
    const { data } = await client.netflow('BTC');
    expect(data[0]).toMatchObject({ token_symbol: 'BTC', net_flow_24h_usd: 2_500_000 });
  });

  it('sends the apikey header and throws NansenError on non-2xx', async () => {
    let seen: Headers | undefined;
    const bad = createNansenClient({
      apiKey: 'k',
      fetch: async (_u, init) => {
        seen = new Headers(init?.headers);
        return new Response('{}', { status: 429 });
      },
    });
    await expect(bad.netflow('BTC')).rejects.toMatchObject({ status: 429 });
    await expect(bad.netflow('BTC')).rejects.toBeInstanceOf(NansenError);
    expect(seen?.get('apikey')).toBe('k');
  });
});
