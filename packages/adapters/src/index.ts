export { createAdapterRegistry, type AdapterRegistry } from './registry.js';
export type { ListMarketsParams, Page, PriceHistoryParams, VenueAdapter } from './types.js';
export {
  createFakeAdapter,
  fakeMarket,
  type FakeAdapter,
  type FakeAdapterOptions,
} from './fake.js';
export { createPolymarketAdapter, type PolymarketOptions } from './polymarket/index.js';
export { createLimitlessAdapter, type LimitlessOptions } from './limitless/index.js';
export { createSxBetAdapter, type SxBetOptions } from './sxbet/index.js';
export { toDecimalString } from './decimal.js';
