import {
  createPolymarketQuoteStream,
  type QuoteStream,
  type QuoteStreamOptions,
} from '@paras/adapters';
import { listPollTargets, recordQuotes, type Database } from '@paras/db';

export interface QuoteStreamContext {
  db: Database;
  log?: (msg: string, data?: Record<string, unknown>) => void;
  /** Test seam: fake socket / fast timers. */
  streamOptions?: Partial<QuoteStreamOptions>;
}

/**
 * Streams the top Polymarket Outcomes over the CLOB WebSocket into latest_quotes (snapshot
 * history stays throttled inside recordQuotes). `covers` lets venue.poll-quotes skip whatever the
 * socket already serves, so polling is the automatic fallback when it is down.
 */
export function startPolymarketStream(
  { db, log, streamOptions }: QuoteStreamContext,
  { topMarkets = 200, refreshMs = 60_000 } = {},
) {
  const venue = 'polymarket';
  const stream: QuoteStream = createPolymarketQuoteStream({
    onQuotes: (quotes) => recordQuotes(db, venue, quotes).then(() => undefined),
    onError: (e) => log?.('quote stream error', { err: String(e) }),
    ...streamOptions,
  });
  const refresh = async () => {
    try {
      stream.setAssets(await listPollTargets(db, venue, topMarkets));
    } catch (e) {
      log?.('quote stream targets failed', { err: String(e) });
    }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), refreshMs);
  return {
    covers: (v: string, id: string) => v === venue && stream.covers(id),
    refresh,
    stop() {
      clearInterval(timer);
      stream.stop();
    },
  };
}
