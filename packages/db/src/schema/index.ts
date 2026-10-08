// One file per domain area (markets.ts, quotes.ts, ...), re-exported here.
// Then: `pnpm db:generate` and commit the new SQL in packages/db/drizzle.
export * from './identity.js';
export * from './markets.js';
export * from './magic-links.js';
export * from './deposit-wallets.js';
export * from './interest-profiles.js';
export * from './feed.js';
export * from './notifications.js';
