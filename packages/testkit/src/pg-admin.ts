import pg from 'pg';

export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** Run admin SQL (CREATE/DROP DATABASE) on a short-lived connection. */
export async function adminExec(adminUrl: string, sql: string): Promise<void> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export const randomName = (prefix: string) =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
