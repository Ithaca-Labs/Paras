import { defineRoute } from '../route.js';
import { z } from '../zod.js';
import { EventView } from './events.js';

export const SignalKind = z.enum(['view', 'dismiss', 'fewer_like_this', 'bet']);
export const FollowKind = z.enum(['event', 'topic', 'entity']);

export const FeedItem = z.object({
  event: EventView,
  /** Ranking score (higher first). Comparable only within one response. */
  score: z.number(),
  /** Human-readable why: "Because you follow Fed rate decisions". */
  reason: z.string(),
});
export type FeedItem = z.infer<typeof FeedItem>;

export const Feed = z.object({
  items: z.array(FeedItem),
  /** Starter picks for newcomers (beginner or unknown experience); empty otherwise. First page only. */
  beginners: z.array(FeedItem),
  /** False when the caller has no usable Interest Profile and gets the popularity + diversity default. */
  personalized: z.boolean(),
  nextCursor: z.string().nullable(),
});
export type Feed = z.infer<typeof Feed>;

/** Set when the call minted an anonymous token for a signed-out caller (also sent as `paras_anon` cookie). */
const AnonToken = z.object({ anonToken: z.string().nullable() });

const tags = ['feed'];

export const getFeed = defineRoute({
  method: 'get',
  path: '/v1/feed',
  operationId: 'getFeed',
  summary:
    'Personalized Feed for the signed-in User or anonymous visitor (cookie / x-paras-anon). Open Events only; dismissed ones hidden',
  tags,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().optional(),
    }),
  },
  response: Feed,
});

export const recordFeedSignal = defineRoute({
  method: 'post',
  path: '/v1/feed/signals',
  operationId: 'recordFeedSignal',
  summary:
    'Record an implicit signal (view, dismiss, fewer_like_this, bet). Weights decay over time; works signed out',
  tags,
  request: { body: z.object({ eventId: z.string().uuid(), kind: SignalKind }) },
  response: AnonToken.extend({ ok: z.literal(true) }),
});

export const FollowBody = z.object({
  kind: FollowKind,
  /** Event id, or a taxonomy id (`GET /v1/categories`): topic or category for `topic`, entity for `entity`. */
  targetId: z.string().min(1).max(100),
});

export const Follow = FollowBody.extend({ createdAt: z.iso.datetime() });

export const listFollows = defineRoute({
  method: 'get',
  path: '/v1/follows',
  operationId: 'listFollows',
  summary: 'What the caller follows',
  tags,
  request: {},
  response: z.object({ items: z.array(Follow) }),
});

export const addFollow = defineRoute({
  method: 'post',
  path: '/v1/follows',
  operationId: 'addFollow',
  summary: 'Follow an Event, topic or entity (idempotent). Boosts related Events in the Feed',
  tags,
  request: { body: FollowBody },
  response: AnonToken.extend({ ok: z.literal(true) }),
});

export const removeFollow = defineRoute({
  method: 'delete',
  path: '/v1/follows',
  operationId: 'removeFollow',
  summary: 'Unfollow (idempotent)',
  tags,
  request: { query: FollowBody },
  response: z.object({ ok: z.literal(true) }),
});
