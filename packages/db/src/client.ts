import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDb(connectionString: string): DbHandle {
  const pool = new pg.Pool({ connectionString });
  // Idle clients can die (DB restart, admin terminate); without a listener pg crashes the process. Pool replaces them.
  pool.on('error', (err) => console.error('pg pool: idle client error', err.message));
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
