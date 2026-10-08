import {
  alignSeries,
  bookToQuote,
  isStale,
  midSpread,
  pickBest,
  priceQuote,
  type BookLevel,
} from '@paras/domain';
import { apiRoutes, type EventComparison, type EventHistory, type OrderBook } from '@paras/shared';
import { QUOTE_STALE_AFTER_MS } from '../deps.js';
import { HttpError, notFound } from '../errors.js';
import { fetchBooks } from '../events/books.js';
import { loadOutcomeGroups } from '../events/compare.js';
import { eventExists } from '../events/queries.js';
import { implement } from '../implement.js';
import type { RoutePlugin } from './index.js';

const GRID_POINTS = 60;
const INTERVAL_MINUTES = { '1h': 60, '6h': 360, '1d': 1440, '1w': 10_080, '1m': 43_200 } as const;

export const compareRoutes: RoutePlugin = (app, { db, adapters, now = () => new Date() }) => {
  async function groupsOr404(eventId: string) {
    const groups = await loadOutcomeGroups(db, eventId);
    if (!groups.size && !(await eventExists(db, eventId))) throw notFound('Event');
    return groups;
  }

  implement(app, apiRoutes.compareEvent, async ({ params, query }) => {
    const { stake, divergenceThreshold } = query;
    const groups = await groupsOr404(params.id);
    const books = stake
      ? await fetchBooks(adapters, [...groups.values()].flat(), (err, venueId) =>
          app.log.warn({ err, venueId }, 'order book fetch failed'),
        )
      : new Map<string, OrderBook>();
    const asOf = now();

    const outcomesView: EventComparison['outcomes'] = [...groups.values()].map((rows) => {
      const entries = rows.map((r) => {
        const book = books.get(`${r.venue.id}|${r.outcome.externalId}`);
        let live: ReturnType<typeof bookToQuote> | null = null;
        try {
          live = book ? bookToQuote(book) : null;
        } catch {
          // crossed book from the Venue: fall back to the stored Quote
        }
        const src = live
          ? {
              bid: live.bid,
              ask: live.ask,
              askDepth: live.askDepth,
              at: new Date(book!.observedAt),
            }
          : r.quote && { ...r.quote, at: r.quote.observedAt };
        const asks: BookLevel[] | undefined = live ? book!.asks : undefined;
        const priced = priceQuote(
          { bid: src?.bid ?? null, ask: src?.ask ?? null, fee: r.market.fee, asks },
          stake,
        );
        const stale =
          r.market.status !== 'open' || !src || isStale(src.at, asOf, QUOTE_STALE_AFTER_MS);
        return { r, src, priced, stale };
      });

      const best = pickBest(
        entries.map((e) => ({ eligible: !e.stale && !!e.src?.ask, priced: e.priced })),
        stake,
      );
      const { spread, divergent } = midSpread(
        entries.flatMap((e) => (!e.stale && e.priced.mid ? [e.priced.mid] : [])),
        divergenceThreshold,
      );
      return {
        label: rows[0]!.label,
        venues: entries.map(({ r, src, priced, stale }) => ({
          venue: { id: r.venue.id, name: r.venue.name },
          routable: r.venue.capabilities.routable,
          marketId: r.market.id,
          outcomeId: r.outcome.id,
          redirectUrl: r.market.url,
          matchConfidence: r.link.confidence,
          bid: src?.bid ?? null,
          ask: src?.ask ?? null,
          askDepth: src?.askDepth ?? '0',
          feePerShare: priced.feePerShare,
          effectiveAsk: priced.effectiveAsk,
          fill: priced.fill,
          stale,
          observedAt: src?.at.toISOString() ?? null,
        })),
        best:
          best === null
            ? null
            : { marketId: entries[best]!.r.market.id, outcomeId: entries[best]!.r.outcome.id },
        spread,
        divergent,
      };
    });

    return {
      eventId: params.id,
      stake: stake ?? null,
      divergenceThreshold,
      asOf: asOf.toISOString(),
      outcomes: outcomesView,
    };
  });

  implement(app, apiRoutes.getEventHistory, async ({ params, query }) => {
    const groups = await groupsOr404(params.id);
    const labels = [...groups.values()].map((rows) => rows[0]!.label);
    const wanted = query.outcome?.trim().toLowerCase() ?? labels[0]?.toLowerCase();
    const rows = (wanted && groups.get(wanted)) || [];
    if (query.outcome && !rows.length) {
      throw new HttpError(400, 'validation_error', `unknown outcome; one of: ${labels.join(', ')}`);
    }

    const bucketMinutes = Math.ceil(INTERVAL_MINUTES[query.interval] / GRID_POINTS);
    const step = bucketMinutes * 60_000;
    const end = Math.floor(now().getTime() / step) * step;
    const grid = Array.from({ length: GRID_POINTS }, (_, i) => end - (GRID_POINTS - 1 - i) * step);

    const series = await Promise.all(
      rows.map(async (r) => {
        let prices: (string | null)[] = grid.map(() => null);
        try {
          const points = await adapters.get(r.venue.id)?.fetchPriceHistory(r.outcome.externalId, {
            interval: query.interval,
            fidelityMinutes: bucketMinutes,
          });
          prices = alignSeries(
            (points ?? []).map((p) => ({ ts: Date.parse(p.ts), price: p.price })),
            grid,
          );
        } catch (err) {
          app.log.warn({ err, venueId: r.venue.id }, 'price history fetch failed');
        }
        return { venueId: r.venue.id, marketId: r.market.id, prices };
      }),
    );

    const view: EventHistory = {
      eventId: params.id,
      outcome: rows[0]?.label ?? '',
      outcomes: labels,
      interval: query.interval,
      bucketMinutes,
      timestamps: grid.map((t) => new Date(t).toISOString()),
      series,
    };
    return view;
  });
};
