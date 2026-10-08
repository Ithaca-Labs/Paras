/**
 * Placeholder. The real Venue adapter interface (markets, quotes, order book, history,
 * deep links, capabilities) is defined in issue #3 and replaces this shape.
 * Adapters take an injectable `fetch` so tests can replay fixtures (see @paras/testkit).
 */
export interface VenueAdapter {
  readonly id: string;
}

export type AdapterRegistry = ReadonlyMap<string, VenueAdapter>;

export function createAdapterRegistry(adapters: readonly VenueAdapter[] = []): AdapterRegistry {
  return new Map(adapters.map((a) => [a.id, a]));
}
