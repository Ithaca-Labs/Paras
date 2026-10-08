import type { AdapterRegistry } from '@paras/adapters';
import {
  listPollTargets,
  recordQuotes,
  upsertMarkets,
  upsertVenue,
  type Database,
} from '@paras/db';
import { z } from '@paras/shared';
import { defineJob } from './define.js';

export interface VenueJobContext {
  db: Database;
  adapters: AdapterRegistry;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const PAGE_SIZE = 500;
const QUOTE_BATCH = 200;

export const VenueSyncPayload = z.object({
  venue: z.string(),
  /** Cap on Markets pulled per run (highest volume first). */
  maxMarkets: z.number().int().positive().default(2000),
});

export const QuotePollPayload = z.object({
  venue: z.string(),
  /** Poll the top N open Markets by volume. */
  topMarkets: z.number().int().positive().default(200),
});

/** Metadata sync: page through a Venue's open Markets and upsert Markets, Outcomes and seed Events. */
export function createSyncMarketsJob({ db, adapters, log }: VenueJobContext) {
  return defineJob({
    name: 'venue.sync-markets',
    payload: VenueSyncPayload,
    handler: async ({ venue, maxMarkets }) => {
      const adapter = adapters.get(venue);
      if (!adapter) throw new Error(`unknown venue: ${venue}`);
      await upsertVenue(db, adapter);
      let cursor: string | undefined;
      let total = 0;
      do {
        const page = await adapter.listMarkets({
          cursor,
          limit: Math.min(PAGE_SIZE, maxMarkets - total),
        });
        total += await upsertMarkets(db, page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && total < maxMarkets);
      log?.('markets synced', { venue, total });
    },
  });
}

/**
 * Quote polling: fetch books for the highest-volume open Markets and persist Quotes.
 * V1 polls once per scheduled run (every minute); WebSocket streaming can replace it later.
 */
export function createPollQuotesJob({ db, adapters, log }: VenueJobContext) {
  return defineJob({
    name: 'venue.poll-quotes',
    payload: QuotePollPayload,
    handler: async ({ venue, topMarkets }) => {
      const adapter = adapters.get(venue);
      if (!adapter) throw new Error(`unknown venue: ${venue}`);
      const targets = await listPollTargets(db, venue, topMarkets);
      let updated = 0;
      let snapshots = 0;
      for (let i = 0; i < targets.length; i += QUOTE_BATCH) {
        const quotes = await adapter.fetchQuotes(targets.slice(i, i + QUOTE_BATCH));
        const r = await recordQuotes(db, venue, quotes);
        updated += r.updated;
        snapshots += r.snapshots;
      }
      log?.('quotes polled', { venue, outcomes: targets.length, updated, snapshots });
    },
  });
}
