import { inject } from 'vitest';
import './context.js';
import { adminExec, randomName, withDatabase } from './pg-admin.js';

export interface TestDatabase {
  /** Connection string for a fresh, fully migrated database owned by this test file. */
  url: string;
  drop(): Promise<void>;
}

/** Clone the migrated template into a private database. Call in beforeAll, `drop` in afterAll. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const { adminUrl, template } = inject('parasDb');
  const name = randomName('paras_t');
  await adminExec(adminUrl, `CREATE DATABASE ${name} TEMPLATE ${template}`);
  return {
    url: withDatabase(adminUrl, name),
    drop: () => adminExec(adminUrl, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
  };
}
