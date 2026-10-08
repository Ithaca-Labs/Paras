import { cosine } from './embedding.js';
import { rankFeed, type FeedCandidate, type FeedProfile } from './feed.js';

export const NOTIFICATION_KINDS = [
  'price_move',
  'closing_soon',
  'digest',
  'intent_update',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const NOTIFICATION_FREQUENCIES = ['instant', 'daily', 'weekly', 'off'] as const;
export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

export interface NotificationPrefs {
  email: boolean;
  inApp: boolean;
  /** Minimum gap between alerts (price_move / closing_soon); `off` mutes alerts and the digest. */
  frequency: NotificationFrequency;
}
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  email: true,
  inApp: true,
  frequency: 'instant',
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
export const ALERT_KINDS: readonly NotificationKind[] = ['price_move', 'closing_soon'];
const ALERT_GAP: Record<NotificationFrequency, number> = {
  instant: 0,
  daily: DAY,
  weekly: WEEK,
  off: Infinity,
};

/**
 * Channels to deliver on, or null to skip. Transactional kinds (`intent_update`) ignore frequency;
 * alerts are rate-limited by `frequency` against the owner's last alert; the digest only needs != off.
 */
export function deliveryChannels(
  kind: NotificationKind,
  prefs: NotificationPrefs,
  lastAlertAt: Date | null,
  now: Date,
): { email: boolean; inApp: boolean } | null {
  if (!prefs.email && !prefs.inApp) return null;
  if (kind !== 'intent_update' && prefs.frequency === 'off') return null;
  if (
    ALERT_KINDS.includes(kind) &&
    lastAlertAt &&
    now.getTime() - lastAlertAt.getTime() < ALERT_GAP[prefs.frequency]
  ) {
    return null;
  }
  return { email: prefs.email, inApp: prefs.inApp };
}

export interface AlertThresholds {
  /** Absolute 24h price move (0..1) that counts as sharp. */
  moveThreshold: number;
  /** Alert when the Event ends within this many hours. */
  closingWithinHours: number;
}
export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  moveThreshold: 0.1,
  closingWithinHours: 24,
};

export interface AlertEvent {
  id: string;
  title: string;
  move24h: number;
  endDate: Date | null;
}
export interface AlertDraft {
  kind: 'price_move' | 'closing_soon';
  /** Same key = same alert: one per Event per UTC day for moves, once for closing. */
  dedupeKey: string;
  title: string;
  body: string;
}

/** Alerts an open followed Event currently warrants. Pure; `now` injected. */
export function detectAlerts(e: AlertEvent, t: AlertThresholds, now: Date): AlertDraft[] {
  const out: AlertDraft[] = [];
  if (e.move24h >= t.moveThreshold) {
    out.push({
      kind: 'price_move',
      dedupeKey: `move:${e.id}:${now.toISOString().slice(0, 10)}`,
      title: `Sharp move: ${e.title}`,
      body: `A price moved ${Math.round(e.move24h * 100)} points in the last 24h.`,
    });
  }
  const left = e.endDate ? e.endDate.getTime() - now.getTime() : -1;
  if (e.endDate && left > 0 && left <= t.closingWithinHours * HOUR) {
    out.push({
      kind: 'closing_soon',
      dedupeKey: `closing:${e.id}`,
      title: `Closing soon: ${e.title}`,
      body: `Resolves ${e.endDate.toISOString()}.`,
    });
  }
  return out;
}

/** Stable id of the week containing `now`, for digest dedupe. */
export const weekKey = (now: Date) => `digest:${Math.floor(now.getTime() / WEEK)}`;

/** Digest content: new Events that match the Interest Profile (a picked tag, or similar embedding), best first. */
export function digestPicks(
  candidates: readonly FeedCandidate[],
  profile: FeedProfile,
  now: Date,
  limit = 5,
): string[] {
  const matches = (c: FeedCandidate) =>
    c.tags.some((t) => profile.picks.includes(t)) ||
    (!!profile.embedding && !!c.embedding && cosine(profile.embedding, c.embedding) >= 0.5);
  return rankFeed({
    candidates: candidates.filter(matches),
    profile,
    signals: [],
    follows: { events: new Set(), tags: new Set() },
    now,
  })
    .slice(0, limit)
    .map((e) => e.eventId);
}
