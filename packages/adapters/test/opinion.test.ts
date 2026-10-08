import { describe, expect, it } from 'vitest';
import { createOpinionAdapter } from '../src/index.js';
import { checkVenue, fixtures, NOW } from './helpers.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createOpinionAdapter({ fetch: fixtures('opinion'), now: NOW });

describe('opinion adapter (fixture replay)', () => {
  it('meets the Venue adapter contract', async () => {
    const { page } = await checkVenue(adapter, {
      venueId: 'opinion',
      limit: 20,
      url: /^https:\/\/app\.opinion\.trade\/detail\?topicId=\d+$/,
      history: true,
    });
    expect(page.nextCursor).toBe('2');
  });

  it('keys Outcomes by their own token id, each with its own book', async () => {
    const [m] = (await adapter.listMarkets({ limit: 20 })).items;
    const ids = m!.outcomes.map((o) => o.externalId);
    expect(ids.every((id) => /^\d{20,}$/.test(id))).toBe(true);
    const books = await adapter.fetchOrderBooks!(ids);
    expect(books.map((b) => b.outcomeExternalId).sort()).toEqual([...ids].sort());
  });
});
