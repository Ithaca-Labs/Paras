import { fileURLToPath } from 'node:url';
import { migrate as run } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

/** Applies all pending migrations from packages/db/drizzle. Source-only (not for bundled apps). */
export async function migrate(connectionString: string): Promise<void> {
  const { db, close } = createDb(connectionString);
  try {
    await run(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  } finally {
    await close();
  }
}
