import { defineRoute } from '../route.js';
import { DecimalString, VenueId } from '../venue.js';
import { z } from '../zod.js';

/** One Market as the operator sees it: question plus the Venue's resolution rules, side by side. */
export const AdminMarket = z.object({
  id: z.string().uuid(),
  venueId: VenueId,
  question: z.string(),
  rules: z.string(),
  url: z.string().url(),
  endDate: z.iso.datetime().nullable(),
  outcomes: z.array(z.string()),
});
export type AdminMarket = z.infer<typeof AdminMarket>;

export const MatchReview = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'approved', 'rejected']),
  confidence: DecimalString,
  direction: z.enum(['same', 'inverse']),
  candidate: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Market proposed to join the Event. */
  market: AdminMarket,
  event: z.object({ id: z.string().uuid(), title: z.string(), markets: z.array(AdminMarket) }),
});
export type MatchReview = z.infer<typeof MatchReview>;

const tags = ['admin'];
const reviewId = z.object({ id: z.string().uuid() });
const eventRef = z.object({ eventId: z.string().uuid() });

export const listMatchReviews = defineRoute({
  method: 'get',
  path: '/v1/admin/match-reviews',
  operationId: 'listMatchReviews',
  summary: 'Operator review queue of medium-confidence cross-Venue matches (admin only)',
  tags,
  request: {
    query: z.object({
      status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  response: z.object({ items: z.array(MatchReview) }),
});

export const approveMatchReview = defineRoute({
  method: 'post',
  path: '/v1/admin/match-reviews/{id}/approve',
  operationId: 'approveMatchReview',
  summary: 'Link the proposed Market into the Event (recorded as an operator override)',
  tags,
  request: { params: reviewId },
  response: eventRef,
});

export const rejectMatchReview = defineRoute({
  method: 'post',
  path: '/v1/admin/match-reviews/{id}/reject',
  operationId: 'rejectMatchReview',
  summary: 'Reject the proposal; matching never proposes this pair again',
  tags,
  request: { params: reviewId },
  response: z.object({ id: z.string().uuid() }),
});

export const mergeEvents = defineRoute({
  method: 'post',
  path: '/v1/admin/events/merge',
  operationId: 'mergeEvents',
  summary: 'Merge all Markets of `sourceEventId` into `targetEventId` (operator override)',
  tags,
  request: {
    body: z.object({ sourceEventId: z.string().uuid(), targetEventId: z.string().uuid() }),
  },
  response: eventRef,
});

export const splitEvent = defineRoute({
  method: 'post',
  path: '/v1/admin/events/{id}/split',
  operationId: 'splitEvent',
  summary: 'Move one Market out of an Event into its own Event (operator override)',
  tags,
  request: { params: reviewId, body: z.object({ marketId: z.string().uuid() }) },
  response: eventRef,
});

export const updateEventLabels = defineRoute({
  method: 'patch',
  path: '/v1/admin/events/{id}',
  operationId: 'updateEventLabels',
  summary: 'Relabel an Event title and/or category; the relabel survives re-sync (admin only)',
  tags,
  request: {
    params: reviewId,
    body: z
      .object({
        title: z.string().trim().min(1).max(300),
        category: z.string().trim().min(1).max(80),
      })
      .partial()
      .refine(
        (b) => b.title !== undefined || b.category !== undefined,
        'title or category required',
      ),
  },
  response: z.object({ id: z.string().uuid(), title: z.string(), category: z.string().nullable() }),
});
