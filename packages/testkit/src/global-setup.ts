import { migrate } from '@paras/db';
import type { TestProject } from 'vitest/node';
import './context.js';
import { adminExec, randomName, withDatabase } from './pg-admin.js';

/**
 * Vitest globalSetup for suites that need Postgres.
 * Uses DATABASE_URL when set (CI service), else starts pgvector/pgvector:pg16 via testcontainers.
 * Migrates once into a template database; each test file clones it (see createTestDatabase).
 */
export default async function setup(project: TestProject) {
  let adminUrl = process.env.DATABASE_URL;
  let stopContainer: (() => Promise<void>) | undefined;

  if (!adminUrl) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    adminUrl = container.getConnectionUri();
    stopContainer = async () => void (await container.stop());
  }

  const template = randomName('paras_tpl');
  await adminExec(adminUrl, `CREATE DATABASE ${template}`);
  await migrate(withDatabase(adminUrl, template));
  project.provide('parasDb', { adminUrl, template });

  return async () => {
    if (stopContainer) return stopContainer();
    await adminExec(adminUrl, `DROP DATABASE IF EXISTS ${template}`);
  };
}
