import { defineRoute } from '../route.js';
import { VenueCapabilities, VenueId, VenueLabel } from '../venue.js';
import { z } from '../zod.js';

export const VenueView = z.object({
  id: VenueId,
  name: z.string(),
  capabilities: VenueCapabilities,
  /** Regulation and availability label, present on every Venue. */
  label: VenueLabel,
});
export type VenueView = z.infer<typeof VenueView>;

export const VenueList = z.object({ items: z.array(VenueView) });
export type VenueList = z.infer<typeof VenueList>;

export const listVenues = defineRoute({
  method: 'get',
  path: '/v1/venues',
  operationId: 'listVenues',
  summary: 'List Venues with regulation and availability labels',
  tags: ['venues'],
  request: {},
  response: VenueList,
});
