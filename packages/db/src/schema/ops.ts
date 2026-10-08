import { bigserial, boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { venues } from './markets.js';

const tz = (name: string) => timestamp(name, { withTimezone: true });

/** One worker sync/poll attempt per Venue, for health (error rate, last success). */
export const venueRuns = pgTable(
  'venue_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    venueId: text('venue_id')
      .notNull()
      .references(() => venues.id),
    kind: text('kind').$type<'markets' | 'quotes'>().notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [index('venue_runs_venue_at_idx').on(t.venueId, t.at)],
);

/**
 * Operator pause of new Intent dispatches. `scope` is `global` or a Venue id. Shared by API and
 * Executor through Postgres; a row = paused.
 */
export const executorPauses = pgTable('executor_pauses', {
  scope: text('scope').primaryKey(),
  reason: text('reason').notNull(),
  pausedBy: uuid('paused_by').references(() => users.id),
  pausedAt: tz('paused_at').notNull().defaultNow(),
});
