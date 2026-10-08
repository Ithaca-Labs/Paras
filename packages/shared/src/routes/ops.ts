import { defineRoute } from '../route.js';
import { z } from '../zod.js';

const tags = ['admin'];

export const VenueHealth = z.object({
  venueId: z.string(),
  name: z.string(),
  /** `stale`: newest Quote older than `staleAfterSeconds`; `erroring`: last worker run failed; `no_data`: no Quotes yet. */
  status: z.enum(['ok', 'stale', 'erroring', 'no_data']),
  lastQuoteAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  /** Worker runs (market syncs + quote polls) in the last 24h. */
  runs24h: z.number().int(),
  errors24h: z.number().int(),
  /** errors24h / runs24h; 0 with no runs. */
  errorRate: z.number(),
});
export type VenueHealth = z.infer<typeof VenueHealth>;

export const getVenueHealth = defineRoute({
  method: 'get',
  path: '/v1/admin/venues/health',
  operationId: 'getVenueHealth',
  summary: 'Per-Venue health: Quote freshness, worker error rate, last success. Admin only',
  tags,
  request: {},
  response: z.object({ staleAfterSeconds: z.number().int(), items: z.array(VenueHealth) }),
});

export const ExecutorPause = z.object({
  /** `global` or a Venue id. */
  scope: z.string(),
  reason: z.string(),
  pausedAt: z.iso.datetime(),
});

export const getPauses = defineRoute({
  method: 'get',
  path: '/v1/admin/pauses',
  operationId: 'getPauses',
  summary:
    'Active Executor dispatch pauses plus the Vault on-chain pause (null when the chain is not configured). On-chain pause is multisig-only. Admin only',
  tags,
  request: {},
  response: z.object({
    items: z.array(ExecutorPause),
    vaultPaused: z.boolean().nullable(),
  }),
});

const scope = z.object({ scope: z.string().min(1).max(100) });

export const pauseExecutor = defineRoute({
  method: 'put',
  path: '/v1/admin/pauses/{scope}',
  operationId: 'pauseExecutor',
  summary:
    'Pause new Intent dispatches globally (`global`) or for one Venue. In-flight Intents keep settling; signed ones wait (and still expire). Admin only',
  tags,
  request: { params: scope, body: z.object({ reason: z.string().min(1).max(500) }) },
  response: ExecutorPause,
});

export const unpauseExecutor = defineRoute({
  method: 'delete',
  path: '/v1/admin/pauses/{scope}',
  operationId: 'unpauseExecutor',
  summary: 'Lift a pause; held Intents dispatch on the next tick. Admin only',
  tags,
  request: { params: scope },
  response: z.object({ removed: z.boolean() }),
});
