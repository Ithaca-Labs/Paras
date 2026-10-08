import { schema, type Database } from '@paras/db';
import { eq, sql } from 'drizzle-orm';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Hand all Feed state of `from` to `to` (sign-in claims an anonymous visitor; mergeUsers). */
export async function moveFeedState(tx: Tx, from: string, to: string) {
  const { follows, feedSignals } = schema;
  await tx.execute(sql`
    insert into follows (owner_key, kind, target_id, created_at)
    select ${to}, kind, target_id, created_at from follows where owner_key = ${from}
    on conflict do nothing`);
  await tx.delete(follows).where(eq(follows.ownerKey, from));
  await tx.update(feedSignals).set({ ownerKey: to }).where(eq(feedSignals.ownerKey, from));
}
