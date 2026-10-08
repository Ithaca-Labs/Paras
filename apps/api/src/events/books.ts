import type { AdapterRegistry } from '@paras/adapters';
import type { OrderBook } from '@paras/shared';
import type { CompareRow } from './compare.js';

/** Live books for open Markets, keyed `venue|outcomeExternalId`. A failing Venue is skipped. */
export async function fetchBooks(
  adapters: AdapterRegistry,
  rows: CompareRow[],
  onError: (err: unknown, venueId: string) => void,
): Promise<Map<string, OrderBook>> {
  const byVenue = new Map<string, string[]>();
  for (const r of rows) {
    if (r.market.status !== 'open') continue;
    byVenue.set(r.venue.id, [...(byVenue.get(r.venue.id) ?? []), r.outcome.externalId]);
  }
  const books = new Map<string, OrderBook>();
  await Promise.all(
    [...byVenue].map(async ([venueId, ids]) => {
      try {
        for (const b of (await adapters.get(venueId)?.fetchOrderBooks?.(ids)) ?? []) {
          books.set(`${venueId}|${b.outcomeExternalId}`, b);
        }
      } catch (err) {
        onError(err, venueId);
      }
    }),
  );
  return books;
}
