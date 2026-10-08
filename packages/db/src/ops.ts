import { inArray } from 'drizzle-orm';
import type { Database } from './client.js';
import { executorPauses, venueRuns } from './schema/ops.js';

/** Runs a worker job body and records the outcome for Venue health; rethrows so pg-boss still retries. */
export async function withVenueRun<T>(
  db: Database,
  venueId: string,
  kind: 'markets' | 'quotes',
  fn: () => Promise<T>,
): Promise<T> {
  const record = (error: string | null) =>
    db
      .insert(venueRuns)
      .values({ venueId, kind, ok: error === null, error })
      .catch(() => {}); // health bookkeeping must never fail the job
  try {
    const r = await fn();
    await record(null);
    return r;
  } catch (err) {
    await record((err instanceof Error ? err.message : String(err)).slice(0, 500));
    throw err;
  }
}

/** True when new dispatches are paused globally or for this Venue. In-flight Intents are unaffected. */
export async function isDispatchPaused(db: Database, venueId: string): Promise<boolean> {
  const rows = await db
    .select({ s: executorPauses.scope })
    .from(executorPauses)
    .where(inArray(executorPauses.scope, ['global', venueId]))
    .limit(1);
  return rows.length > 0;
}
