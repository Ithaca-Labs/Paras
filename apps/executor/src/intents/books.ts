import type { AdapterRegistry } from '@paras/adapters';
import { schema, type Database } from '@paras/db';
import { eq } from 'drizzle-orm';
import type { BookSource } from './ports.js';

/** Live asks from the Venue adapter plus the Market's fee model; `negRisk` comes from the Market's venue meta. */
export function createBookSource(db: Database, adapters: AdapterRegistry): BookSource {
  return {
    async asks(d) {
      const [m] = await db
        .select({ fee: schema.markets.fee, meta: schema.markets.meta })
        .from(schema.markets)
        .where(eq(schema.markets.id, d.marketId));
      if (!m) throw new Error(`unknown market ${d.marketId}`);
      const [book] = (await adapters.get(d.venueId)?.fetchOrderBooks?.([d.tokenId])) ?? [];
      return { asks: book?.asks ?? [], fee: m.fee, negRisk: m.meta.negRisk === true };
    },
  };
}
