import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createPolygon, createPolygonLogs } from '../../src/intents/clients.js';

const url = process.env.POLYGON_FORK_RPC_URL;

// Real Polygon reads (CTF resolution, balances, transfer logs). Needs an RPC; skipped in CI.
describe.skipIf(!url)('Polygon reads against a live/forked node', () => {
  const transport = () => http(url!);
  const wallet = '0x000000000000000000000000000000000000dEaD';

  it('an unknown condition is unresolved; a never-used wallet holds no shares', async () => {
    const polygon = createPolygon({
      transport: transport(),
      account: privateKeyToAccount(`0x${'11'.repeat(32)}`),
    });
    expect(await polygon.payout(`0x${'ab'.repeat(32)}`)).toEqual({
      denominator: 0n,
      numerators: [],
    });
    expect(await polygon.ctfBalance(wallet, '1')).toBe(0n);
  });

  it('scans a recent range of pUSD/CTF transfer logs without error', async () => {
    const logs = createPolygonLogs({ transport: transport() });
    const head = await logs.head();
    const found = await logs.transfers(head - 500n, head, [wallet]);
    expect(Array.isArray(found)).toBe(true);
  });
});
