import type { FeeSchedule, MarketStatus, VenueCapabilities } from '@paras/shared';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  customType,
  doublePrecision,
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
  vector,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS } from '@paras/domain';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

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
    /** Sum of linked Markets' liquidity (USD). */
    liquidity: numeric('liquidity').notNull().default('0'),
    /** Largest absolute price change of any Outcome over ~24h (0..1). Refreshed by the worker. */
    move24h: numeric('move_24h').notNull().default('0'),
    /** Heuristic trending score (domain `trendingScore`). Refreshed by the worker. */
    trendingScore: doublePrecision('trending_score').notNull().default(0),
    /** Sentence embedding of title + description; null until enriched. */
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    /** md5(title || '\n' || description) at embedding time; a mismatch means re-embed. */
    embeddedHash: text('embedded_hash'),
    /** `embedded_hash` when matching last scanned this Event as a seed; a mismatch means re-scan. */
    matchedHash: text('matched_hash'),
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', description), 'B')`,
    ),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('events_status_volume_idx').on(t.status, t.volume),
    index('events_search_tsv_idx').using('gin', t.searchTsv),
    index('events_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

/** Taxonomy tags on an Event (category, topic, entity). Ids come from `TAXONOMY` in @paras/domain. */
export const eventTags = pgTable(
  'event_tags',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    tagId: text('tag_id').notNull(),
    kind: text('kind').$type<'category' | 'topic' | 'entity'>().notNull(),
    score: numeric('score').notNull(),
    source: text('source').$type<'venue' | 'keyword' | 'embedding'>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.tagId] }), index('event_tags_tag_idx').on(t.tagId)],
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
    /** Multi-outcome Events: the candidate this binary Market's YES stands for (e.g. "Alice"). */
    candidate: text('candidate'),
    source: text('source').$type<'auto' | 'operator'>().notNull().default('auto'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.marketId] })],
);

/**
 * Operator review queue: a medium-confidence proposal to link `marketId` into `eventId`.
 * Rejected rows stay as tombstones so matching never proposes the pair again.
 */
export const matchReviews = pgTable(
  'match_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    marketId: uuid('market_id')
      .notNull()
      .references(() => markets.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    confidence: numeric('confidence').notNull(),
    direction: text('direction').$type<'same' | 'inverse'>().notNull().default('same'),
    candidate: text('candidate'),
    status: text('status')
      .$type<'pending' | 'approved' | 'rejected'>()
      .notNull()
      .default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
    decidedAt: ts('decided_at'),
    decidedBy: uuid('decided_by'),
  },
  (t) => [
    unique('match_reviews_pair_uq').on(t.marketId, t.eventId),
    index('match_reviews_status_idx').on(t.status, t.confidence),
  ],
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
