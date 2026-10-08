import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid, vector } from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS } from '@paras/domain';
import { users } from './identity.js';

const tags = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

/**
 * One Interest Profile per User, or per anonymous visitor (`anonTokenHash`) until sign-in merges it
 * into the User. `embedding` is the unit profile vector (see `profileVector` in @paras/domain).
 * Tag ids are taxonomy node ids.
 */
export const interestProfiles = pgTable('interest_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .unique()
    .references(() => users.id),
  /** sha256 of the anonymous profile token; null once owned by a User. */
  anonTokenHash: text('anon_token_hash').unique(),
  /** 'completed' | 'skipped'. No row = never onboarded. */
  status: text('status').notNull(),
  categories: tags('categories'),
  topics: tags('topics'),
  entities: tags('entities'),
  freeText: tags('free_text'),
  experience: text('experience'),
  riskAppetite: text('risk_appetite'),
  stakeSize: text('stake_size'),
  horizon: text('horizon'),
  embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
