import { schema, type Database } from '@paras/db';
import { TERMINAL_INTENT_STATUSES } from '@paras/domain';
import { eq, notInArray } from 'drizzle-orm';
import PgBoss from 'pg-boss';
import type { IntentEngine } from './engine.js';
import type { VaultChain } from './ports.js';

const { chainCursors, intents } = schema;
const QUEUE = 'intent.step';
const CURSOR = 'monad-vault';

/** Applies new Vault events to the Intent table; the cursor moves only after they were applied (events are idempotent). */
export async function pollVault(
  db: Database,
  vault: VaultChain,
  engine: IntentEngine,
  startBlock: bigint,
): Promise<number> {
  const [cur] = await db.select().from(chainCursors).where(eq(chainCursors.name, CURSOR));
  const from = cur ? BigInt(cur.block) + 1n : startBlock;
  const { events, toBlock } = await vault.events(from);
  for (const ev of events) await engine.onVaultEvent(ev);
  if (toBlock >= from)
    await db
      .insert(chainCursors)
      .values({ name: CURSOR, block: toBlock.toString() })
      .onConflictDoUpdate({ target: chainCursors.name, set: { block: toBlock.toString() } });
  return events.length;
}

/**
 * Drives Intents with pg-boss: a tick polls the Vault, then enqueues one `intent.step` job per live Intent
 * (singleton per Intent, so ticks never pile up). All progress lives in Postgres, so a restart just resumes.
 */
export function createRunner(o: {
  db: Database;
  databaseUrl: string;
  vault: VaultChain;
  engine: IntentEngine;
  startBlock: bigint;
  tickMs?: number;
  /** Extra work each tick (e.g. wallet request sync). */
  onTick?: () => Promise<void>;
  log?: (msg: string, data?: object) => void;
}) {
  const boss = new PgBoss(o.databaseUrl);
  boss.on('error', (err) => o.log?.('pg-boss error', { err }));
  let timer: NodeJS.Timeout | undefined;

  async function tick() {
    try {
      await o.onTick?.();
      await pollVault(o.db, o.vault, o.engine, o.startBlock);
      const live = await o.db
        .select({ id: intents.id, status: intents.status })
        .from(intents)
        .where(notInArray(intents.status, [...TERMINAL_INTENT_STATUSES, 'previewed']));
      for (const { id } of live)
        await boss.send(QUEUE, { id }, { singletonKey: id, singletonSeconds: 5 });
    } catch (err) {
      o.log?.('intent tick failed', { err });
    }
  }

  return {
    tick,
    async start() {
      await boss.start();
      await boss.createQueue(QUEUE);
      await boss.work(QUEUE, async (batch) => {
        // A throw makes pg-boss retry the job; the state machine is safe to re-enter.
        for (const { data } of batch) await o.engine.run((data as { id: string }).id);
      });
      timer = setInterval(() => void tick(), o.tickMs ?? 10_000);
    },
    async stop() {
      if (timer) clearInterval(timer);
      await boss.stop();
    },
  };
}
