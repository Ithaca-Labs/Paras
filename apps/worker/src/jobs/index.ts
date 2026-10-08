import type { JobDefinition } from './define.js';
import { createAlertScanJob, createDigestJob, type NotifyJobContext } from './notifications.js';
import { systemPing } from './system-ping.js';
import { createPollQuotesJob, createSyncMarketsJob, type VenueJobContext } from './venue-sync.js';

/** Register new jobs here (one file per job; Venue sync, matching, alerts, ...). */
export function buildJobs(
  ctx: VenueJobContext & Pick<NotifyJobContext, 'mailer' | 'now'>,
): JobDefinition[] {
  return [
    systemPing as JobDefinition,
    createSyncMarketsJob(ctx) as JobDefinition,
    createPollQuotesJob(ctx) as JobDefinition,
    createAlertScanJob(ctx) as JobDefinition,
    createDigestJob(ctx) as JobDefinition,
  ];
}

export interface Schedule {
  queue: string;
  cron: string;
  key: string;
  data: object;
}

/** Recurring work per Venue: metadata every 10 minutes, Quotes every minute (cron's floor). */
export function buildSchedules(venues: readonly string[]): Schedule[] {
  return [
    ...venues.flatMap((venue) => [
      { queue: 'venue.sync-markets', cron: '*/10 * * * *', key: venue, data: { venue } },
      { queue: 'venue.poll-quotes', cron: '* * * * *', key: venue, data: { venue } },
    ]),
    { queue: 'notify.scan-alerts', cron: '*/5 * * * *', key: 'all', data: {} },
    { queue: 'notify.weekly-digest', cron: '0 9 * * 1', key: 'all', data: {} },
  ];
}
