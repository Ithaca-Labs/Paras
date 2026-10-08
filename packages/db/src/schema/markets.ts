import type { FeeSchedule, MarketStatus, VenueCapabilities } from '@paras/shared';
import {
  bigserial,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** A prediction market platform. Rows are upserted from adapter capabilities on sync. */
export const venues = pgTable('venues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  capabilities: jsonb('capabilities').$type<VenueCapabilities>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** One tradeable question on one Venue. */
export const markets = pgTable(
  'markets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    venueId: text('venue_id')
      .notNull()
      .references(() => venues.id),
    externalId: text('external_id').notNull(),
    slug: text('slug'),
    question: text('question').notNull(),
    description: text('description').notNull().default(''),
    resolutionSource: text('resolution_source'),
    category: text('category'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    status: text('status').$type<MarketStatus>().notNull(),
    endDate: ts('end_date'),
    /** USD, decimal string. */
    volume: numeric('volume').notNull().default('0'),
    liquidity: numeric('liquidity').notNull().default('0'),
    imageUrl: text('image_url'),
    url: text('url').notNull(),
    fee: jsonb('fee').$type<FeeSchedule>().notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    syncedAt: ts('synced_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('markets_venue_external_uq').on(t.venueId, t.externalId),
    index('markets_venue_status_volume_idx').on(t.venueId, t.status, t.volume),
  ],
);

/** One side of a Market. `externalId` is the Venue-native outcome id (Polymarket: CLOB token id). */
export const outcomes = pgTable(
  'outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    label: text('label').notNull(),
    index: integer('index').notNull(),
  },
  (t) => [unique('outcomes_market_external_uq').on(t.marketId, t.externalId)],
);

/** Paras's canonical question. Starts as a single-Venue Event; matching (#6) merges Markets in. */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category'),
    status: text('status').$type<MarketStatus>().notNull(),
    endDate: ts('end_date'),
    imageUrl: text('image_url'),
    /** Sum of linked Markets' volume (USD), for ordering. */
    volume: numeric('volume').notNull().default('0'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('events_status_volume_idx').on(t.status, t.volume)],
);

/** Links a Market to an Event. A Market belongs to exactly one Event. */
export const eventMarkets = pgTable(
  'event_markets',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    marketId: uuid('market_id')
      .notNull()
      .unique()
      .references(() => markets.id, { onDelete: 'cascade' }),
    /** 0..1 confidence the Market is equivalent to the Event (1 for the seed Market). */
    confidence: numeric('confidence').notNull().default('1'),
    /** `same`: outcomes line up; `inverse`: Market's YES is the Event's NO. */
    direction: text('direction').$type<'same' | 'inverse'>().notNull().default('same'),
    source: text('source').$type<'auto' | 'operator'>().notNull().default('auto'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.marketId] })],
);

/** Most recent Quote per Outcome. Hot read path for the API and SSE. */
export const latestQuotes = pgTable('latest_quotes', {
  outcomeId: uuid('outcome_id')
    .primaryKey()
    .references(() => outcomes.id, { onDelete: 'cascade' }),
  bid: numeric('bid'),
  ask: numeric('ask'),
  last: numeric('last'),
  bidDepth: numeric('bid_depth').notNull(),
  askDepth: numeric('ask_depth').notNull(),
  observedAt: ts('observed_at').notNull(),
});

/** Rolling Quote history for charts. Written when the Quote changed or the last one is old. */
export const quoteSnapshots = pgTable(
  'quote_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    outcomeId: uuid('outcome_id')
      .notNull()
      .references(() => outcomes.id, { onDelete: 'cascade' }),
    bid: numeric('bid'),
    ask: numeric('ask'),
    last: numeric('last'),
    bidDepth: numeric('bid_depth').notNull(),
    askDepth: numeric('ask_depth').notNull(),
    observedAt: ts('observed_at').notNull(),
  },
  (t) => [index('quote_snapshots_outcome_time_idx').on(t.outcomeId, t.observedAt)],
);
