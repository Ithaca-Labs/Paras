import { describe, expect, it } from 'vitest';
import { createPredictFunAdapter, longTailAdaptersFromEnv } from '../src/index.js';
import { checkVenue, fixtures, NOW } from './helpers.js';

// Recorded from the keyless testnet host (mainnet needs PREDICTFUN_API_KEY); same API.
// Refresh with: RECORD_FIXTURES=1 pnpm --filter @paras/adapters test
const adapter = createPredictFunAdapter({
  apiUrl: 'https://api-testnet.predict.fun',
  fetch: fixtures('predictfun'),
  now: NOW,
});

describe('predict-fun adapter (fixture replay)', () => {
  it('meets the Venue adapter contract', async () => {
    const { page } = await checkVenue(adapter, {
      venueId: 'predict-fun',
      limit: 10,
      url: /^https:\/\/predict\.fun\//,
      history: true,
    });
    expect(page.nextCursor).toBeTruthy();
  });

  it('derives the NO Outcome as the mirror of the YES book', async () => {
    const [m] = (await adapter.listMarkets({ limit: 10 })).items;
    const [yes, no] = await adapter.fetchQuotes(m!.outcomes.map((o) => o.externalId));
    expect(Number(no!.ask)).toBeCloseTo(1 - Number(yes!.bid), 6);
    expect(Number(no!.bid)).toBeCloseTo(1 - Number(yes!.ask), 6);
  });

  it('is only registered when PREDICTFUN_API_KEY is set', () => {
    const ids = (env: Record<string, string>) => longTailAdaptersFromEnv(env).map((a) => a.id);
    expect(ids({})).not.toContain('predict-fun');
    expect(ids({ PREDICTFUN_API_KEY: 'k' })).toContain('predict-fun');
  });
});
