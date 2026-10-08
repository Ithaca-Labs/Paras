import { apiRoutes, sseRoutes } from '@paras/shared';
import { QUOTE_STALE_AFTER_MS } from '../deps.js';
import { HttpError, notFound } from '../errors.js';
import { eventExists, listEventIds, loadEventQuotes, loadEventViews } from '../events/queries.js';
import { implement, implementSse } from '../implement.js';
import type { RoutePlugin } from './index.js';

const DEFAULT_SSE_POLL_MS = 2000;

export const eventRoutes: RoutePlugin = (app, { db, now = () => new Date(), ssePollMs }) => {
  implement(app, apiRoutes.listEvents, async ({ query }) => {
    const offset = Number(query.cursor ?? 0);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new HttpError(400, 'validation_error', 'invalid cursor');
    }
    const ids = await listEventIds(db, {
      status: query.status,
      venue: query.venue,
      limit: query.limit,
      offset,
    });
    const page = ids.slice(0, query.limit);
    return {
      items: await loadEventViews(db, page, now(), QUOTE_STALE_AFTER_MS),
      nextCursor: ids.length > query.limit ? String(offset + query.limit) : null,
    };
  });

  implement(app, apiRoutes.getEvent, async ({ params }) => {
    const [event] = await loadEventViews(db, [params.id], now(), QUOTE_STALE_AFTER_MS);
    if (!event) throw notFound('Event');
    return event;
  });

  // Live Quotes: the worker writes latest_quotes; each stream re-reads the Event's rows every
  // `ssePollMs` and pushes the ones whose observedAt moved. No cross-process pub/sub needed in V1.
  implementSse(app, sseRoutes.streamEventQuotes, async ({ params }) => {
    if (!(await eventExists(db, params.id))) throw notFound('Event');
    return (emit) => {
      const seen = new Map<string, string>();
      let stopped = false;
      let timer: NodeJS.Timeout | undefined;
      const tick = async () => {
        try {
          for (const msg of await loadEventQuotes(db, params.id)) {
            if (seen.get(msg.outcomeId) === msg.quote.observedAt) continue;
            seen.set(msg.outcomeId, msg.quote.observedAt);
            emit('quote', msg);
          }
        } catch (err) {
          app.log.error({ err }, 'quote stream poll failed');
        } finally {
          if (!stopped) timer = setTimeout(() => void tick(), ssePollMs ?? DEFAULT_SSE_POLL_MS);
        }
      };
      void tick();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    };
  });
};
