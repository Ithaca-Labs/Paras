import type { VenueAdapter } from './types.js';

export type AdapterRegistry = ReadonlyMap<string, VenueAdapter>;

export function createAdapterRegistry(adapters: readonly VenueAdapter[] = []): AdapterRegistry {
  return new Map(adapters.map((a) => [a.id, a]));
}
