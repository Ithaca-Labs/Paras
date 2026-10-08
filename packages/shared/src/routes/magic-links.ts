import { defineRoute } from '../route.js';
import { DecimalString, PriceString } from '../venue.js';
import { z } from '../zod.js';
import { EventView } from './events.js';

export const MagicLinkSource = z.enum(['claude', 'codex', 'web']);
export type MagicLinkSource = z.infer<typeof MagicLinkSource>;

const positive = (v: string) => Number(v) > 0;

export const CreateMagicLinkBody = z.object({
  eventId: z.string().uuid(),
  /** Outcome label, e.g. "Yes". Must exist on the Event. */
  outcome: z.string().min(1).max(100).optional(),
  /** Stake in USDC. */
  amount: DecimalString.refine(positive, 'amount must be > 0').optional(),
  /** Worst acceptable price per share, in (0, 1]. */
  maxPrice: PriceString.refine(positive, 'maxPrice must be > 0').optional(),
  source: MagicLinkSource,
  /** Bind the link to the signed-in caller; only they can open it. Requires sign-in. */
  bindToUser: z.boolean().default(false),
  /** Lifetime; default and max are server config. */
  ttlSeconds: z.number().int().min(60).optional(),
});
export type CreateMagicLinkBody = z.infer<typeof CreateMagicLinkBody>;

export const MagicLink = z.object({
  id: z.string().uuid(),
  token: z.string(),
  /** Public Paras URL (WEB_BASE_URL + returnTo). */
  url: z.string().url(),
  /** Relative path to pass as `returnTo` to auth flows so a signed-out user lands back here. */
  returnTo: z.string(),
  expiresAt: z.iso.datetime(),
});
export type MagicLink = z.infer<typeof MagicLink>;

export const createMagicLink = defineRoute({
  method: 'post',
  path: '/v1/magic-links',
  operationId: 'createMagicLink',
  summary: 'Mint a signed, short-lived Magic Link to an Event with an optional prefilled bet',
  tags: ['magic-links'],
  status: 201,
  request: { body: CreateMagicLinkBody },
  response: MagicLink,
});

/** Prefill for the bet ticket. Resolving never places or signs anything. */
export const MagicLinkPrefill = z.object({
  id: z.string().uuid(),
  event: EventView,
  outcome: z.string().nullable(),
  amount: DecimalString.nullable(),
  maxPrice: PriceString.nullable(),
  source: MagicLinkSource,
  /** True when the link is bound to a User (the caller is that User). */
  bound: z.boolean(),
  expiresAt: z.iso.datetime(),
});
export type MagicLinkPrefill = z.infer<typeof MagicLinkPrefill>;

export const resolveMagicLink = defineRoute({
  method: 'get',
  path: '/v1/magic-links/{token}',
  operationId: 'resolveMagicLink',
  summary:
    'Verify a Magic Link and return its prefill. 400 invalid_magic_link, 410 magic_link_expired, ' +
    '404 not_found, 401 unauthorized (bound link, signed out), 403 magic_link_wrong_user',
  tags: ['magic-links'],
  request: { params: z.object({ token: z.string().min(1).max(2048) }) },
  response: MagicLinkPrefill,
});
