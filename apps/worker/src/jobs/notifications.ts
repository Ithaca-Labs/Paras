import { notify, schema, type Database, type NotifyMailer } from '@paras/db';
import {
  DEFAULT_ALERT_THRESHOLDS,
  detectAlerts,
  digestPicks,
  weekKey,
  type FeedCandidate,
} from '@paras/domain';
import { z } from '@paras/shared';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { defineJob } from './define.js';

export interface NotifyJobContext {
  db: Database;
  /** Omit and only in-app notifications are raised. */
  mailer?: NotifyMailer;
  now?: () => Date;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

const { events, eventTags, follows, interestProfiles } = schema;
const WEEK_MS = 7 * 24 * 3600_000;

export const AlertScanPayload = z.object({
  /** Absolute 24h price move (0..1) that counts as sharp. */
  moveThreshold: z.number().min(0).max(1).default(DEFAULT_ALERT_THRESHOLDS.moveThreshold),
  closingWithinHours: z.number().positive().default(DEFAULT_ALERT_THRESHOLDS.closingWithinHours),
});

/** Sharp-move + nearing-resolution alerts for followed open Events. Dedupe lives in `notify`. */
export function createAlertScanJob({ db, mailer, now = () => new Date(), log }: NotifyJobContext) {
  return defineJob({
    name: 'notify.scan-alerts',
    payload: AlertScanPayload,
    handler: async (thresholds) => {
      const at = now();
      const rows = await db
        .select({
          ownerKey: follows.ownerKey,
          id: events.id,
          title: events.title,
          move24h: events.move24h,
          endDate: events.endDate,
        })
        .from(follows)
        .innerJoin(events, eq(sql`${events.id}::text`, follows.targetId))
        .where(and(eq(follows.kind, 'event'), eq(events.status, 'open')));
      let sent = 0;
      for (const r of rows) {
        const alerts = detectAlerts({ ...r, move24h: Number(r.move24h) }, thresholds, at);
        for (const a of alerts) {
          if (await notify(db, mailer, { ownerKey: r.ownerKey, eventId: r.id, ...a }, at)) sent++;
        }
      }
      log?.('alerts scanned', { followed: rows.length, sent });
    },
  });
}

export const DigestPayload = z.object({ limit: z.number().int().positive().default(5) });

/** Weekly digest: new Events matching each completed Interest Profile. */
export function createDigestJob({ db, mailer, now = () => new Date(), log }: NotifyJobContext) {
  return defineJob({
    name: 'notify.weekly-digest',
    payload: DigestPayload,
    handler: async ({ limit }) => {
      const at = now();
      const fresh = await db
        .select()
        .from(events)
        .where(
          and(eq(events.status, 'open'), gt(events.createdAt, new Date(at.getTime() - WEEK_MS))),
        );
      if (!fresh.length) return;
      const tagRows = await db
        .select()
        .from(eventTags)
        .where(
          inArray(
            eventTags.eventId,
            fresh.map((e) => e.id),
          ),
        );
      const tagsOf = new Map<string, string[]>();
      for (const t of tagRows) tagsOf.set(t.eventId, [...(tagsOf.get(t.eventId) ?? []), t.tagId]);
      const candidates: FeedCandidate[] = fresh.map((e) => ({
        id: e.id,
        volume: Number(e.volume),
        liquidity: Number(e.liquidity),
        move24h: Number(e.move24h),
        trendingScore: e.trendingScore,
        endDate: e.endDate,
        createdAt: e.createdAt,
        tags: tagsOf.get(e.id) ?? [],
        embedding: e.embedding,
      }));
      const title = new Map(fresh.map((e) => [e.id, e.title]));

      const profiles = await db
        .select()
        .from(interestProfiles)
        .where(eq(interestProfiles.status, 'completed'));
      let sent = 0;
      for (const p of profiles) {
        const ownerKey = p.userId
          ? `u:${p.userId}`
          : p.anonTokenHash
            ? `a:${p.anonTokenHash}`
            : null;
        if (!ownerKey) continue;
        const picks = digestPicks(
          candidates,
          {
            embedding: p.embedding,
            picks: [...p.categories, ...p.topics, ...p.entities],
            experience: p.experience,
            riskAppetite: p.riskAppetite,
          },
          at,
          limit,
        );
        if (!picks.length) continue;
        const ok = await notify(
          db,
          mailer,
          {
            ownerKey,
            kind: 'digest',
            dedupeKey: weekKey(at),
            title: 'Your weekly Paras digest',
            body: `New Events for you:\n${picks.map((id) => `- ${title.get(id)}`).join('\n')}`,
          },
          at,
        );
        if (ok) sent++;
      }
      log?.('digest sent', { profiles: profiles.length, sent });
    },
  });
}
