import type { JobDefinition } from './define.js';
import { systemPing } from './system-ping.js';

/** Register new jobs here (one file per job; Venue sync, matching, alerts, ...). */
export const jobs: JobDefinition[] = [systemPing as JobDefinition];
