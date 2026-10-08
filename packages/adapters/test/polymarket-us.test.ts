import { describe, expect, it } from 'vitest';
import { createPolymarketUsAdapter } from '../src/index.js';
import { checkVenue, fixtures, NOW } from './helpers.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createPolymarketUsAdapter({ fetch: fixtures('polymarket-us'), now: NOW });

describe('polymarket-us adapter (fixture replay)', () => {
  it('meets the Venue adapter contract', async () => {
    const { page } = await checkVenue(adapter, {
      venueId: 'polymarket-us',
      url: /^https:\/\/polymarket\.us\/market\//,
      history: true,
    });
    expect(page.nextCursor).toBe('10');
    expect(adapter.capabilities).toMatchObject({ regulation: 'cftc_regulated' });
  });

  it('derives the short Outcome as the mirror of the long book', async () => {
    const [m] = (await adapter.listMarkets({ limit: 10 })).items;
    const [long, short] = m!.outcomes.map((o) => o.externalId) as [string, string];
    const [yes, no] = await adapter.fetchQuotes([long, short]);
    expect(Number(no!.ask)).toBeCloseTo(1 - Number(yes!.bid), 6);
    expect(Number(no!.bid)).toBeCloseTo(1 - Number(yes!.ask), 6);
  });
});
