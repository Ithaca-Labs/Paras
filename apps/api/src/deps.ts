import type { AdapterRegistry } from '@paras/adapters';
import type { Database } from '@paras/db';
import type { AuthDeps } from './auth/types.js';

/** Everything routes may touch. Tests build this with a fresh DB and fake adapters. */
export interface AppDeps {
  db: Database;
  adapters: AdapterRegistry;
  auth: AuthDeps;
}
