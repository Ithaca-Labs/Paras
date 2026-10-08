import { describe, it } from 'vitest';
import { createProbableAdapter } from '../src/index.js';
import { checkVenue, fixtures, NOW } from './helpers.js';

// Replays recorded responses; refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createProbableAdapter({ fetch: fixtures('probable'), now: NOW });

describe('probable adapter (fixture replay)', () => {
  it('meets the Venue adapter contract', async () => {
    await checkVenue(adapter, {
      venueId: 'probable',
      url: /^https:\/\/probable\.markets\/market\//,
      history: true,
    });
  });
});
