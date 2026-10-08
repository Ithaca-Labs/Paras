import { createMyriadAdapter } from './myriad/index.js';
import { createNovigAdapter } from './novig/index.js';
import { createOpinionAdapter } from './opinion/index.js';
import { createPolymarketUsAdapter } from './polymarket-us/index.js';
import { createPredictFunAdapter } from './predictfun/index.js';
import { createProbableAdapter } from './probable/index.js';
import { createProphetXAdapter } from './prophetx/index.js';
import type { VenueAdapter } from './types.js';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Native long-tail Venue adapters for api + worker. Keyless Venues are always on; key-gated ones
 * (Predict.fun, ProphetX) are off while their key is unset, and a Venue failing at runtime only
 * fails its own sync jobs. Docs: docs/BLOCKERS.md, "Venue API keys".
 */
export function longTailAdaptersFromEnv(env: Env): VenueAdapter[] {
  const predictFunKey = env.PREDICTFUN_API_KEY;
  const prophetXKey = env.PROPHETX_API_KEY;
  return [
    createPolymarketUsAdapter(),
    createOpinionAdapter(),
    createMyriadAdapter({ apiKey: env.MYRIAD_API_KEY || undefined }),
    createProbableAdapter(),
    createNovigAdapter(),
    ...(predictFunKey
      ? [
          createPredictFunAdapter({
            apiKey: predictFunKey,
            apiUrl: env.PREDICTFUN_API_URL || undefined,
          }),
        ]
      : []),
    ...(prophetXKey
      ? [createProphetXAdapter({ apiKey: prophetXKey, apiUrl: env.PROPHETX_API_URL || undefined })]
      : []),
  ];
}
