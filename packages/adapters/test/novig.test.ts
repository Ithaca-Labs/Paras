import { describe, expect, it } from 'vitest';
import { createNovigAdapter } from '../src/index.js';
import { checkVenue, fixtures, NOW } from './helpers.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createNovigAdapter({ fetch: fixtures('novig'), now: NOW });

describe('novig adapter (fixture replay)', () => {
  it('meets the Venue adapter contract', async () => {
    const { page } = await checkVenue(adapter, {
      venueId: 'novig',
      url: /^https:\/\/novig\.com$/,
    });
    // Market descriptions are terse; the event gives context.
    expect(page.items[0]!.question).toContain(': ');
  });

  it('prices each Outcome from its own bids and the other Outcome complement', async () => {
    const { sample } = await checkVenue(adapter, { venueId: 'novig' });
    const [a, b] = sample.outcomes.map((o) => o.externalId) as [string, string];
    const [qa, qb] = await adapter.fetchQuotes([a, b]);
    // Every order buys: A's ask is 1 - B's bid (and none when B has no bids).
    const mirrored = (ask: string | null, bid: string | null) =>
      bid === null ? expect(ask).toBeNull() : expect(Number(ask)).toBeCloseTo(1 - Number(bid), 6);
    mirrored(qa!.ask, qb!.bid);
    mirrored(qb!.ask, qa!.bid);
  });
});
